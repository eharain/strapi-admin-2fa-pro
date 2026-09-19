'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { createStrapi } = require('./harness');

describe('totp', () => {
  it('accepts a code it just generated', async () => {
    const totp = createStrapi().services.totp;
    const secret = totp.generateSecret();
    const at = Date.now();

    const result = await totp.verify({ token: await totp.generate(secret, at), secret, at });
    assert.equal(result.valid, true);
    assert.equal(typeof result.timeStep, 'number');
  });

  it('refuses the same code twice once the counter is kept', async () => {
    const totp = createStrapi().services.totp;
    const secret = totp.generateSecret();
    const at = Date.now();
    const code = await totp.generate(secret, at);

    const first = await totp.verify({ token: code, secret, at });
    assert.equal(first.valid, true);

    const second = await totp.verify({ token: code, secret, at, lastCounter: first.timeStep });
    assert.equal(second.valid, false);
    assert.equal(second.reason, 'replayed');
  });

  it('tolerates a phone whose clock is a step out', async () => {
    const totp = createStrapi().services.totp;
    const secret = totp.generateSecret();
    const now = Date.now();

    const early = await totp.generate(secret, now - 30_000);
    assert.equal((await totp.verify({ token: early, secret, at: now })).valid, true);
  });

  it('refuses a code from far enough back', async () => {
    const totp = createStrapi().services.totp;
    const secret = totp.generateSecret();
    const now = Date.now();

    const stale = await totp.generate(secret, now - 10 * 60_000);
    const result = await totp.verify({ token: stale, secret, at: now });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'mismatch');
  });

  it('refuses anything that is not six digits without consulting the secret', async () => {
    const totp = createStrapi().services.totp;
    const secret = totp.generateSecret();

    for (const token of ['', '12345', '1234567', 'abcdef', '12 34 5', null, undefined]) {
      const result = await totp.verify({ token, secret });
      assert.equal(result.valid, false, `expected ${JSON.stringify(token)} to be refused`);
      assert.equal(result.reason, 'malformed');
    }
  });

  it('ignores the spaces an authenticator app puts in the middle', async () => {
    const totp = createStrapi().services.totp;
    const secret = totp.generateSecret();
    const at = Date.now();
    const code = await totp.generate(secret, at);

    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    assert.equal((await totp.verify({ token: spaced, secret, at })).valid, true);
  });

  it('builds a key URI an authenticator app can read', () => {
    const totp = createStrapi({ config: { 'plugin::two-factor.issuer': 'strapi.example.com' } }).services
      .totp;
    const uri = totp.keyUri('someone@example.com', totp.generateSecret());

    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.match(uri, /issuer=strapi\.example\.com/);
    assert.match(uri, /secret=[A-Z2-7]+/);
    // Six digits over thirty seconds is what every app assumes, so the library
    // leaves them out of the URI. Anything else has to be spelled out — see below.
    assert.doesNotMatch(uri, /digits=/);
    assert.doesNotMatch(uri, /period=/);
  });

  it('spells out non-default parameters, which an app cannot guess', () => {
    const totp = createStrapi({
      config: {
        'plugin::two-factor.issuer': 'strapi.example.com',
        'plugin::two-factor.digits': 8,
        'plugin::two-factor.period': 60,
      },
    }).services.totp;

    const uri = totp.keyUri('someone@example.com', totp.generateSecret());
    assert.match(uri, /digits=8/);
    assert.match(uri, /period=60/);
  });

  it('names the deployment in the issuer rather than saying "Strapi"', () => {
    const totp = createStrapi({ config: { 'admin.url': 'https://strapi.example.com/admin' } }).services.totp;
    assert.equal(totp.issuer(), 'strapi.example.com');
  });
});
