#!/usr/bin/env node
/**
 * Offline MASTER_SECRET rotation for ABESS VPN.
 *
 * Stop the API container before running this script. It rewrites only
 * data/tokens.json and removes the obsolete secretPassphrase property from
 * data/config.json. The old token file is preserved in an AES-256-GCM backup
 * encrypted with the NEW secret.
 *
 * Required environment:
 *   DATA_DIR
 *   MASTER_SECRET_OLD
 *   MASTER_SECRET_NEW
 *
 * No secret value is printed or written to the terminal.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIN_SECRET_LENGTH = 32;

function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptV2(plaintext, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `abess://v2.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptLink(link, secret) {
  if (typeof link !== 'string' || !link.startsWith('abess://')) {
    throw new Error('Un lien chiffré ABESS attendu.');
  }

  const payload = link.slice('abess://'.length);
  const key = deriveKey(secret);

  if (payload.startsWith('v2.')) {
    const parts = payload.split('.');
    if (parts.length !== 4) throw new Error('Format AES-GCM invalide.');
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error('Champs AES-GCM invalides.');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  // Legacy AES-256-CBC links: base64(iv).base64(ciphertext)
  const separator = payload.indexOf('.');
  if (separator <= 0 || separator === payload.length - 1) {
    throw new Error('Format legacy AES-CBC invalide.');
  }
  const iv = Buffer.from(payload.slice(0, separator), 'base64');
  const ciphertext = payload.slice(separator + 1);
  if (iv.length !== 16 || !ciphertext) throw new Error('Champs AES-CBC invalides.');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return decipher.update(ciphertext, 'base64', 'utf8') + decipher.final('utf8');
}

function encryptBackup(plaintext, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    'abess-backup-v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptBackup(envelope, secret) {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== 'abess-backup-v1') {
    throw new Error('Archive de pré-rotation invalide.');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

function writeAtomically(filePath, text) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

function rotateMasterSecret({ dataDir, oldSecret, newSecret }) {
  if (!oldSecret || oldSecret.length < MIN_SECRET_LENGTH) {
    throw new Error('MASTER_SECRET_OLD doit contenir au moins 32 caractères.');
  }
  if (!newSecret || newSecret.length < MIN_SECRET_LENGTH) {
    throw new Error('MASTER_SECRET_NEW doit contenir au moins 32 caractères.');
  }
  if (oldSecret === newSecret) {
    throw new Error('Le nouveau secret doit être différent de l’ancien.');
  }

  const tokensFile = path.resolve(dataDir, 'tokens.json');
  const configFile = path.resolve(dataDir, 'config.json');
  const backupsDir = path.resolve(dataDir, 'backups');

  if (!fs.existsSync(tokensFile)) throw new Error('data/tokens.json est introuvable.');
  const originalText = fs.readFileSync(tokensFile, 'utf8');
  const tokens = JSON.parse(originalText);
  if (!Array.isArray(tokens)) throw new Error('data/tokens.json ne contient pas un tableau.');

  let config = null;
  if (fs.existsSync(configFile)) {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('data/config.json ne contient pas un objet JSON valide.');
    }
  }

  let rotatedLinks = 0;
  const updatedTokens = tokens.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`Enregistrement de licence invalide à l’index ${index}.`);
    }
    const updated = { ...record };
    const encryptedLink = updated.encryptedLink;

    if (typeof encryptedLink === 'string' && encryptedLink.length > 0) {
      const plaintext = decryptLink(encryptedLink, oldSecret);
      JSON.parse(plaintext); // Fail before any write if the payload is not valid JSON.
      updated.encryptedLink = encryptV2(plaintext, newSecret);
      if (decryptLink(updated.encryptedLink, newSecret) !== plaintext) {
        throw new Error(`Échec de vérification du lien de la licence à l’index ${index}.`);
      }
      rotatedLinks++;
    }

    // SSH provisioning is retired. Remove the stored clear-text credential
    // while preserving the remaining metadata for audit/history.
    if (updated.sshConfig && typeof updated.sshConfig === 'object') {
      updated.sshConfig = { ...updated.sshConfig, sshPassword: '' };
    }
    return updated;
  });

  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(backupsDir, 0o700); } catch {}

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `pre-master-secret-rotation-${timestamp}.json.enc`);
  const backupPayload = JSON.stringify({
    timestamp: new Date().toISOString(),
    purpose: 'Encrypted pre-rotation token snapshot',
    tokens,
  });
  fs.writeFileSync(backupPath, encryptBackup(backupPayload, newSecret), {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });

  writeAtomically(tokensFile, JSON.stringify(updatedTokens, null, 2) + '\n');

  if (config) {
    delete config.secretPassphrase;
    writeAtomically(configFile, JSON.stringify(config, null, 2) + '\n');
  }

  return { rotatedLinks, backupPath };
}

function selfTest() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abess-secret-rotation-'));
  const oldSecret = 'self-test-old-secret-0123456789abcdef';
  const newSecret = 'self-test-new-secret-0123456789abcdef';

  function legacyEncrypt(plaintext, secret) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', deriveKey(secret), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return `abess://${iv.toString('base64')}.${ciphertext.toString('base64')}`;
  }

  try {
    fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
    const payloadA = JSON.stringify({ token: 'ABESS-SELFTEST-A', v: 2 });
    const payloadB = JSON.stringify({ token: 'ABESS-SELFTEST-B', v: 2 });
    const tokens = [
      { id: 'a', encryptedLink: encryptV2(payloadA, oldSecret) },
      {
        id: 'b',
        encryptedLink: legacyEncrypt(payloadB, oldSecret),
        sshConfig: { sshUsername: 'legacy', sshPassword: 'plaintext-self-test' },
      },
    ];
    fs.writeFileSync(path.join(dataDir, 'tokens.json'), JSON.stringify(tokens));
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
      serverHost: 'vpn.example.test',
      secretPassphrase: oldSecret,
    }));

    const result = rotateMasterSecret({ dataDir, oldSecret, newSecret });
    const updated = JSON.parse(fs.readFileSync(path.join(dataDir, 'tokens.json'), 'utf8'));
    if (result.rotatedLinks !== 2) throw new Error('Self-test: link count mismatch.');
    if (decryptLink(updated[0].encryptedLink, newSecret) !== payloadA) throw new Error('Self-test: GCM payload mismatch.');
    if (decryptLink(updated[1].encryptedLink, newSecret) !== payloadB) throw new Error('Self-test: CBC migration mismatch.');
    if (updated[1].sshConfig.sshPassword !== '') throw new Error('Self-test: SSH password was not cleared.');
    const updatedConfig = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    if ('secretPassphrase' in updatedConfig) throw new Error('Self-test: config secret was not removed.');
    const backupEnvelope = fs.readFileSync(result.backupPath, 'utf8');
    const backup = JSON.parse(decryptBackup(backupEnvelope, newSecret));
    if (backup.tokens.length !== 2) throw new Error('Self-test: encrypted backup is incomplete.');

    console.log('MASTER_SECRET rotation self-test passed (AES-GCM, legacy AES-CBC, encrypted backup, SSH redaction).');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  try {
    const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
    const result = rotateMasterSecret({
      dataDir,
      oldSecret: process.env.MASTER_SECRET_OLD || '',
      newSecret: process.env.MASTER_SECRET_NEW || '',
    });
    console.log(`Rotation terminée : ${result.rotatedLinks} lien(s) ABESS rechiffré(s).`);
    console.log(`Sauvegarde chiffrée créée : ${result.backupPath}`);
    console.log('Définissez ensuite MASTER_SECRET sur la nouvelle valeur dans .env, puis redémarrez le service API.');
  } catch (error) {
    console.error(`Échec de rotation : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
    process.exitCode = 1;
  }
}
