'use strict';

const { errors } = require('@strapi/utils');

const { getService } = require('../utils/plugin');
const { handled } = require('../utils/respond');

const { NotFoundError, ValidationError } = errors;

/**
 * What an administrator does *about other people*: see who is covered, set the
 * policy, help someone who has lost their phone, and — when enforcement is
 * switched on — end the sessions that were opened before it was.
 *
 * That last one matters more than it looks. The login gate only meets people at
 * the door; an admin who signed in last week is already inside and would not be
 * asked for anything until their session expired. Ending those sessions is what
 * makes "required" mean required today rather than in thirty days.
 */
module.exports = ({ strapi }) => {
  const factors = () => getService(strapi, 'factors');
  const settings = () => getService(strapi, 'settings');

  const summarise = async () => {
    const enrolled = await factors().enrolledMap('admin');
    const admins = await strapi.db.query('admin::user').findMany({
      where: { isActive: true },
      populate: { roles: true },
      limit: -1,
    });

    return admins.map((user) => {
      const factor = enrolled.get(String(user.id));
      return {
        id: user.id,
        email: user.email,
        firstname: user.firstname ?? null,
        lastname: user.lastname ?? null,
        roles: (user.roles ?? []).map((role) => ({ id: role.id, code: role.code, name: role.name })),
        enrolled: Boolean(factor),
        confirmedAt: factor?.confirmedAt ?? null,
        lastUsedAt: factor?.lastUsedAt ?? null,
        lockedUntil: factor?.lockedUntil ?? null,
      };
    });
  };

  const findAdmin = async (id) => {
    const user = await strapi.db.query('admin::user').findOne({ where: { id } });
    if (!user) throw new NotFoundError('No such administrator');
    return user;
  };

  return {
    settings: handled(async (ctx) => {
      const [config, admins] = await Promise.all([settings().get(), summarise()]);
      const roles = await strapi.db.query('admin::role').findMany({ limit: -1 });

      ctx.body = {
        data: {
          settings: config,
          roles: roles.map((role) => ({ id: role.id, code: role.code, name: role.name })),
          admins,
          coverage: {
            total: admins.length,
            enrolled: admins.filter((a) => a.enrolled).length,
          },
        },
      };
    }),

    updateSettings: handled(async (ctx) => {
      const patch = ctx.request.body ?? {};
      let updated;
      try {
        updated = await settings().update(patch);
      } catch (error) {
        throw new ValidationError(error.message);
      }

      strapi.log.info(
        `[two-factor] policy changed by admin ${ctx.state.user?.id}: admin.enforce=${updated.admin.enforce}, ` +
          `roles=[${updated.admin.enforceRoles.join(', ')}], users.enforce=${updated.users.enforce}`
      );

      ctx.body = { data: updated };
    }),

    /** Take an administrator's authenticator away so they can enrol again. */
    reset: handled(async (ctx) => {
      const user = await findAdmin(ctx.params.id);
      await factors().remove({
        subjectType: 'admin',
        subjectId: user.id,
        reason: `reset by admin ${ctx.state.user?.id}`,
      });
      ctx.body = { data: { id: user.id, enrolled: false } };
    }),

    /** Clear a lockout without touching the authenticator itself. */
    unlock: handled(async (ctx) => {
      const user = await findAdmin(ctx.params.id);
      await factors().unlock({ subjectType: 'admin', subjectId: user.id });
      ctx.body = { data: { id: user.id, lockedUntil: null } };
    }),

    /**
     * End every other administrator's session. The caller keeps theirs, so
     * whoever just changed the policy is not thrown out of the page they
     * changed it on.
     */
    revokeSessions: handled(async (ctx) => {
      const sessionManager = strapi.sessionManager;
      if (!sessionManager) {
        throw new ValidationError('This version of Strapi does not manage admin sessions');
      }

      const callerId = String(ctx.state.user?.id ?? '');
      const admins = await strapi.db.query('admin::user').findMany({ where: { isActive: true }, limit: -1 });

      let revoked = 0;
      for (const user of admins) {
        if (String(user.id) === callerId) continue;
        await sessionManager('admin').invalidateRefreshToken(String(user.id));
        revoked += 1;
      }

      strapi.log.warn(`[two-factor] admin ${callerId} ended ${revoked} administrator session(s)`);
      ctx.body = { data: { revoked } };
    }),
  };
};
