'use strict';

const { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } = require('crypto');

const { PLUGIN_ID, base64url, fromBase64url } = require('../utils/plugin');

/**
 * Key management for the three things this plugin has to keep to itself.
 *
 *   - **factor secrets** are encrypted, not hashed: verifying a TOTP code means
 *     recomputing it, which needs the secret back. AES-256-GCM, so a tampered
 *     ciphertext fails to open rather than decrypting to garbage.
 *   - **challenge and proof tokens** are signed, not encrypted: their contents
 *     are not secret, only their authenticity matters.
 *   - **recovery codes** are hashed: they are one-shot and never read back.
 *
 * All three keys are derived with HKDF from one piece of key material under
 * different labels, so the same secret can never be put to two uses.
 *
 * The material is, in order of preference: the plugin's own `encryptionKey`,
 * the app's `admin.secrets.encryptionKey`, or the admin JWT secret. That last
 * fallback has a consequence worth stating plainly — rotate the admin JWT
 * secret and every enrolled factor becomes unreadable, locking out everyone
 * who depends on one. Set `encryptionKey` explicitly in production.
 */
const SALT = `${PLUGIN_ID}:v1`;

module.exports = ({ strapi }) => {
  let keys = null;

  const resolveMaterial = () => {
    const configured = strapi.config.get(`plugin::${PLUGIN_ID}.encryptionKey`);
    if (configured) return { material: String(configured), source: 'plugin.encryptionKey' };

    const appSecret = strapi.config.get('admin.secrets.encryptionKey');
    if (appSecret) return { material: String(appSecret), source: 'admin.secrets.encryptionKey' };

    const jwtSecret = strapi.config.get('admin.auth.secret');
    if (jwtSecret) return { material: String(jwtSecret), source: 'admin.auth.secret' };

    throw new Error(
      'two-factor: no key material. Set the plugin config "encryptionKey", or admin.secrets.encryptionKey, ' +
        'or admin.auth.secret — factor secrets cannot be stored without one.'
    );
  };

  const derive = (material, info) => Buffer.from(hkdfSync('sha256', material, SALT, info, 32));

  const getKeys = () => {
    if (keys) return keys;
    const { material, source } = resolveMaterial();
    if (source === 'admin.auth.secret') {
      strapi.log.warn(
        '[two-factor] falling back to admin.auth.secret for factor encryption. Rotating that secret will ' +
          'make every enrolled authenticator unreadable — set the encryptionKey plugin config instead.'
      );
    }
    keys = {
      secretKey: derive(material, 'factor-secret'),
      signingKey: derive(material, 'token-signature'),
      hashKey: derive(material, 'recovery-code-hash'),
    };
    return keys;
  };

  return {
    /** Encrypt a factor secret for storage. Returns `v1.<iv>.<tag>.<ciphertext>`. */
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', getKeys().secretKey, iv);
      const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
      return ['v1', base64url(iv), base64url(cipher.getAuthTag()), base64url(ciphertext)].join('.');
    },

    decrypt(packed) {
      const [version, iv, tag, ciphertext] = String(packed).split('.');
      if (version !== 'v1' || !iv || !tag || !ciphertext) {
        throw new Error('two-factor: the stored secret is not in the expected format');
      }
      const decipher = createDecipheriv('aes-256-gcm', getKeys().secretKey, fromBase64url(iv));
      decipher.setAuthTag(fromBase64url(tag));
      return Buffer.concat([decipher.update(fromBase64url(ciphertext)), decipher.final()]).toString('utf8');
    },

    /** HMAC over a token payload, for challenge and proof tokens. */
    sign(payload) {
      return createHmac('sha256', getKeys().signingKey).update(payload).digest();
    },

    /** Keyed hash of a recovery code, normalised so the grouping dashes do not matter. */
    hashRecoveryCode(code) {
      const normalised = String(code).replace(/[\s-]/g, '').toUpperCase();
      return createHmac('sha256', getKeys().hashKey).update(normalised).digest('base64url');
    },

    /** Constant-time compare that tolerates a length mismatch without throwing. */
    equals(a, b) {
      const left = Buffer.from(a);
      const right = Buffer.from(b);
      if (left.length !== right.length) return false;
      return timingSafeEqual(left, right);
    },
  };
};
