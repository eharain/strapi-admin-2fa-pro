'use strict';

const { generate, generateSecret, generateURI, verify } = require('otplib');

const { PLUGIN_ID } = require('../utils/plugin');

/**
 * TOTP (RFC 6238) through `otplib` — a vetted implementation rather than a
 * hand-rolled HMAC loop.
 *
 * Two behaviours matter beyond "does the code match":
 *
 *   - **drift tolerance** so a phone whose clock is slightly off still works;
 *   - **replay protection**: the accepted time step comes back so the caller
 *     can persist it and refuse the same code again inside its own window.
 *     A code seen once is spent.
 */
module.exports = ({ strapi }) => {
  const read = (key, fallback) => strapi.config.get(`plugin::${PLUGIN_ID}.${key}`, fallback);

  const params = () => ({
    period: read('period', 30),
    digits: read('digits', 6),
  });

  const issuer = () => {
    const configured = read('issuer', null);
    if (configured) return String(configured);

    // The issuer is what the authenticator app lists the entry under, so it
    // should say which deployment this is — two Strapis both called "Strapi"
    // on one phone are indistinguishable.
    const url = strapi.config.get('admin.url') || strapi.config.get('server.url') || '';
    try {
      if (url) return new URL(url, 'http://localhost').host || 'Strapi';
    } catch {
      /* fall through to the default */
    }
    return 'Strapi';
  };

  return {
    get digits() {
      return params().digits;
    },
    get period() {
      return params().period;
    },
    issuer,

    /** A fresh base32 secret for a new enrolment. */
    generateSecret: () => generateSecret(),

    /** The otpauth:// URI an authenticator app scans — or opens, when tapped on a phone. */
    keyUri(accountName, secret) {
      return generateURI({ ...params(), secret, label: accountName, issuer: issuer() });
    },

    /**
     * Verify a submitted code.
     *
     * Returns `{ valid, timeStep, reason }`. Persist `timeStep` on the factor
     * and pass it back as `lastCounter` next time, so a spent code stays spent.
     */
    async verify({ token, secret, at = Date.now(), lastCounter = null }) {
      const base = params();
      const code = String(token ?? '').replace(/\s+/g, '');
      if (!/^\d+$/.test(code) || code.length !== base.digits) return { valid: false, reason: 'malformed' };

      const epoch = Math.floor(at / 1000);
      const epochTolerance = read('driftSeconds', base.period);
      const hasCounter = lastCounter !== null && lastCounter !== undefined && lastCounter !== '';

      const result = await verify({
        ...base,
        secret,
        token: code,
        epoch,
        epochTolerance,
        ...(hasCounter ? { afterTimeStep: Number(lastCounter) } : {}),
      });

      if (result.valid) return { valid: true, timeStep: result.timeStep, delta: result.delta };

      // Tell "wrong code" apart from "already used": a code that only fails once
      // replay protection is applied was correct, but spent.
      if (hasCounter) {
        const withoutGuard = await verify({ ...base, secret, token: code, epoch, epochTolerance });
        if (withoutGuard.valid) return { valid: false, reason: 'replayed', timeStep: withoutGuard.timeStep };
      }

      return { valid: false, reason: 'mismatch' };
    },

    /** Only for tests and seeding — never call this on a login path. */
    generate: (secret, at = Date.now()) => generate({ ...params(), secret, epoch: Math.floor(at / 1000) }),
  };
};
