'use strict';

/**
 * Mounted at `/api/two-factor` — the surface a users-permissions account uses.
 *
 * `auth: false` here means "this route needs no *permission*" — a site should
 * not have to tick five boxes in the Users & Permissions roles screen before
 * its own people can protect their accounts.
 *
 * It does NOT mean Strapi authenticates the caller anyway. This comment used to
 * claim it did, and 0.4.x shipped on that claim: `@strapi/core`'s auth service
 * returns before any strategy when `auth` is false, so `ctx.state.user` stayed
 * empty and every `/me` route refused everybody with "Sign in first". The token
 * is read by `gates/signed-in.js`, attached to these routes in `register.js`.
 * Changing `auth` here without keeping that gate brings the bug straight back.
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
    { method: 'POST', path: '/me/verify', handler: 'user-account.verify', config: signedIn },
  ],
};
