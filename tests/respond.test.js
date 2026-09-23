'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { errors } = require('@strapi/utils');

const account = require('../server/src/controllers/account');
const { handled } = require('../server/src/utils/respond');
const { createStrapi } = require('./harness');

/**
 * A wrong code inside a signed-in admin panel must not come back as 401.
 *
 * The panel's fetch client takes the status from the response body, treats a
 * 401 as an expired session, refreshes it and sends the same request again —
 * so one mistyped code used to be submitted twice and counted twice, and
 * three typos locked somebody out of their own account.
 *
 * The users-permissions surface is the other way round: a service using this
 * plugin as its factor store reads 401 as "wrong code", so it stays 401.
 */
const wrongCode = () => {
  throw new errors.UnauthorizedError('That code is not valid');
};

const ctxFor = (body = {}) => ({
  request: { body },
  state: { user: { id: 3, email: 'sam@example.com' } },
  status: 200,
  body: null,
});

describe('handled()', () => {
  it('keeps 401 by default', async () => {
    const ctx = ctxFor();
    await handled(wrongCode)(ctx);
    assert.equal(ctx.status, 401);
    assert.equal(ctx.body.error.status, 401);
  });

  it('answers 403 inside a session, in the body as well as the status line', async () => {
    const ctx = ctxFor();
    await handled(wrongCode, { insideSession: true })(ctx);
    assert.equal(ctx.status, 403);
    assert.equal(ctx.body.error.status, 403);
    assert.equal(ctx.body.error.message, 'That code is not valid', 'the reason survives');
  });

  it('leaves every other refusal alone inside a session', async () => {
    const ctx = ctxFor();
    await handled(
      () => {
        throw new errors.NotFoundError('No such account');
      },
      { insideSession: true }
    )(ctx);
    assert.equal(ctx.status, 404);
  });
});

describe('the account endpoints, per surface', () => {
  const surface = (subjectType) => {
    const strapi = createStrapi({
      services: {
        factors: {
          isEnrolled: async () => true,
          verifyCode: async () => wrongCode(),
          remove: async () => {},
        },
        policy: {
          forAdmin: async () => ({ required: false }),
          forUser: async () => ({ required: false, enabled: true }),
        },
      },
    });
    return account({ strapi, subjectType });
  };

  it('answers a wrong code with 403 on the admin panel', async () => {
    const ctx = ctxFor({ code: '000000' });
    await surface('admin').disable(ctx);
    assert.equal(ctx.status, 403);
  });

  it('keeps 401 for website accounts, which callers already read', async () => {
    const ctx = ctxFor({ code: '000000' });
    await surface('user').disable(ctx);
    assert.equal(ctx.status, 401);
  });
});
