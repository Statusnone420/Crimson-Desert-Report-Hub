import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const magic = Buffer.from('CRHBAK1\n');
const iterations = 600000;

export function encrypt(plain, passphrase) {
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const header = Buffer.from(JSON.stringify({ version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-HMAC-SHA256', iterations, salt: salt.toString('base64'), nonce: nonce.toString('base64'), payload: 'zip' }));
  const key = crypto.pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256');
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(header);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(header.length);
    return Buffer.concat([magic, length, header, ciphertext, cipher.getAuthTag()]);
  } finally { key.fill(0); }
}

export function decrypt(archive, passphrase) {
  if (archive.length < 44 || !archive.subarray(0, 8).equals(magic)) throw new Error('Invalid backup archive.');
  const headerLength = archive.readUInt32BE(8);
  if (headerLength > 4096 || 12 + headerLength + 16 > archive.length) throw new Error('Invalid backup header.');
  const header = archive.subarray(12, 12 + headerLength);
  const settings = JSON.parse(header.toString('utf8'));
  if (settings.version !== 1 || settings.cipher !== 'AES-256-GCM' || settings.kdf !== 'PBKDF2-HMAC-SHA256' || settings.iterations !== iterations || settings.payload !== 'zip') throw new Error('Unsupported backup settings.');
  const salt = Buffer.from(settings.salt, 'base64');
  const nonce = Buffer.from(settings.nonce, 'base64');
  if (salt.length !== 16 || nonce.length !== 12) throw new Error('Invalid backup parameters.');
  const key = crypto.pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(header);
    decipher.setAuthTag(archive.subarray(-16));
    return Buffer.concat([decipher.update(archive.subarray(12 + headerLength, -16)), decipher.final()]);
  } finally { key.fill(0); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, input, output] = process.argv.slice(2);
  const passphrase = process.env.CRH_BACKUP_PASSPHRASE;
  delete process.env.CRH_BACKUP_PASSPHRASE;
  if (!passphrase || passphrase.length < 16) throw new Error('A backup passphrase is required.');
  const bytes = fs.readFileSync(input);
  const result = mode === 'encrypt' ? encrypt(bytes, passphrase) : mode === 'decrypt' ? decrypt(bytes, passphrase) : null;
  if (!result) throw new Error('Use encrypt or decrypt.');
  fs.writeFileSync(output, result, { flag: 'wx' });
  console.log(JSON.stringify({ operation: mode, bytes: result.length, sha256: crypto.createHash('sha256').update(result).digest('hex') }));
  bytes.fill(0);
  result.fill(0);
}
