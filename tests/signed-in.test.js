'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const signedInGate = require('../server/src/gates/signed-in');

/**
 * The `/me` routes and who is asking.
 *
 * `auth: false` on those routes means no *permission* is required. It does not
 * mean Strapi authenticates the caller: its auth service returns before any
 * strategy runs when a route's `auth` is false, so `ctx.state.user` stays empty
 * unless something fills it. 0.4.x shipped believing otherwise, and every `/me`
 * call — status, enrolment, verification — refused the person it exists for
 * with "Sign in first" on a perfectly valid token.
 *
 * So these are about one question: does the bearer end up as the person, and
 * only ever the person the token names?
 */

const USER = { id: 7, email: 'sam@example.com', blocked: false };
const BLOCKED = { id: 9, email: 'blocked@example.com', blocked: true };

function createStrapi({ verify, users = [USER, BLOCKED] } = {}) {
  return {
    plugin: (name) =>
      name === 'users-permissions'
        ? { service: () => ({ verify: verify ?? (async (token) => (token === 'good' ? { id: USER.id } : Promise.reject(new Error('Invalid token')))) }) }
        : null,
    db: {
      query: () => ({
        findOne: async ({ where }) => users.find((user) => user.id === where.id) ?? null,
      }),
    },
  };
}

const createContext = (authorization) => ({
  state: {},
  request: { header: authorization ? { authorization } : {} },
});

async function run(ctx, strapi) {
  let called = false;
  await signedInGate({ strapi })(ctx, async () => {
    called = true;
  });
  return called;
}

describe('the /me gate', () => {
  it('makes a valid token the person it names', async () => {
    const ctx = createContext('Bearer good');
    assert.equal(await run(ctx, createStrapi()), true, 'the request carries on');
    assert.equal(ctx.state.user?.id, USER.id);
  });

  it('accepts the scheme however it is cased', async () => {
    const ctx = createContext('bearer good');
    await run(ctx, createStrapi());
    assert.equal(ctx.state.user?.id, USER.id);
  });

  it('leaves a request with no token as nobody', async () => {
    const ctx = createContext();
    assert.equal(await run(ctx, createStrapi()), true, 'it does not refuse; the controller does');
    assert.equal(ctx.state.user, undefined);
  });

  it('leaves a token it cannot verify as nobody', async () => {
    const ctx = createContext('Bearer forged');
    await run(ctx, createStrapi());
    assert.equal(ctx.state.user, undefined);
  });

  it('ignores a scheme that is not Bearer', async () => {
    const ctx = createContext('Basic good');
    await run(ctx, createStrapi());
    assert.equal(ctx.state.user, undefined);
  });

  it('leaves a blocked account as nobody, as the login path does', async () => {
    const ctx = createContext('Bearer good');
    const strapi = createStrapi({ verify: async () => ({ id: BLOCKED.id }) });
    await run(ctx, strapi);
    assert.equal(ctx.state.user, undefined);
  });

  it('leaves a token naming an account that is gone as nobody', async () => {
    const ctx = createContext('Bearer good');
    const strapi = createStrapi({ verify: async () => ({ id: 404 }) });
    await run(ctx, strapi);
    assert.equal(ctx.state.user, undefined);
  });

  it('does not overwrite an identity the app already established', async () => {
    const ctx = createContext('Bearer good');
    ctx.state.user = { id: 1, email: 'already@example.com' };
    await run(ctx, createStrapi());
    assert.equal(ctx.state.user.id, 1);
  });

  it('carries on when users-permissions is not installed', async () => {
    const ctx = createContext('Bearer good');
    const strapi = { plugin: () => null, db: { query: () => ({ findOne: async () => null }) } };
    assert.equal(await run(ctx, strapi), true);
    assert.equal(ctx.state.user, undefined);
  });

  it('survives a database that will not answer', async () => {
    const ctx = createContext('Bearer good');
    const strapi = createStrapi();
    strapi.db.query = () => ({ findOne: async () => { throw new Error('no connection'); } });
    assert.equal(await run(ctx, strapi), true, 'a refusal, not a 500');
    assert.equal(ctx.state.user, undefined);
  });
});

describe('the routes it is attached to', () => {
  it('keeps auth:false on /me, so no permission has to be granted', () => {
    const routes = require('../server/src/routes/content-api').routes;
    const me = routes.filter((route) => route.path.startsWith('/me'));
    assert.ok(me.length >= 6, 'the /me surface is still there');
    for (const route of me) assert.equal(route.config.auth, false, `${route.path} needs no permission`);
  });

  it('attaches the gate to every one of them', () => {
    const attached = [];
    const strapi = {
      admin: { routes: [{ method: 'POST', path: '/login', config: {} }] },
      plugins: {},
      plugin: () => null,
      log: { warn: () => {} },
      db: { query: () => ({ findOne: async () => null }) },
    };
    require('../server/src/register')({ strapi });
    for (const route of require('../server/src/routes/content-api').routes) {
      if (route.path.startsWith('/me')) attached.push((route.config.middlewares || []).length);
    }
    assert.ok(attached.length >= 6 && attached.every((count) => count >= 1), `every /me route is gated (${attached.join(',')})`);
  });
});
