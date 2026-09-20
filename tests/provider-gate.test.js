'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const providerCallbackGate = require('../server/src/gates/provider-callback');
const { createStrapi } = require('./harness');

/**
 * Signing in through Google must not be a way round the second factor.
 *
 * The password sign-in is gated before anything is granted. A provider sign-in
 * cannot be: the provider decides who this is inside the handler, which then
 * mints a token. So the gate lets the handler run and takes back what it
 * produced — and these tests are about whether it takes back *all* of it.
 */
const USER = { id: 7, email: 'sam@example.com', username: 'sam' };

/** A ctx shaped like Koa's, recording what the gate does to the response. */
function createContext({ cookiesAlreadySet } = {}) {
  const ctx = {
    status: 200,
    body: null,
    response: { headers: cookiesAlreadySet ? { 'set-cookie': cookiesAlreadySet } : {} },
    removed: [],
    set(key, value) {
      ctx.response.headers[String(key).toLowerCase()] = value;
    },
    remove(key) {
      ctx.removed.push(String(key).toLowerCase());
      delete ctx.response.headers[String(key).toLowerCase()];
    },
  };
  return ctx;
}

/** The handler users-permissions would run: it signs the person in. */
const providerSignsThemIn = (ctx, { cookie = 'strapi_up_refresh=abc; Path=/' } = {}) =>
  async () => {
    if (cookie) ctx.response.headers['set-cookie'] = [cookie];
    ctx.body = { jwt: 'the.real.jwt', user: USER };
  };

function setup({ enabled = true, enrolled = true, mustEnrol = false } = {}) {
  const invalidated = [];

  const strapi = createStrapi({
    services: {
      policy: {
        forUser: async () => ({
          enabled,
          enrolled,
          required: mustEnrol,
          mustPresent: enrolled,
          mustEnrol,
        }),
      },
      factors: {
        startEnrolment: async () => ({
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/x',
          qrDataUrl: 'data:image/png;base64,AAAA',
        }),
      },
    },
  });

  strapi.sessionManager = () => ({
    invalidateRefreshToken: async (userId) => invalidated.push(userId),
  });

  return { gate: providerCallbackGate({ strapi }), strapi, invalidated };
}

describe('signing in through a provider', () => {
  it('withholds the token and asks for the code instead', async () => {
    const { gate } = setup();
    const ctx = createContext();

    await gate(ctx, providerSignsThemIn(ctx));

    assert.equal(ctx.status, 401);
    assert.equal(ctx.body.error.name, 'TwoFactorRequiredError');
    assert.equal(ctx.body.data, null);
    // The whole point: the token the handler minted does not leave.
    assert.ok(!JSON.stringify(ctx.body).includes('the.real.jwt'));
  });

  it('drops every cookie the handler set', async () => {
    const { gate } = setup();
    const ctx = createContext();

    await gate(ctx, providerSignsThemIn(ctx));

    assert.ok(ctx.removed.includes('set-cookie'), 'the refresh cookie must not survive');
    assert.equal(ctx.response.headers['set-cookie'], undefined);
  });

  it('leaves cookies that were already there alone', async () => {
    const existing = ['something_else=1; Path=/'];
    const { gate } = setup();
    const ctx = createContext({ cookiesAlreadySet: existing });

    await gate(ctx, providerSignsThemIn(ctx));

    assert.deepEqual(ctx.response.headers['set-cookie'], existing);
  });

  it('invalidates the session the handler opened', async () => {
    const { gate, invalidated } = setup();
    const ctx = createContext();

    await gate(ctx, providerSignsThemIn(ctx));

    assert.deepEqual(invalidated, ['7']);
  });

  it('marks the challenge as coming from a provider', async () => {
    const { gate, strapi } = setup();
    const ctx = createContext();

    await gate(ctx, providerSignsThemIn(ctx));

    const claims = strapi.services.tokens.verifyChallenge(ctx.body.error.details.twoFactor.challenge);
    assert.equal(claims.pv, true, 'completing it hands back a session, so it has to be marked');
    assert.equal(claims.st, 'user');
    assert.equal(claims.sid, '7');
    assert.equal(ctx.body.error.details.twoFactor.via, 'provider');
  });

  it('lets somebody with no second factor straight through', async () => {
    const { gate, invalidated } = setup({ enrolled: false });
    const ctx = createContext();

    await gate(ctx, providerSignsThemIn(ctx));

    assert.equal(ctx.status, 200);
    assert.equal(ctx.body.jwt, 'the.real.jwt');
    assert.deepEqual(invalidated, [], 'nothing was taken back');
  });

  it('stays out of the way when the users surface is switched off', async () => {
    const { gate } = setup({ enabled: false });
    const ctx = createContext();

    await gate(ctx, providerSignsThemIn(ctx));

    assert.equal(ctx.body.jwt, 'the.real.jwt');
  });

  it('does nothing to a refusal', async () => {
    const { gate } = setup();
    const ctx = createContext();

    await gate(ctx, async () => {
      ctx.status = 400;
      ctx.body = { error: { message: 'That provider is disabled' } };
    });

    assert.equal(ctx.status, 400);
    assert.equal(ctx.body.error.message, 'That provider is disabled');
  });

  it('carries the enrolment when the policy says they must set one up', async () => {
    const { gate } = setup({ enrolled: false, mustEnrol: true });
    const ctx = createContext();

    await gate(ctx, providerSignsThemIn(ctx));

    assert.equal(ctx.status, 401);
    const twoFactor = ctx.body.error.details.twoFactor;
    assert.equal(twoFactor.enrolmentRequired, true);
    assert.ok(twoFactor.enrolment.qrDataUrl.startsWith('data:image/png;base64,'));
  });
});
