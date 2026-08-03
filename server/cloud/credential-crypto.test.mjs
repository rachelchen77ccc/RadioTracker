import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { decodeCredentialKey, decryptCredential, encryptCredential } from './credential-crypto.js';

test('猫耳登录信息可加密并还原，密文不出现 Cookie 原文', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const original = { cookie: 'token=test-only-value', userId: '12345678' };
  const encrypted = encryptCredential(original, key);

  assert.equal(JSON.stringify(encrypted).includes('test-only-value'), false);
  assert.deepEqual(decryptCredential(encrypted, key), original);
});

test('密文被修改后认证失败', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const encrypted = encryptCredential({ cookie: 'secret' }, key);
  encrypted.credential_tag = Buffer.from('invalid-auth-tag').toString('base64');
  assert.throws(() => decryptCredential(encrypted, key));
});

test('只接受 32 字节 Base64 密钥', () => {
  assert.throws(() => decodeCredentialKey(Buffer.from('short').toString('base64')));
});
