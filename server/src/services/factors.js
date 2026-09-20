'use strict';

const { randomBytes } = require('crypto');
const QRCode = require('qrcode');
const { errors } = require('@strapi/utils');

const { PLUGIN_ID, uid, getService } = require('../utils/plugin');

const { ApplicationError, ForbiddenError, NotFoundError, UnauthorizedError } = errors;

const FACTOR = uid('factor');
const RECOVERY = uid('recovery-code');

// No I, O, 0 or 1: a recovery code gets read off a screen and typed back in,
// sometimes off a printout, and those four are where that goes wrong.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

module.exports = ({ strapi }) => {
  const read = (key, fallback) => strapi.config.get(`plugin::${PLUGIN_ID}.${key}`, fallback);
  const totp = () => getService(strapi, 'totp');
  const crypto = () => getService(strapi, 'crypto-box');

  const where = (subjectType, subjectId) => ({ subjectType, subjectId: String(subjectId) });

  const findFactor = (subjectType, subjectId, extra = {}) =>
    strapi.db.query(FACTOR).findOne({ where: { ...where(subjectType, subjectId), ...extra } });

  const generateRecoveryCode = () => {
    const bytes = randomBytes(12);
    const chars = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]);
    // Grouped for legibility; the hash normalises the dashes away.
    return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
  };

  const issueRecoveryCodes = async (subjectType, subjectId) => {
    await strapi.db.query(RECOVERY).deleteMany({ where: where(subjectType, subjectId) });

    const codes = Array.from({ length: read('recoveryCodeCount', 10) }, generateRecoveryCode);
    for (const code of codes) {
      await strapi.db.query(RECOVERY).create({
        data: { ...where(subjectType, subjectId), codeHash: crypto().hashRecoveryCode(code), usedAt: null },
      });
    }
    return codes;
  };

  const consumeRecoveryCode = async (subjectType, subjectId, code) => {
    const hash = crypto().hashRecoveryCode(code);
    const row = await strapi.db
      .query(RECOVERY)
      .findOne({ where: { ...where(subjectType, subjectId), codeHash: hash, usedAt: null } });
    if (!row) return false;

    await strapi.db.query(RECOVERY).update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return true;
  };

  const countRecoveryCodes = (subjectType, subjectId) =>
    strapi.db.query(RECOVERY).count({ where: { ...where(subjectType, subjectId), usedAt: null } });

  const assertNotLocked = (factor) => {
    if (!factor?.lockedUntil) return;
    const until = new Date(factor.lockedUntil).getTime();
    if (until > Date.now()) {
      const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
      throw new ForbiddenError(
        `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or use a recovery code.`
      );
    }
  };

  const recordFailure = async (factor) => {
    if (!factor) return;
    const attempts = (factor.failedAttempts || 0) + 1;
    const max = read('maxAttempts', 5);

    if (attempts >= max) {
      const lockoutSeconds = read('lockoutSeconds', 900);
      await strapi.db.query(FACTOR).update({
        where: { id: factor.id },
        data: { failedAttempts: 0, lockedUntil: new Date(Date.now() + lockoutSeconds * 1000) },
      });
      strapi.log.warn(
        `[two-factor] locking ${factor.subjectType} ${factor.subjectId} for ${lockoutSeconds}s after ${max} wrong codes`
      );
      return;
    }

    await strapi.db.query(FACTOR).update({ where: { id: factor.id }, data: { failedAttempts: attempts } });
  };

  const service = {
    async isEnrolled(subjectType, subjectId) {
      const factor = await findFactor(subjectType, subjectId);
      return Boolean(factor && factor.confirmedAt);
    },

    async status({ subjectType, subjectId }) {
      const factor = await findFactor(subjectType, subjectId);
      const confirmed = Boolean(factor && factor.confirmedAt);

      return {
        enrolled: confirmed,
        pendingEnrolment: Boolean(factor && !factor.confirmedAt),
        method: confirmed ? factor.method : null,
        label: factor?.label ?? null,
        confirmedAt: factor?.confirmedAt ?? null,
        lastUsedAt: factor?.lastUsedAt ?? null,
        lockedUntil: factor?.lockedUntil ?? null,
        recoveryCodesRemaining: confirmed ? await countRecoveryCodes(subjectType, subjectId) : 0,
      };
    },

    /**
     * Start an enrolment. The secret is returned exactly once, in the response
     * that is scanned; after that it only exists encrypted.
     *
     * Restarting an unconfirmed enrolment throws the old secret away, so a QR
     * left open in another tab cannot be confirmed later.
     */
    async startEnrolment({ subjectType, subjectId, accountName, label = null }) {
      const existing = await findFactor(subjectType, subjectId);
      if (existing?.confirmedAt) {
        throw new ApplicationError('An authenticator is already set up — remove it before adding another');
      }
      if (existing) await strapi.db.query(FACTOR).delete({ where: { id: existing.id } });

      const secret = totp().generateSecret();
      const otpauthUri = totp().keyUri(accountName || String(subjectId), secret, subjectType);

      await strapi.db.query(FACTOR).create({
        data: {
          ...where(subjectType, subjectId),
          method: 'totp',
          label,
          secretEnc: crypto().encrypt(secret),
          confirmedAt: null,
          failedAttempts: 0,
          lockedUntil: null,
        },
      });

      strapi.log.info(`[two-factor] enrolment started for ${subjectType} ${subjectId}`);

      return {
        secret,
        otpauthUri,
        qrDataUrl: await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
        digits: totp().digits,
        period: totp().period,
        issuer: totp().issuer(subjectType),
        accountName,
      };
    },

    /** Confirm an enrolment with a live code, and hand over the recovery codes. */
    async confirmEnrolment({ subjectType, subjectId, code }) {
      const factor = await findFactor(subjectType, subjectId);
      if (!factor) throw new NotFoundError('There is no enrolment to confirm — start one first');
      if (factor.confirmedAt) throw new ApplicationError('That authenticator is already confirmed');

      const result = await totp().verify({ token: code, secret: crypto().decrypt(factor.secretEnc) });
      if (!result.valid) throw new UnauthorizedError('That code is not valid');

      await strapi.db.query(FACTOR).update({
        where: { id: factor.id },
        data: {
          confirmedAt: new Date(),
          lastUsedAt: new Date(),
          lastCounter: String(result.timeStep),
          failedAttempts: 0,
          lockedUntil: null,
        },
      });

      strapi.log.info(`[two-factor] enrolment confirmed for ${subjectType} ${subjectId}`);
      return { recoveryCodes: await issueRecoveryCodes(subjectType, subjectId) };
    },

    /**
     * Check a code against the confirmed factor, then against the recovery
     * codes. Returns the method that worked, or throws 401.
     */
    async verifyCode({ subjectType, subjectId, code, allowRecovery = true }) {
      const factor = await findFactor(subjectType, subjectId);
      if (!factor || !factor.confirmedAt) throw new UnauthorizedError('That code is not valid');

      assertNotLocked(factor);

      const result = await totp().verify({
        token: code,
        secret: crypto().decrypt(factor.secretEnc),
        lastCounter: factor.lastCounter,
      });

      if (result.valid) {
        await strapi.db.query(FACTOR).update({
          where: { id: factor.id },
          data: {
            lastUsedAt: new Date(),
            lastCounter: String(result.timeStep),
            failedAttempts: 0,
            lockedUntil: null,
          },
        });
        return { method: 'totp' };
      }

      if (result.reason === 'replayed') {
        // The code was right but already spent — refusing a replay inside the
        // same thirty-second window is the whole point of keeping the counter.
        await recordFailure(factor);
        throw new UnauthorizedError('That code has already been used — wait for the next one');
      }

      if (allowRecovery && (await consumeRecoveryCode(subjectType, subjectId, code))) {
        const remaining = await countRecoveryCodes(subjectType, subjectId);
        await strapi.db.query(FACTOR).update({
          where: { id: factor.id },
          data: { lastUsedAt: new Date(), failedAttempts: 0, lockedUntil: null },
        });
        strapi.log.warn(`[two-factor] recovery code used by ${subjectType} ${subjectId}, ${remaining} left`);
        return { method: 'recovery', remaining };
      }

      await recordFailure(factor);
      throw new UnauthorizedError('That code is not valid');
    },

    async regenerateRecoveryCodes({ subjectType, subjectId }) {
      if (!(await service.isEnrolled(subjectType, subjectId))) {
        throw new ApplicationError('There is no authenticator to issue recovery codes for');
      }
      return { recoveryCodes: await issueRecoveryCodes(subjectType, subjectId) };
    },

    /** Remove the factor and every recovery code that went with it. */
    async remove({ subjectType, subjectId, reason = 'self' }) {
      await strapi.db.query(FACTOR).deleteMany({ where: where(subjectType, subjectId) });
      await strapi.db.query(RECOVERY).deleteMany({ where: where(subjectType, subjectId) });
      strapi.log.warn(`[two-factor] authenticator removed for ${subjectType} ${subjectId} (${reason})`);
    },

    /** Clear a lockout without removing the factor — for an admin helping someone out. */
    async unlock({ subjectType, subjectId }) {
      const factor = await findFactor(subjectType, subjectId);
      if (!factor) return;
      await strapi.db
        .query(FACTOR)
        .update({ where: { id: factor.id }, data: { failedAttempts: 0, lockedUntil: null } });
    },

    /** Every confirmed factor, keyed by subject id — for the admin overview. */
    async enrolledMap(subjectType) {
      // No `limit`, and not `limit: -1`: the query engine passes that straight
      // through to the database, which refuses a negative LIMIT. Leaving it out
      // is what returns every row.
      const rows = await strapi.db.query(FACTOR).findMany({
        where: { subjectType, confirmedAt: { $notNull: true } },
      });
      return new Map(rows.map((row) => [String(row.subjectId), row]));
    },
  };

  return service;
};
