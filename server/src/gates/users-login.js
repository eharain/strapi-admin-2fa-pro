'use strict';

const { getService } = require('../utils/plugin');

/**
 * The same gate, in front of `POST /api/auth/local`.
 *
 * It mirrors the credential check the users-permissions controller does —
 * provider `local`, identifier matched against email or username, the plugin's
 * own `validatePassword` — so a password that would be refused here is handed
 * straight on and refused there, with the message and the timing callers
 * already expect.
 *
 * `twoFactorToken` is removed from the body before the handler sees it:
 * users-permissions validates the login body with `.noUnknown()`, so leaving it
 * in would turn a correct sign-in into a validation error.
 */
module.exports = ({ strapi }) => async (ctx, next) => {
  const body = ctx.request.body || {};
  const identifier = typeof body.identifier === 'string' ? body.identifier : null;
  const password = typeof body.password === 'string' ? body.password : null;

  if (!identifier || !password) return next();

  const tokens = getService(strapi, 'tokens');
  const policy = getService(strapi, 'policy');
  const factors = getService(strapi, 'factors');

  const subject = identifier.toLowerCase();

  if (body.twoFactorToken) {
    const proof = body.twoFactorToken;
    delete ctx.request.body.twoFactorToken;
    tokens.verifyProof(proof, { subjectType: 'user', email: subject });
    return next();
  }

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: {
      provider: 'local',
      $or: [{ email: subject }, { username: identifier }],
    },
  });

  if (!user || !user.password || user.blocked === true) return next();

  const valid = await strapi.plugin('users-permissions').service('user').validatePassword(password, user.password);
  if (!valid) return next();

  const decision = await policy.forUser(user);
  if (!decision.enabled) return next();
  if (!decision.mustPresent && !decision.mustEnrol) return next();

  const { token: challenge, expiresIn } = tokens.issueChallenge({
    subjectType: 'user',
    subjectId: user.id,
    email: subject,
    enrolling: decision.mustEnrol,
  });

  const twoFactor = {
    required: true,
    surface: 'users',
    challenge,
    expiresIn,
    methods: ['totp'],
    recoveryAvailable: decision.enrolled,
    enrolmentRequired: decision.mustEnrol,
  };

  if (decision.mustEnrol) {
    twoFactor.enrolment = await factors.startEnrolment({
      subjectType: 'user',
      subjectId: user.id,
      accountName: user.email || user.username,
      label: 'Account',
    });
  }

  strapi.eventHub.emit('two-factor.challenge.issued', { surface: 'users', userId: user.id });

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
