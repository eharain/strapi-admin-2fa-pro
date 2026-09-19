'use strict';

const { randomUUID } = require('crypto');
const { errors } = require('@strapi/utils');

const { PLUGIN_ID, base64url, fromBase64url, getService } = require('../utils/plugin');

const { UnauthorizedError } = errors;

/**
 * The two short-lived tokens this plugin passes to the browser.
 *
 *   - a **challenge** says "the password was right; now show me the second
 *     factor". It is issued instead of a session, so a password on its own is
 *     worth nothing but a prompt.
 *   - a **proof** says "the second factor was presented". The browser replays
 *     the original sign-in with the proof attached, and only then does the
 *     ordinary login handler run and mint the ordinary session.
 *
 * Both are signed, not encrypted — their contents are not secret — and both are
 * stateless, so nothing has to be shared between instances behind a load
 * balancer and a restart mid-login does not strand anyone.
 */
module.exports = ({ strapi }) => {
  const read = (key, fallback) => strapi.config.get(`plugin::${PLUGIN_ID}.${key}`, fallback);
  const crypto = () => getService(strapi, 'crypto-box');

  // A proof is meant to be spent once. Sessions are stateless by design, so
  // this is a best-effort guard within one process: behind several instances a
  // proof could in principle be replayed inside its lifetime, which would grant
  // a second session to someone who just proved both factors anyway.
  const spent = new Map();
  const forget = () => {
    const now = Date.now();
    for (const [jti, expiry] of spent) if (expiry <= now) spent.delete(jti);
  };

  const encode = (claims) => {
    const payload = base64url(JSON.stringify(claims));
    return `${payload}.${base64url(crypto().sign(payload))}`;
  };

  const decode = (token, purpose) => {
    const value = String(token || '');
    const dot = value.lastIndexOf('.');
    if (dot < 1) throw new UnauthorizedError('That sign-in attempt is no longer valid');

    const payload = value.slice(0, dot);
    const signature = value.slice(dot + 1);
    if (!crypto().equals(fromBase64url(signature), crypto().sign(payload))) {
      throw new UnauthorizedError('That sign-in attempt is no longer valid');
    }

    let claims;
    try {
      claims = JSON.parse(fromBase64url(payload).toString('utf8'));
    } catch {
      throw new UnauthorizedError('That sign-in attempt is no longer valid');
    }

    if (claims.v !== 1 || claims.p !== purpose) {
      throw new UnauthorizedError('That sign-in attempt is no longer valid');
    }
    if (!claims.exp || claims.exp * 1000 <= Date.now()) {
      throw new UnauthorizedError('That sign-in attempt timed out — please sign in again');
    }
    return claims;
  };

  return {
    issueChallenge({ subjectType, subjectId, email, enrolling = false }) {
      const ttl = read('challengeTtlSeconds', 180);
      return {
        token: encode({
          v: 1,
          p: 'challenge',
          st: subjectType,
          sid: String(subjectId),
          em: String(email || '').toLowerCase(),
          en: Boolean(enrolling),
          jti: randomUUID(),
          exp: Math.floor(Date.now() / 1000) + ttl,
        }),
        expiresIn: ttl,
      };
    },

    verifyChallenge(token) {
      return decode(token, 'challenge');
    },

    issueProof({ subjectType, subjectId, email }) {
      const ttl = read('proofTtlSeconds', 120);
      return {
        token: encode({
          v: 1,
          p: 'proof',
          st: subjectType,
          sid: String(subjectId),
          em: String(email || '').toLowerCase(),
          jti: randomUUID(),
          exp: Math.floor(Date.now() / 1000) + ttl,
        }),
        expiresIn: ttl,
      };
    },

    /**
     * Check a proof and spend it. `email` is the address the replayed sign-in
     * carries: a proof for one account must not unlock another.
     */
    verifyProof(token, { subjectType, email }) {
      const claims = decode(token, 'proof');

      if (claims.st !== subjectType) throw new UnauthorizedError('That sign-in attempt is no longer valid');
      if (claims.em !== String(email || '').toLowerCase()) {
        throw new UnauthorizedError('That sign-in attempt is no longer valid');
      }

      forget();
      if (spent.has(claims.jti)) throw new UnauthorizedError('That sign-in attempt has already been used');
      spent.set(claims.jti, claims.exp * 1000);

      return claims;
    },
  };
};
