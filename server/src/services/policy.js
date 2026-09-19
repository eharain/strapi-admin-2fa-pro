'use strict';

const { getService } = require('../utils/plugin');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Who has to present a second factor, and who has to go and set one up.
 *
 * The two are deliberately separate. Anyone who has enrolled is challenged,
 * always — you do not get to skip your own authenticator because the policy
 * says "optional". Being *required* to enrol is the other half, and it comes
 * with a grace period so switching enforcement on does not lock out the whole
 * team at once.
 */
module.exports = ({ strapi }) => {
  const settings = () => getService(strapi, 'settings');
  const factors = () => getService(strapi, 'factors');

  const graceEndsAt = (config) => {
    const days = config.admin.gracePeriodDays || 0;
    if (!config.enforcedFrom) return null;
    if (days === 0) return null;
    return new Date(new Date(config.enforcedFrom).getTime() + days * DAY_MS);
  };

  const matchesRole = async (user, roleCodes) => {
    if (!Array.isArray(roleCodes) || roleCodes.length === 0) return false;

    // `checkCredentials` hands back the bare user row, so the roles have to be
    // fetched before they can be matched.
    const roles =
      user.roles ??
      (
        await strapi.db.query('admin::user').findOne({
          where: { id: user.id },
          populate: { roles: true },
        })
      )?.roles ??
      [];

    return roles.some((role) => roleCodes.includes(role.code) || roleCodes.includes(String(role.id)));
  };

  return {
    /** What the login gate needs to know about one admin user. */
    async forAdmin(user) {
      const config = await settings().get();
      const enrolled = await factors().isEnrolled('admin', user.id);
      const required = config.admin.enforce === 'required' || (await matchesRole(user, config.admin.enforceRoles));

      const deadline = graceEndsAt(config);
      const withinGrace = Boolean(deadline) && deadline.getTime() > Date.now();

      return {
        enrolled,
        required,
        /** Challenge them now. */
        mustPresent: enrolled,
        /** They cannot finish signing in until they enrol. */
        mustEnrol: required && !enrolled && !withinGrace,
        /** Required, not enrolled, still inside the grace period — nag, do not block. */
        shouldEnrol: required && !enrolled && withinGrace,
        graceEndsAt: deadline ? deadline.toISOString() : null,
      };
    },

    /** The same question for a users-permissions account. */
    async forUser(user) {
      const config = await settings().get();
      if (!config.users.enabled) {
        return { enabled: false, enrolled: false, required: false, mustPresent: false, mustEnrol: false };
      }

      const enrolled = await factors().isEnrolled('user', user.id);
      const required = config.users.enforce === 'required';

      return {
        enabled: true,
        enrolled,
        required,
        mustPresent: enrolled,
        mustEnrol: required && !enrolled,
      };
    },

    /**
     * Stamp the start of enforcement if it is on and has never been stamped.
     * Enforcement switched on from the Settings page records its own start; this
     * covers an app that pins `admin.enforce` in its config file, which would
     * otherwise have a grace period counting from nowhere.
     */
    async ensureEnforcementStamp() {
      const config = await settings().get();
      const enforcing = config.admin.enforce === 'required' || config.admin.enforceRoles.length > 0;
      if (!enforcing || config.enforcedFrom) return;

      await strapi.store({ type: 'plugin', name: 'two-factor' }).set({
        key: 'settings',
        value: {
          ...((await strapi.store({ type: 'plugin', name: 'two-factor' }).get({ key: 'settings' })) || {}),
          enforcedFrom: new Date().toISOString(),
        },
      });
    },
  };
};
