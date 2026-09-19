'use strict';

const authenticated = { policies: ['admin::isAuthenticatedAdmin'] };

const permitted = (...actions) => ({
  policies: [
    'admin::isAuthenticatedAdmin',
    { name: 'admin::hasPermissions', config: { actions } },
  ],
});

/**
 * Mounted at `/two-factor` — the admin API has no prefix of its own.
 *
 * The two `/challenge` routes are deliberately unauthenticated: they are used
 * between the password being accepted and a session existing, so there is
 * nothing to authenticate with. The signed challenge is what stands in, and it
 * is only ever issued by the login gate.
 *
 * Nothing here is rate-limited at the route: wrong codes are counted against
 * the factor itself, which locks after `maxAttempts` wherever they come from.
 * A per-IP limiter would be weaker, not stronger — it would let an attacker
 * spread guesses across addresses.
 */
module.exports = {
  type: 'admin',
  routes: [
    {
      method: 'POST',
      path: '/challenge/verify',
      handler: 'challenge.verify',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/challenge/confirm',
      handler: 'challenge.confirm',
      config: { auth: false },
    },

    { method: 'GET', path: '/me', handler: 'admin-account.status', config: authenticated },
    { method: 'POST', path: '/me/enroll', handler: 'admin-account.enroll', config: authenticated },
    { method: 'POST', path: '/me/confirm', handler: 'admin-account.confirm', config: authenticated },
    { method: 'POST', path: '/me/disable', handler: 'admin-account.disable', config: authenticated },
    {
      method: 'POST',
      path: '/me/recovery-codes',
      handler: 'admin-account.recoveryCodes',
      config: authenticated,
    },

    {
      method: 'GET',
      path: '/administration',
      handler: 'administration.settings',
      config: permitted('plugin::two-factor.settings.read'),
    },
    {
      method: 'PUT',
      path: '/administration/settings',
      handler: 'administration.updateSettings',
      config: permitted('plugin::two-factor.settings.update'),
    },
    {
      method: 'POST',
      path: '/administration/admins/:id/reset',
      handler: 'administration.reset',
      config: permitted('plugin::two-factor.admins.manage'),
    },
    {
      method: 'POST',
      path: '/administration/admins/:id/unlock',
      handler: 'administration.unlock',
      config: permitted('plugin::two-factor.admins.manage'),
    },
    {
      method: 'POST',
      path: '/administration/sessions/revoke',
      handler: 'administration.revokeSessions',
      config: permitted('plugin::two-factor.admins.manage'),
    },
  ],
};
