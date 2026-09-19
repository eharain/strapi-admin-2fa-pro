'use strict';

const { errors } = require('@strapi/utils');

const { getService } = require('../utils/plugin');
const { handled } = require('../utils/respond');

const { ApplicationError, ForbiddenError, UnauthorizedError, ValidationError } = errors;

/**
 * The endpoints someone uses on their own account: look at it, set up an
 * authenticator, confirm it, take it away, get a fresh set of recovery codes.
 *
 * One implementation serves both surfaces — the admin panel and
 * users-permissions — because the only thing that differs is where the signed-in
 * subject comes from and which half of the policy applies to them.
 *
 * Every destructive step asks for a live code. A hijacked session should not be
 * able to quietly switch the second factor off, and it should not be able to
 * print itself a new set of recovery codes either.
 */
module.exports = ({ strapi, subjectType }) => {
  const factors = () => getService(strapi, 'factors');
  const policy = () => getService(strapi, 'policy');

  const subjectOf = (ctx) => {
    const user = ctx.state.user;
    if (!user || !user.id) throw new UnauthorizedError('Sign in first');
    return {
      subjectType,
      subjectId: user.id,
      accountName: user.email || user.username || String(user.id),
      user,
    };
  };

  const decisionFor = async (user) => (subjectType === 'admin' ? policy().forAdmin(user) : policy().forUser(user));

  const requireCode = (ctx) => {
    const code = ctx.request.body?.code;
    if (typeof code !== 'string' || code.trim() === '') {
      throw new ValidationError('Enter the code from your authenticator app');
    }
    return code.trim();
  };

  return {
    status: handled(async (ctx) => {
      const { subjectId, user } = subjectOf(ctx);
      const [status, decision] = await Promise.all([
        factors().status({ subjectType, subjectId }),
        decisionFor(user),
      ]);

      ctx.body = {
        data: {
          ...status,
          required: decision.required,
          mustEnrol: decision.mustEnrol,
          shouldEnrol: Boolean(decision.shouldEnrol),
          graceEndsAt: decision.graceEndsAt ?? null,
        },
      };
    }),

    enroll: handled(async (ctx) => {
      const { subjectId, accountName } = subjectOf(ctx);
      ctx.body = {
        data: await factors().startEnrolment({
          subjectType,
          subjectId,
          accountName,
          label: ctx.request.body?.label ?? null,
        }),
      };
    }),

    confirm: handled(async (ctx) => {
      const { subjectId } = subjectOf(ctx);
      const { recoveryCodes } = await factors().confirmEnrolment({
        subjectType,
        subjectId,
        code: requireCode(ctx),
      });
      ctx.body = { data: { enrolled: true, recoveryCodes } };
    }),

    disable: handled(async (ctx) => {
      const { subjectId, user } = subjectOf(ctx);

      const decision = await decisionFor(user);
      if (decision.required) {
        throw new ForbiddenError(
          'Two-factor authentication is required for this account and cannot be switched off. ' +
            'Ask an administrator if you have lost your device.'
        );
      }

      if (!(await factors().isEnrolled(subjectType, subjectId))) {
        throw new ApplicationError('There is no authenticator set up on this account');
      }

      // A live code, so a stolen session cannot undo the protection.
      await factors().verifyCode({ subjectType, subjectId, code: requireCode(ctx) });
      await factors().remove({ subjectType, subjectId, reason: 'removed by the account holder' });

      ctx.body = { data: { enrolled: false } };
    }),

    recoveryCodes: handled(async (ctx) => {
      const { subjectId } = subjectOf(ctx);
      await factors().verifyCode({ subjectType, subjectId, code: requireCode(ctx), allowRecovery: false });
      ctx.body = { data: await factors().regenerateRecoveryCodes({ subjectType, subjectId }) };
    }),
  };
};
