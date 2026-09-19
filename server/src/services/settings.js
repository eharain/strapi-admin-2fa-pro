'use strict';

const { PLUGIN_ID } = require('../utils/plugin');

/**
 * The live policy.
 *
 * `config/plugins.js` sets the floor; the Settings page writes overrides into
 * the plugin store on top of it. Turning enforcement on is the kind of decision
 * an administrator makes at 9am on a Tuesday, not at the next deploy, so it has
 * to be changeable from the panel — but an app that pins `admin.enforce` in its
 * config file still gets that value as its starting point.
 *
 * `enforcedFrom` is stamped the moment enforcement is switched on, because the
 * grace period has to count from somewhere. Without it, raising the grace
 * period would silently re-open a window that had already closed.
 */
const OVERRIDABLE = {
  'admin.enforce': (v) => ['optional', 'required'].includes(v),
  'admin.enforceRoles': (v) => Array.isArray(v) && v.every((r) => typeof r === 'string'),
  'admin.gracePeriodDays': (v) => Number.isInteger(v) && v >= 0 && v <= 365,
  'users.enabled': (v) => typeof v === 'boolean',
  'users.enforce': (v) => ['optional', 'required'].includes(v),
};

const get = (object, path) => path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), object);

const set = (object, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((acc, key) => {
    if (!acc[key] || typeof acc[key] !== 'object') acc[key] = {};
    return acc[key];
  }, object);
  target[last] = value;
  return object;
};

module.exports = ({ strapi }) => {
  const store = () => strapi.store({ type: 'plugin', name: PLUGIN_ID });

  const fromConfig = () => ({
    admin: {
      enforce: strapi.config.get(`plugin::${PLUGIN_ID}.admin.enforce`, 'optional'),
      enforceRoles: strapi.config.get(`plugin::${PLUGIN_ID}.admin.enforceRoles`, []),
      gracePeriodDays: strapi.config.get(`plugin::${PLUGIN_ID}.admin.gracePeriodDays`, 0),
    },
    users: {
      enabled: strapi.config.get(`plugin::${PLUGIN_ID}.users.enabled`, true),
      enforce: strapi.config.get(`plugin::${PLUGIN_ID}.users.enforce`, 'optional'),
    },
  });

  return {
    /** The config file merged with whatever the Settings page has written over it. */
    async get() {
      const base = fromConfig();
      const overrides = (await store().get({ key: 'settings' })) || {};

      for (const path of Object.keys(OVERRIDABLE)) {
        const value = get(overrides, path);
        if (value !== undefined) set(base, path, value);
      }

      base.enforcedFrom = overrides.enforcedFrom ?? null;
      return base;
    },

    /**
     * Apply a patch from the Settings page. Only the fields above can move —
     * the cryptographic and protocol settings stay in the config file, where a
     * change is reviewed and deployed rather than clicked.
     */
    async update(patch = {}) {
      const overrides = (await store().get({ key: 'settings' })) || {};
      const before = await this.get();

      for (const [path, isValid] of Object.entries(OVERRIDABLE)) {
        const value = get(patch, path);
        if (value === undefined) continue;
        if (!isValid(value)) throw new Error(`two-factor: invalid value for "${path}"`);
        set(overrides, path, value);
      }

      const after = { ...before };
      for (const path of Object.keys(OVERRIDABLE)) {
        const value = get(overrides, path);
        if (value !== undefined) set(after, path, value);
      }

      // Stamp the moment enforcement starts, and clear it when it stops, so a
      // later re-enable starts a fresh grace period rather than an expired one.
      const wasEnforcing = before.admin.enforce === 'required' || before.admin.enforceRoles.length > 0;
      const isEnforcing = after.admin.enforce === 'required' || after.admin.enforceRoles.length > 0;
      if (isEnforcing && !wasEnforcing) overrides.enforcedFrom = new Date().toISOString();
      if (!isEnforcing) delete overrides.enforcedFrom;

      await store().set({ key: 'settings', value: overrides });
      return this.get();
    },
  };
};
