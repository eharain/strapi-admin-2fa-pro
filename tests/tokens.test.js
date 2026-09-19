'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { createStrapi } = require('./harness');

const subject = { subjectType: 'admin', subjectId: 7, email: 'Someone@Example.com' };

describe('challenge and proof tokens', () => {
  it('round-trips a challenge and normalises the address', () => {
    const tokens = createStrapi().services.tokens;
    const { token, expiresIn } = tokens.issueChallenge(subject);

    const claims = tokens.verifyChallenge(token);
    assert.equal(claims.st, 'admin');
    assert.equal(claims.sid, '7');
    assert.equal(claims.em, 'someone@example.com');
    assert.equal(claims.en, false);
    assert.equal(expiresIn, 180);
  });

  it('refuses a challenge whose signature has been touched', () => {
    const tokens = createStrapi().services.tokens;
    const { token } = tokens.issueChallenge(subject);
    const [payload] = token.split('.');

    assert.throws(() => tokens.verifyChallenge(`${payload}.${Buffer.from('nope').toString('base64url')}`));
  });

  it('refuses a challenge whose payload has been rewritten', () => {
    const tokens = createStrapi().services.tokens;
    const { token } = tokens.issueChallenge(subject);
    const [payload, signature] = token.split('.');

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claims.sid = '1';
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');

    assert.throws(() => tokens.verifyChallenge(`${forged}.${signature}`));
  });

  it('refuses an expired challenge', () => {
    const tokens = createStrapi({ config: { 'plugin::two-factor.challengeTtlSeconds': 0 } }).services.tokens;
    const { token } = tokens.issueChallenge(subject);

    assert.throws(() => tokens.verifyChallenge(token), /timed out/);
  });

  it('will not take a proof where a challenge is wanted', () => {
    const tokens = createStrapi().services.tokens;
    const { token } = tokens.issueProof(subject);

    assert.throws(() => tokens.verifyChallenge(token));
  });

  it('will not take a challenge where a proof is wanted', () => {
    const tokens = createStrapi().services.tokens;
    const { token } = tokens.issueChallenge(subject);

    assert.throws(() => tokens.verifyProof(token, { subjectType: 'admin', email: subject.email }));
  });

  it('binds a proof to the account it was issued for', () => {
    const tokens = createStrapi().services.tokens;
    const { token } = tokens.issueProof(subject);

    assert.throws(() => tokens.verifyProof(token, { subjectType: 'admin', email: 'someone.else@example.com' }));
    assert.throws(() => tokens.verifyProof(token, { subjectType: 'user', email: subject.email }));
  });

  it('spends a proof on first use', () => {
    const tokens = createStrapi().services.tokens;
    const { token } = tokens.issueProof(subject);

    const claims = tokens.verifyProof(token, { subjectType: 'admin', email: subject.email });
    assert.equal(claims.sid, '7');

    assert.throws(
      () => tokens.verifyProof(token, { subjectType: 'admin', email: subject.email }),
      /already been used/
    );
  });

  it('will not accept a token signed with other key material', () => {
    const issuer = createStrapi().services.tokens;
    const verifier = createStrapi({ config: { 'admin.auth.secret': 'another secret entirely' } }).services
      .tokens;

    const { token } = issuer.issueChallenge(subject);
    assert.throws(() => verifier.verifyChallenge(token));
  });
});
