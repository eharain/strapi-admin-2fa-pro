'use strict';

/**
 * Plugin configuration.
 *
 * Everything here can be overridden per-app in `config/plugins.js`, and the
 * policy fields (`admin.enforce`, `admin.enforceRoles`, `users.enforce`, …)
 * can be overridden again at runtime from the Settings page — see
 * `services/settings.js`. The file is the floor, the store is the live value.
 */
const DEFAULTS = {
  /** A label for the authenticator app. Defaults to the project's host name. */
  issuer: null,

  /** RFC 6238 parameters. Six digits over thirty seconds is what every app expects. */
  digits: 6,
  period: 30,
  /** Clock drift tolerated either side, in seconds. One step by default. */
  driftSeconds: 30,

  /** How many single-use recovery codes are issued when a factor is confirmed. */
  recoveryCodeCount: 10,

  /** How long the second-factor prompt stays open after the password is accepted. */
  challengeTtlSeconds: 180,
  /** How long the proof of a passed second factor is good for. It is spent immediately. */
  proofTtlSeconds: 120,

  /** Wrong codes tolerated before the factor locks. */
  maxAttempts: 5,
  lockoutSeconds: 900,

  /**
   * Key used to encrypt factor secrets and sign challenges. Falls back to
   * `admin.secrets.encryptionKey`, then `admin.auth.secret`. Set it explicitly
   * if you ever rotate the admin JWT secret — rotating it without setting this
   * makes every enrolled factor unreadable.
   */
  encryptionKey: null,

  admin: {
    /** 'optional' — only admins who enrolled are challenged. 'required' — everyone must. */
    enforce: 'optional',
    /** Role codes that must use a second factor even when enforce is 'optional'. */
    enforceRoles: [],
    /** Days an admin may keep signing in after enforcement starts before they must enrol. */
    gracePeriodDays: 0,
  },

  users: {
    /** The users-permissions surface: the same TOTP factor on /api/auth/local. */
    enabled: true,
    enforce: 'optional',
  },
};

module.exports = {
  default: DEFAULTS,
  validator(config = {}) {
    const modes = ['optional', 'required'];

    const positive = (value, name) => {
      if (value === undefined) return;
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`two-factor: "${name}" must be a positive integer, got ${JSON.stringify(value)}`);
      }
    };

    if (config.digits !== undefined && ![6, 7, 8].includes(config.digits)) {
      throw new Error('two-factor: "digits" must be 6, 7 or 8 — authenticator apps do not agree on anything else');
    }
    positive(config.period, 'period');
    positive(config.recoveryCodeCount, 'recoveryCodeCount');
    positive(config.challengeTtlSeconds, 'challengeTtlSeconds');
    positive(config.proofTtlSeconds, 'proofTtlSeconds');
    positive(config.maxAttempts, 'maxAttempts');

    if (config.driftSeconds !== undefined && (!Number.isInteger(config.driftSeconds) || config.driftSeconds < 0)) {
      throw new Error('two-factor: "driftSeconds" must be a non-negative integer');
    }
    if (config.lockoutSeconds !== undefined && (!Number.isInteger(config.lockoutSeconds) || config.lockoutSeconds < 0)) {
      throw new Error('two-factor: "lockoutSeconds" must be a non-negative integer');
    }

    for (const surface of ['admin', 'users']) {
      const mode = config[surface]?.enforce;
      if (mode !== undefined && !modes.includes(mode)) {
        throw new Error(`two-factor: "${surface}.enforce" must be one of ${modes.join(', ')}`);
      }
    }

    if (config.admin?.enforceRoles !== undefined && !Array.isArray(config.admin.enforceRoles)) {
      throw new Error('two-factor: "admin.enforceRoles" must be an array of role codes');
    }
  },
};
