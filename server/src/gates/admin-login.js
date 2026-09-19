'use strict';

const { getService } = require('../utils/plugin');

/**
 * The gate in front of `POST /admin/login`.
 *
 * It is a *route* middleware, not a global one, on purpose: that puts it after
 * `admin::rateLimit` and before the login handler, so the brute-force limiter
 * still sees every attempt and the second factor is asked for before any
 * session exists.
 *
 * The shape of the exchange, and why it is three steps rather than one:
 *
 *   1. the browser posts email and password. If the account uses a second
 *      factor the gate answers 401 `TwoFactorRequiredError` carrying a signed
 *      challenge — and stops. The ordinary handler never runs, so no refresh
 *      cookie is set and no access token is minted. A correct password on its
 *      own buys a prompt and nothing else.
 *   2. the browser posts the challenge and the code to `/two-factor/challenge/
 *      verify`, which answers with a signed proof.
 *   3. the browser replays the *original* sign-in with the proof attached. The
 *      gate checks the proof and steps aside, and Strapi's own login handler
 *      runs exactly as it always does — same validation, same session, same
 *      cookie, same response body.
 *
 * Step 3 is what keeps this plugin out of the session business. Nothing here
 * re-implements token minting, so nothing here can drift from the version of
 * Strapi it is installed into.
 */
module.exports = ({ strapi }) => async (ctx, next) => {
  const body = ctx.request.body || {};
  const email = typeof body.email === 'string' ? body.email : null;
  const password = typeof body.password === 'string' ? body.password : null;

  // Not a credential login (SSO, a malformed body): not ours to judge.
  if (!email || !password) return next();

  const tokens = getService(strapi, 'tokens');
  const policy = getService(strapi, 'policy');
  const factors = getService(strapi, 'factors');

  // Step 3 — a replayed sign-in carrying a proof.
  if (body.twoFactorToken) {
    const proof = body.twoFactorToken;
    // Strapi's login validator tolerates unknown keys, but the value has no
    // business reaching passport either way.
    delete ctx.request.body.twoFactorToken;

    // Throws if the proof is forged, expired, spent, or issued for someone else.
    tokens.verifyProof(proof, { subjectType: 'admin', email });

    return next();
  }

  // Step 1 — is a second factor in play for this account at all? Asking means
  // checking the password here, before the handler does. A wrong password is
  // handed straight on so the ordinary failure, and the ordinary timing, are
  // what an attacker sees.
  const [, user] = await strapi.service('admin::auth').checkCredentials({ email, password });
  if (!user) return next();

  const decision = await policy.forAdmin(user);
  if (!decision.mustPresent && !decision.mustEnrol) return next();

  const { token: challenge, expiresIn } = tokens.issueChallenge({
    subjectType: 'admin',
    subjectId: user.id,
    email,
    enrolling: decision.mustEnrol,
  });

  const twoFactor = {
    required: true,
    surface: 'admin',
    challenge,
    expiresIn,
    methods: ['totp'],
    recoveryAvailable: decision.enrolled,
    enrolmentRequired: decision.mustEnrol,
  };

  if (decision.mustEnrol) {
    // The password has already been accepted, so handing over a fresh secret
    // gives away nothing the holder of that password could not ask for anyway.
    twoFactor.enrolment = await factors.startEnrolment({
      subjectType: 'admin',
      subjectId: user.id,
      accountName: user.email,
      label: 'Admin panel',
    });
  }

  strapi.eventHub.emit('two-factor.challenge.issued', { surface: 'admin', userId: user.id });

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
