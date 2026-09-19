'use strict';

const { errors } = require('@strapi/utils');

const { getService } = require('../utils/plugin');
const { handled } = require('../utils/respond');

const { ValidationError } = errors;

/**
 * The unauthenticated half of the sign-in exchange.
 *
 * These two endpoints are reachable without a session — they have to be, since
 * the whole point is that no session exists yet. What stands in for one is the
 * signed challenge issued by the login gate, which is only handed out after a
 * password has been accepted. Without a valid challenge these endpoints do
 * nothing at all, so they are not a way in.
 */
module.exports = ({ strapi }) => {
  const tokens = () => getService(strapi, 'tokens');
  const factors = () => getService(strapi, 'factors');

  const read = (ctx) => {
    const { challenge, code } = ctx.request.body ?? {};
    if (typeof challenge !== 'string' || challenge === '') {
      throw new ValidationError('That sign-in attempt is no longer valid — please sign in again');
    }
    if (typeof code !== 'string' || code.trim() === '') {
      throw new ValidationError('Enter the code from your authenticator app');
    }
    return { challenge, code: code.trim() };
  };

  return {
    /** Present a code against an existing authenticator. */
    verify: handled(async (ctx) => {
      const { challenge, code } = read(ctx);
      const claims = tokens().verifyChallenge(challenge);

      const result = await factors().verifyCode({
        subjectType: claims.st,
        subjectId: claims.sid,
        code,
      });

      const proof = tokens().issueProof({ subjectType: claims.st, subjectId: claims.sid, email: claims.em });

      strapi.eventHub.emit('two-factor.challenge.passed', {
        surface: claims.st,
        userId: claims.sid,
        method: result.method,
      });

      ctx.body = {
        data: {
          proof: proof.token,
          expiresIn: proof.expiresIn,
          method: result.method,
          recoveryCodesRemaining: result.remaining ?? null,
        },
      };
    }),

    /**
     * Finish an enrolment that was forced at sign-in, and pass the sign-in in
     * the same step — the code that confirms the authenticator is proof that
     * the person holds it, so asking for a second one would be theatre.
     */
    confirm: handled(async (ctx) => {
      const { challenge, code } = read(ctx);
      const claims = tokens().verifyChallenge(challenge);

      if (!claims.en) {
        throw new ValidationError('That sign-in attempt is not an enrolment');
      }

      const { recoveryCodes } = await factors().confirmEnrolment({
        subjectType: claims.st,
        subjectId: claims.sid,
        code,
      });

      const proof = tokens().issueProof({ subjectType: claims.st, subjectId: claims.sid, email: claims.em });

      ctx.body = {
        data: { proof: proof.token, expiresIn: proof.expiresIn, enrolled: true, recoveryCodes },
      };
    }),
  };
};
