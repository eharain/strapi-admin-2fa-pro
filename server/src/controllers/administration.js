'use strict';

const { errors } = require('@strapi/utils');

const { getService } = require('../utils/plugin');
const { handled } = require('../utils/respond');

const { ForbiddenError, NotFoundError, ValidationError } = errors;

const USER_UID = 'plugin::users-permissions.user';

/**
 * What an administrator does *about other people*: see who is covered, set the
 * policy, help someone who has lost their phone, and — when enforcement is
 * switched on — end the sessions that were opened before it was.
 *
 * That last one matters more than it looks. The login gate only meets people at
 * the door; an admin who signed in last week is already inside and would not be
 * asked for anything until their session expired. Ending those sessions is what
 * makes "required" mean required today rather than in thirty days.
 *
 * **Anything done to somebody else's second factor needs the actor's own.**
 * Resetting a factor is the one step an attacker holding an administrator's
 * password most wants: it turns "we have their password" into "we can enrol
 * our own phone on their account". So an administrator acts on another
 * account only with a live code from their own authenticator — and one who has
 * none is told to set one up first. A wrong code counts towards the actor's
 * lockout, so a stolen panel session cannot guess its way through either.
 * Recovery codes are not accepted for this: they are for getting yourself back
 * in, not for acting on other people.
 *
 * Nobody resets their own factor from here. That is "My authenticator", which
 * refuses when the policy requires one; allowing it here would be a way round.
 */
module.exports = ({ strapi }) => {
  const factors = () => getService(strapi, 'factors');
  const settings = () => getService(strapi, 'settings');

  // Every route here is behind an admin session; see utils/respond.js.
  const respond = (work) => handled(work, { insideSession: true });

  const requireOwnCode = async (ctx) => {
    const actor = ctx.state.user;
    if (!actor?.id) throw new ForbiddenError('Sign in first');

    if (!(await factors().isEnrolled('admin', actor.id))) {
      throw new ForbiddenError(
        'Set up your own authenticator before changing anyone else’s — ' +
          'Settings → Two-factor authentication → My authenticator.'
      );
    }

    const code = ctx.request.body?.code;
    if (typeof code !== 'string' || code.trim() === '') {
      throw new ValidationError('Enter the code from your own authenticator app');
    }

    await factors().verifyCode({
      subjectType: 'admin',
      subjectId: actor.id,
      code: code.trim(),
      allowRecovery: false,
    });

    return actor;
  };

  const notSelf = (actor, subjectType, subjectId) => {
    if (subjectType === 'admin' && String(actor.id) === String(subjectId)) {
      throw new ValidationError('That is your own authenticator — change it under My authenticator.');
    }
  };

  /**
   * Sign somebody out everywhere, where Strapi can. Admin sessions always can.
   * Website accounts can only when users-permissions issues refresh sessions:
   * a legacy JWT is valid until it expires and nothing on the server can take
   * it back, which is worth saying rather than pretending otherwise.
   */
  const endSessionsFor = async (subjectType, subjectId) => {
    const origin = subjectType === 'admin' ? 'admin' : 'users-permissions';
    try {
      const manager = strapi.sessionManager?.(origin);
      if (!manager?.invalidateRefreshToken) return false;
      await manager.invalidateRefreshToken(String(subjectId));
      return true;
    } catch (error) {
      strapi.log.debug(`[two-factor] could not end ${origin} sessions for ${subjectId}: ${error.message}`);
      return false;
    }
  };

  const record = (event, { subjectType, subjectId, actor, extra = {} }) => {
    strapi.eventHub.emit(`two-factor.factor.${event}`, {
      subjectType,
      subjectId: String(subjectId),
      actorId: String(actor.id),
      ...extra,
    });
    strapi.log.warn(
      `[two-factor] admin ${actor.id} ${event === 'reset' ? 'reset' : 'unlocked'} the ${subjectType} factor of ${subjectId}` +
        (extra.sessionsEnded ? ' and ended their sessions' : '')
    );
  };

  // ── administrators ─────────────────────────────────────────────────────────

  const summarise = async () => {
    const enrolled = await factors().enrolledMap('admin');
    const admins = await strapi.db.query('admin::user').findMany({
      where: { isActive: true },
      populate: { roles: true },
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

  // ── website accounts ───────────────────────────────────────────────────────

  const requireUsersPlugin = () => {
    if (!strapi.plugin('users-permissions')) {
      throw new NotFoundError('This site has no users-permissions accounts');
    }
  };

  /**
   * A website account by id or, from the Content Manager, by document id —
   * which is what the edit view knows it by.
   */
  const findUser = async (idOrDocumentId) => {
    requireUsersPlugin();
    const key = String(idOrDocumentId);
    const where = /^\d+$/.test(key) ? { id: Number(key) } : { documentId: key };
    const user = await strapi.db.query(USER_UID).findOne({ where });
    if (!user) throw new NotFoundError('No such account');
    return user;
  };

  const describeUser = (user) => ({
    id: user.id,
    documentId: user.documentId ?? null,
    email: user.email ?? null,
    username: user.username ?? null,
    blocked: Boolean(user.blocked),
  });

  return {
    settings: respond(async (ctx) => {
      const [config, admins] = await Promise.all([settings().get(), summarise()]);
      const roles = await strapi.db.query('admin::role').findMany();

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

    updateSettings: respond(async (ctx) => {
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

    /**
     * Take an administrator's authenticator away so they can set one up again.
     *
     * Everything that can refuse without a code is checked before the code is:
     * a code spent on a request that was going to be refused anyway is a code
     * the actor then has to wait thirty seconds to replace.
     */
    reset: respond(async (ctx) => {
      const user = await findAdmin(ctx.params.id);
      notSelf(ctx.state.user ?? {}, 'admin', user.id);
      const actor = await requireOwnCode(ctx);

      await factors().remove({
        subjectType: 'admin',
        subjectId: user.id,
        reason: `reset by admin ${actor.id}`,
      });
      const sessionsEnded = ctx.request.body?.endSessions ? await endSessionsFor('admin', user.id) : false;

      record('reset', { subjectType: 'admin', subjectId: user.id, actor, extra: { sessionsEnded } });
      ctx.body = { data: { id: user.id, enrolled: false, sessionsEnded } };
    }),

    /** Clear a lockout without touching the authenticator itself. */
    unlock: respond(async (ctx) => {
      const user = await findAdmin(ctx.params.id);
      notSelf(ctx.state.user ?? {}, 'admin', user.id);
      const actor = await requireOwnCode(ctx);

      await factors().unlock({ subjectType: 'admin', subjectId: user.id });
      record('unlock', { subjectType: 'admin', subjectId: user.id, actor });
      ctx.body = { data: { id: user.id, lockedUntil: null } };
    }),

    /**
     * Website accounts that hold a second factor, a page at a time. `search`
     * matches email or username; the list is of factors this plugin owns, so it
     * says nothing about an account that has none.
     */
    users: respond(async (ctx) => {
      requireUsersPlugin();

      const search = String(ctx.query.search ?? '').trim();
      let subjectIds = null;

      if (search) {
        const matches = await strapi.db.query(USER_UID).findMany({
          where: { $or: [{ email: { $containsi: search } }, { username: { $containsi: search } }] },
          select: ['id'],
          limit: 200,
        });
        subjectIds = matches.map((match) => String(match.id));
      }

      const { rows, pagination } =
        subjectIds && subjectIds.length === 0
          ? { rows: [], pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 } }
          : await factors().page({
              subjectType: 'user',
              subjectIds,
              page: ctx.query.page,
              pageSize: ctx.query.pageSize,
            });

      const people = rows.length
        ? await strapi.db.query(USER_UID).findMany({ where: { id: { $in: rows.map((row) => Number(row.subjectId)) } } })
        : [];
      const byId = new Map(people.map((person) => [String(person.id), person]));

      ctx.body = {
        data: rows.map((row) => {
          const person = byId.get(String(row.subjectId));
          return {
            ...(person ? describeUser(person) : { id: Number(row.subjectId), email: null, username: null, blocked: false }),
            // A factor whose account has since been deleted is still listed, so
            // it can be cleared rather than left behind.
            missing: !person,
            enrolled: Boolean(row.confirmedAt),
            pendingEnrolment: !row.confirmedAt,
            confirmedAt: row.confirmedAt ?? null,
            lastUsedAt: row.lastUsedAt ?? null,
            lockedUntil: row.lockedUntil ?? null,
            recoveryCodesRemaining: row.recoveryCodesRemaining,
          };
        }),
        meta: { pagination },
      };
    }),

    /** One website account's second factor — what the Content Manager panel shows. */
    user: respond(async (ctx) => {
      const person = await findUser(ctx.params.id);
      const status = await factors().status({ subjectType: 'user', subjectId: person.id });
      ctx.body = { data: { ...describeUser(person), ...status } };
    }),

    /**
     * Take a website account's authenticator away. The person sets one up
     * again at their next sign-in if the policy requires it, or from their
     * account page. Their recovery codes go with it.
     */
    resetUser: respond(async (ctx) => {
      const person = await findUser(ctx.params.id);
      const actor = await requireOwnCode(ctx);

      await factors().remove({
        subjectType: 'user',
        subjectId: person.id,
        reason: `reset by admin ${actor.id}`,
      });
      const sessionsEnded = ctx.request.body?.endSessions ? await endSessionsFor('user', person.id) : false;

      record('reset', { subjectType: 'user', subjectId: person.id, actor, extra: { sessionsEnded } });
      ctx.body = { data: { id: person.id, enrolled: false, sessionsEnded } };
    }),

    unlockUser: respond(async (ctx) => {
      const person = await findUser(ctx.params.id);
      const actor = await requireOwnCode(ctx);

      await factors().unlock({ subjectType: 'user', subjectId: person.id });
      record('unlock', { subjectType: 'user', subjectId: person.id, actor });
      ctx.body = { data: { id: person.id, lockedUntil: null } };
    }),

    /**
     * End every other administrator's session. The caller keeps theirs, so
     * whoever just changed the policy is not thrown out of the page they
     * changed it on.
     */
    revokeSessions: respond(async (ctx) => {
      const sessionManager = strapi.sessionManager;
      if (!sessionManager) {
        throw new ValidationError('This version of Strapi does not manage admin sessions');
      }

      const callerId = String(ctx.state.user?.id ?? '');
      const admins = await strapi.db.query('admin::user').findMany({ where: { isActive: true } });

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
