'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { createStrapi } = require('./harness');

describe('crypto-box', () => {
  it('gives back what it was given', () => {
    const box = createStrapi().services['crypto-box'];
    const secret = 'JBSWY3DPEHPK3PXP';

    const packed = box.encrypt(secret);
    assert.notEqual(packed, secret);
    assert.match(packed, /^v1\./);
    assert.equal(box.decrypt(packed), secret);
  });

  it('gives a different ciphertext every time', () => {
    const box = createStrapi().services['crypto-box'];
    assert.notEqual(box.encrypt('JBSWY3DPEHPK3PXP'), box.encrypt('JBSWY3DPEHPK3PXP'));
  });

  it('refuses a tampered ciphertext rather than returning nonsense', () => {
    const box = createStrapi().services['crypto-box'];
    const [version, iv, tag, ciphertext] = box.encrypt('JBSWY3DPEHPK3PXP').split('.');

    const flipped = Buffer.from(ciphertext, 'base64url');
    flipped[0] ^= 0xff;

    assert.throws(() => box.decrypt([version, iv, tag, flipped.toString('base64url')].join('.')));
  });

  it('will not open a secret encrypted under different key material', () => {
    const packed = createStrapi().services['crypto-box'].encrypt('JBSWY3DPEHPK3PXP');
    const other = createStrapi({ config: { 'admin.auth.secret': 'a completely different secret' } });

    assert.throws(() => other.services['crypto-box'].decrypt(packed));
  });

  it('hashes recovery codes past their formatting', () => {
    const box = createStrapi().services['crypto-box'];
    const canonical = box.hashRecoveryCode('ABCD-EFGH-JKLM');

    assert.equal(box.hashRecoveryCode('abcdefghjklm'), canonical);
    assert.equal(box.hashRecoveryCode('ABCD EFGH JKLM'), canonical);
    assert.notEqual(box.hashRecoveryCode('ABCD-EFGH-JKLN'), canonical);
  });

  it('compares without throwing on a length mismatch', () => {
    const box = createStrapi().services['crypto-box'];
    assert.equal(box.equals('abc', 'abc'), true);
    assert.equal(box.equals('abc', 'abcd'), false);
    assert.equal(box.equals('abc', 'abd'), false);
  });
});
