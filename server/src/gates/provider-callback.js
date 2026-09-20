'use strict';

const { getService } = require('../utils/plugin');

/**
 * The gate on `GET /api/auth/:provider/callback` — signing in through Google,
 * GitHub and the rest.
 *
 * Without this there is a way round the second factor, and it is not a subtle
 * one: the password sign-in is gated, but a provider sign-in is a different
 * route on the same controller, and it mints a token of its own. On a site with
 * both an authenticator and Google enabled, anyone who can get through Google
 * is inside, code or no code.
 *
 * It has to work the other way up from the password gate. There, the password
 * can be checked before anything is granted. Here the provider decides who this
 * is, inside the handler — so the handler runs, and what it produced is taken
 * back: the token is removed from the response, every cookie the handler set is
 * dropped, and the refresh session it opened is invalidated. Then the ordinary
 * challenge goes back instead.
 *
 * A challenge issued here is marked as one, because completing it cannot replay
 * a sign-in the way the password flow does — there is no password to replay. It
 * hands back a token directly, which is why it is marked and why the marking is
 * checked.
 */
module.exports = ({ strapi }) => async (ctx, next) => {
  const cookiesBefore = ctx.response.headers['set-cookie'];

  await next();

  const granted = ctx.body;
  const userId = granted?.user?.id;

  // Nothing was granted — a refusal, or a shape this does not recognise.
  if (!granted?.jwt || !userId) return;

  const policy = getService(strapi, 'policy');
  const factors = getService(strapi, 'factors');
  const tokens = getService(strapi, 'tokens');

  const decision = await policy.forUser({ id: userId });
  if (!decision.enabled) return;
  if (!decision.mustPresent && !decision.mustEnrol) return;

  // Take back what the handler just handed out.
  if (cookiesBefore === undefined) ctx.remove('set-cookie');
  else ctx.set('set-cookie', cookiesBefore);

  try {
    await strapi.sessionManager?.('users-permissions')?.invalidateRefreshToken(String(userId));
  } catch (error) {
    // Best effort: the token never reached the browser either way, and a
    // session nobody holds expires on its own.
    strapi.log.debug(`[two-factor] could not invalidate the provider refresh session: ${error.message}`);
  }

  const email = granted.user?.email ?? '';
  const { token: challenge, expiresIn } = tokens.issueChallenge({
    subjectType: 'user',
    subjectId: userId,
    email,
    enrolling: decision.mustEnrol,
    provider: true,
  });

  const twoFactor = {
    required: true,
    surface: 'users',
    via: 'provider',
    challenge,
    expiresIn,
    methods: ['totp'],
    recoveryAvailable: decision.enrolled,
    enrolmentRequired: decision.mustEnrol,
  };

  if (decision.mustEnrol) {
    twoFactor.enrolment = await factors.startEnrolment({
      subjectType: 'user',
      subjectId: userId,
      accountName: email || String(userId),
      label: 'Account',
    });
  }

  strapi.eventHub.emit('two-factor.challenge.issued', { surface: 'users', userId, via: 'provider' });

  ctx.status = 401;
  ctx.body = {
    data: null,
    error: {
      status: 401,
      name: 'TwoFactorRequiredError',
      message: decision.mustEnrol
        ? 'This account must be protected with an authenticator app before it can sign in'
        : 'Enter the code from your authenticator app',
      details: { twoFactor },
    },
  };
};
