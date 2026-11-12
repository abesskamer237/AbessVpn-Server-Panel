import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Run against an isolated server and disposable database; never touch production.
const dataDir = await mkdtemp(path.join(tmpdir(), 'abess-security-'));
const password = randomBytes(24).toString('hex');
const env = { ...process.env, ALLOW_JSON_STORAGE:'true', NODE_ENV: 'production', PORT: '3198', DATA_DIR: dataDir,
  ADMIN_EMAIL: 'audit@example.test', ADMIN_INITIAL_PASSWORD: password,
  MASTER_SECRET: randomBytes(32).toString('hex'), VPN_DOMAIN: 'vpn.example.test',
  TELEGRAM_BOT_TOKEN: '', TELEGRAM_ADMIN_IDS: '' };
const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', c => { logs += c; });
server.stderr.on('data', c => { logs += c; });
const base = 'http://127.0.0.1:3198';
async function request(route, body, token) {
  return fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000) });
}
async function login() {
  return request('/api/v1/auth/login', { email: env.ADMIN_EMAIL, password });
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { ready = (await request('/api/v1/ping')).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, 'server must start');
  await writeFile(path.join(dataDir, 'xray-ready'), 'audit-generation');
  assert.equal((await (await request('/api/v1/ping')).json()).dataPlane, 'not-ready');
  for (const [generation, observedAt, expected] of [
    ['audit-generation', new Date().toISOString(), 'not-ready'],
    ['wrong-generation', new Date().toISOString(), 'not-ready'],
    ['audit-generation', new Date(Date.now() - 60000).toISOString(), 'not-ready'],
  ]) {
    await writeFile(path.join(dataDir, 'xray-stats.json'), JSON.stringify({ generation, observedAt, stat: [] }));
    assert.equal((await (await request('/api/v1/ping')).json()).dataPlane, expected);
  }
  const session = await (await login()).json();
  assert.ok(session.token);
  assert.equal((await request('/api/v1/auth/logout', {}, session.token)).status, 204);
  assert.equal((await request('/api/v1/auth/me', undefined, session.token)).status, 401, 'logout revokes bearer token');
  const active = await (await login()).json();
  const usersPath = path.join(dataDir, 'users.json');
  const users = JSON.parse(await readFile(usersPath, 'utf8'));
  for (const invalidUsers of [[], [{ ...users[0], parentId: users[0].id }],
    [{ ...users[0], parentId: 'missing' }], [users[0], users[0]],
    [{ ...users[0], role: 'RESELLER' }], [{ ...users[0], credits: -1 }]]) {
    for (const route of ['/api/v1/admin/backup/restore', '/api/v1/admin/system/restore']) {
      assert.equal((await request(route, { users: invalidUsers, tokens: [] }, active.token)).status, 400);
      assert.deepEqual(JSON.parse(await readFile(usersPath, 'utf8')), users, 'invalid restore must not mutate users');
    }
  }
  for (const parentId of [users[0].id, 'missing']) {
    await writeFile(usersPath, JSON.stringify([{ ...users[0], parentId }]));
    assert.equal((await login()).status, 403, 'cyclic or orphaned hierarchy fails promptly');
  }
  await writeFile(usersPath, JSON.stringify(users));
  assert.equal((await request('/api/v1/admin/backup/restore', { users, tokens: [] }, active.token)).status, 200);
  assert.equal((await request('/api/v1/auth/me', undefined, active.token)).status, 401, 'restoration revokes prior sessions');
  console.log('Security regressions passed: logout, invalid restores, cycles, missing parents, session invalidation.');
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('close', resolve));
  await rm(dataDir, { recursive: true, force: true });
}
// Startup errors must terminate rather than leave the cleanup timer running.
const invalidDataDir = await mkdtemp(path.join(tmpdir(), 'abess-invalid-'));
const invalid = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  env: { ...env, DATA_DIR: invalidDataDir, VPN_DOMAIN: '' }, stdio: 'ignore' });
const timeout = setTimeout(() => invalid.kill('SIGKILL'), 5000);
const code = await new Promise(resolve => invalid.once('close', resolve));
clearTimeout(timeout);
await rm(invalidDataDir, { recursive: true, force: true });
assert.equal(code, 1, 'invalid startup configuration must exit with status 1');
console.log('Startup failure regression passed.');
