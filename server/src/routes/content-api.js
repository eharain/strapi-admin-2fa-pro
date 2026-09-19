'use strict';

/**
 * Mounted at `/api/two-factor` — the surface a users-permissions account uses.
 *
 * `auth: false` on every route here means "this route needs no *permission*",
 * not "this route is public": Strapi still runs the authentication strategies,
 * so a valid JWT still lands in `ctx.state.user`, and the controller refuses
 * anyone who is not signed in. Doing it this way means a site does not have to
 * tick five boxes in the Users & Permissions roles screen before its own users
 * can protect their accounts.
 */
const signedIn = { auth: false };

module.exports = {
  type: 'content-api',
  routes: [
    { method: 'POST', path: '/challenge/verify', handler: 'challenge.verify', config: { auth: false } },
    { method: 'POST', path: '/challenge/confirm', handler: 'challenge.confirm', config: { auth: false } },

    { method: 'GET', path: '/me', handler: 'user-account.status', config: signedIn },
    { method: 'POST', path: '/me/enroll', handler: 'user-account.enroll', config: signedIn },
    { method: 'POST', path: '/me/confirm', handler: 'user-account.confirm', config: signedIn },
    { method: 'POST', path: '/me/disable', handler: 'user-account.disable', config: signedIn },
    { method: 'POST', path: '/me/recovery-codes', handler: 'user-account.recoveryCodes', config: signedIn },
  ],
};
