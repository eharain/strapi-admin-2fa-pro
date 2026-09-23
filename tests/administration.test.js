'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { errors } = require('@strapi/utils');

const administration = require('../server/src/controllers/administration');
const { createStrapi } = require('./harness');

/**
 * Resetting somebody's second factor is the step an attacker holding an
 * administrator's password most wants: it turns "we have their password" into
 * "we can enrol our own phone on their account". These tests hold the panel to
 * the rule that answers that — anything done to another account's factor needs
 * a live code from the actor's own.
 */
const ACTOR = { id: 1, email: 'lead@example.com' };

function setup({ actorEnrolled = true, codeIsRight = true, adminIds = [1, 2], users = [] } = {}) {
  const calls = { removed: [], unlocked: [], verified: [], ended: [], events: [] };

  const factors = {
    isEnrolled: async (subjectType, subjectId) =>
      subjectType === 'admin' && String(subjectId) === String(ACTOR.id) ? actorEnrolled : true,
    verifyCode: async (args) => {
      calls.verified.push(args);
      if (!codeIsRight) throw new errors.UnauthorizedError('That code is not valid');
      return { method: 'totp' };
    },
    remove: async (args) => calls.removed.push(args),
    unlock: async (args) => calls.unlocked.push(args),
    status: async () => ({ enrolled: true, recoveryCodesRemaining: 7, lockedUntil: null }),
    page: async ({ subjectIds }) => {
      const rows = users
        .filter((user) => !subjectIds || subjectIds.includes(String(user.id)))
        .map((user) => ({ subjectId: String(user.id), confirmedAt: '2026-09-01T00:00:00.000Z', recoveryCodesRemaining: 9 }));
      return { rows, pagination: { page: 1, pageSize: 25, total: rows.length, pageCount: 1 } };
    },
    enrolledMap: async () => new Map(),
  };

  const strapi = createStrapi({ services: { factors, settings: { get: async () => ({}) } } });

  const byUid = {
    'admin::user': adminIds.map((id) => ({ id, email: `admin${id}@example.com`, isActive: true })),
    'plugin::users-permissions.user': users,
  };

  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (key === '$or') return value.some((branch) => matches(row, branch));
      if (value && typeof value === 'object' && '$in' in value) return value.$in.map(String).includes(String(row[key]));
      if (value && typeof value === 'object' && '$containsi' in value) {
        return String(row[key] ?? '').toLowerCase().includes(String(value.$containsi).toLowerCase());
      }
      return String(row[key]) === String(value);
    });

  strapi.db = {
    query: (uid) => ({
      findOne: async ({ where }) => (byUid[uid] ?? []).find((row) => matches(row, where)) ?? null,
      findMany: async ({ where } = {}) => (byUid[uid] ?? []).filter((row) => matches(row, where)),
    }),
  };
  strapi.sessionManager = (origin) => ({
    invalidateRefreshToken: async (id) => calls.ended.push({ origin, id }),
  });
  strapi.eventHub = { emit: (name, payload) => calls.events.push({ name, payload }) };

  return { controller: administration({ strapi }), calls };
}

const ctxFor = ({ params = {}, body = {}, query = {}, user = ACTOR } = {}) => ({
  params,
  query,
  request: { body },
  state: { user },
  status: 200,
  body: null,
});

describe('acting on someone else’s second factor', () => {
  it('resets another administrator with the actor’s own code', async () => {
    const { controller, calls } = setup();
    const ctx = ctxFor({ params: { id: 2 }, body: { code: '123456' } });

    await controller.reset(ctx);

    assert.equal(ctx.status, 200);
    assert.deepEqual(calls.verified[0], { subjectType: 'admin', subjectId: 1, code: '123456', allowRecovery: false });
    assert.equal(calls.removed[0].subjectType, 'admin');
    assert.equal(calls.removed[0].subjectId, 2);
  });

  it('refuses without a code, and changes nothing', async () => {
    const { controller, calls } = setup();
    const ctx = ctxFor({ params: { id: 2 }, body: {} });

    await controller.reset(ctx);

    assert.equal(ctx.status, 400);
    assert.match(ctx.body.error.message, /own authenticator/);
    assert.equal(calls.removed.length, 0);
  });

  it('refuses an administrator who has no authenticator of their own', async () => {
    const { controller, calls } = setup({ actorEnrolled: false });
    const ctx = ctxFor({ params: { id: 2 }, body: { code: '123456' } });

    await controller.reset(ctx);

    assert.equal(ctx.status, 403);
    assert.match(ctx.body.error.message, /Set up your own authenticator/);
    assert.equal(calls.verified.length, 0, 'there is nothing to check a code against');
    assert.equal(calls.removed.length, 0);
  });

  /**
   * The panel's fetch client treats any 401 as an expired session, refreshes
   * it and sends the request again — so a 401 here would submit the same wrong
   * code twice and count it twice towards the actor's lockout.
   */
  it('answers a wrong code with 403, never 401', async () => {
    const { controller, calls } = setup({ codeIsRight: false });
    const ctx = ctxFor({ params: { id: 2 }, body: { code: '000000' } });

    await controller.reset(ctx);

    assert.equal(ctx.status, 403);
    assert.equal(ctx.body.error.status, 403, 'the panel reads the status from the body');
    assert.equal(ctx.body.error.message, 'That code is not valid');
    assert.equal(calls.removed.length, 0);
  });

  it('will not reset the actor’s own factor, which is what My authenticator is for', async () => {
    const { controller, calls } = setup();
    const ctx = ctxFor({ params: { id: 1 }, body: { code: '123456' } });

    await controller.reset(ctx);

    assert.equal(ctx.status, 400);
    assert.match(ctx.body.error.message, /your own authenticator/);
    assert.equal(calls.removed.length, 0);
  });

  it('does not spend the actor’s code on a request it was going to refuse', async () => {
    const { controller, calls } = setup();

    await controller.reset(ctxFor({ params: { id: 1 }, body: { code: '123456' } }));
    await controller.resetUser(ctxFor({ params: { id: 999 }, body: { code: '123456' } }));

    assert.equal(calls.verified.length, 0, 'a code is thirty seconds to replace once spent');
  });

  it('needs the code to unlock, too', async () => {
    const { controller, calls } = setup({ codeIsRight: false });
    const ctx = ctxFor({ params: { id: 2 }, body: { code: '000000' } });

    await controller.unlock(ctx);

    assert.equal(ctx.status, 403);
    assert.equal(calls.unlocked.length, 0);
  });

  it('records who did it', async () => {
    const { controller, calls } = setup();
    await controller.reset(ctxFor({ params: { id: 2 }, body: { code: '123456' } }));

    assert.equal(calls.events[0].name, 'two-factor.factor.reset');
    assert.deepEqual(calls.events[0].payload, {
      subjectType: 'admin',
      subjectId: '2',
      actorId: '1',
      sessionsEnded: false,
    });
  });
});

describe('website accounts', () => {
  const USERS = [
    { id: 5, documentId: 'doc-five', email: 'sam@example.com', username: 'sam', blocked: false },
    { id: 6, documentId: 'doc-six', email: 'alex@example.com', username: 'alex', blocked: false },
  ];

  it('resets a website account with the actor’s own code', async () => {
    const { controller, calls } = setup({ users: USERS });
    const ctx = ctxFor({ params: { id: 5 }, body: { code: '123456' } });

    await controller.resetUser(ctx);

    assert.equal(ctx.status, 200);
    assert.equal(calls.removed[0].subjectType, 'user');
    assert.equal(calls.removed[0].subjectId, 5);
  });

  it('finds the account by document id, which is what the Content Manager knows', async () => {
    const { controller, calls } = setup({ users: USERS });
    const ctx = ctxFor({ params: { id: 'doc-six' }, body: { code: '123456' } });

    await controller.resetUser(ctx);

    assert.equal(calls.removed[0].subjectId, 6);
  });

  it('refuses a website reset without the actor’s own code', async () => {
    const { controller, calls } = setup({ users: USERS, codeIsRight: false });
    const ctx = ctxFor({ params: { id: 5 }, body: { code: '000000' } });

    await controller.resetUser(ctx);

    assert.equal(ctx.status, 403);
    assert.equal(calls.removed.length, 0);
  });

  it('ends their sessions only when asked, and says whether it could', async () => {
    const { controller, calls } = setup({ users: USERS });
    const ctx = ctxFor({ params: { id: 5 }, body: { code: '123456', endSessions: true } });

    await controller.resetUser(ctx);

    assert.equal(ctx.body.data.sessionsEnded, true);
    assert.deepEqual(calls.ended, [{ origin: 'users-permissions', id: '5' }]);
  });

  it('does not end sessions unless asked', async () => {
    const { controller, calls } = setup({ users: USERS });
    await controller.resetUser(ctxFor({ params: { id: 5 }, body: { code: '123456' } }));
    assert.deepEqual(calls.ended, []);
  });

  it('answers 404 for an account that does not exist', async () => {
    const { controller } = setup({ users: USERS });
    const ctx = ctxFor({ params: { id: 999 }, body: { code: '123456' } });

    await controller.resetUser(ctx);

    assert.equal(ctx.status, 404);
  });

  it('lists accounts with a factor, and searches by email or username', async () => {
    const { controller } = setup({ users: USERS });

    const all = ctxFor({ query: {} });
    await controller.users(all);
    assert.equal(all.body.data.length, 2);

    const found = ctxFor({ query: { search: 'ALEX' } });
    await controller.users(found);
    assert.deepEqual(found.body.data.map((row) => row.email), ['alex@example.com']);

    const none = ctxFor({ query: { search: 'nobody' } });
    await controller.users(none);
    assert.deepEqual(none.body.data, []);
    assert.equal(none.body.meta.pagination.total, 0);
  });

  it('shows one account’s status for the Content Manager panel', async () => {
    const { controller } = setup({ users: USERS });
    const ctx = ctxFor({ params: { id: 'doc-five' } });

    await controller.user(ctx);

    assert.equal(ctx.body.data.email, 'sam@example.com');
    assert.equal(ctx.body.data.enrolled, true);
    assert.equal(ctx.body.data.recoveryCodesRemaining, 7);
  });
});
