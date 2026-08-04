import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from('radiotracker:missevan-credential:v1', 'utf8');

export function decodeCredentialKey(base64Key) {
  if (typeof base64Key !== 'string' || !base64Key.trim()) {
    throw new Error('缺少 CREDENTIAL_ENCRYPTION_KEY');
  }
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY 必须是 32 字节的 Base64 密钥');
  return key;
}

export function encryptCredential(value, base64Key) {
  const key = decodeCredentialKey(base64Key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(AAD);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    credential_ciphertext: encrypted.toString('base64'),
    credential_iv: iv.toString('base64'),
    credential_tag: cipher.getAuthTag().toString('base64'),
    encryption_version: 1,
  };
}

export function decryptCredential(record, base64Key) {
  if (Number(record.encryption_version) !== 1) throw new Error('不支持的凭据加密版本');
  const key = decodeCredentialKey(base64Key);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(record.credential_iv, 'base64'),
  );
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(record.credential_tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.credential_ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}
