import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';

const base = 'http://127.0.0.1:3187';
const dataDir = process.env.DATA_DIR;

const pingResponse = await fetch(`${base}/api/v1/ping`);
assert.equal(pingResponse.status, 200, 'ping route must return HTTP 200');
const ping = await pingResponse.json();
assert.equal(ping.ok, true);
assert.equal(ping.dataPlane, 'not-ready', 'the control plane must not claim Xray is ready without its sidecar');

const allowedOrigin = `https://${process.env.VPN_DOMAIN}`;
const allowedCors = await fetch(`${base}/api/v1/ping`, {
  headers: { Origin: allowedOrigin },
});
assert.equal(allowedCors.status, 200);
assert.equal(allowedCors.headers.get('access-control-allow-origin'), allowedOrigin);
const deniedCors = await fetch(`${base}/api/v1/ping`, {
  headers: { Origin: 'https://untrusted-site.example' },
});
assert.equal(deniedCors.status, 403, 'browser origins outside the allowlist must be rejected');

assert.ok(!fs.existsSync(`${dataDir}/xray-config.json`), 'startup must not generate a VPN service config');

const downloadResponse = await fetch(`${base}/api/v1/speedtest/download?bytes=1048576`);
assert.equal(downloadResponse.status, 200);
assert.equal((await downloadResponse.arrayBuffer()).byteLength, 1048576);

const uploadResponse = await fetch(`${base}/api/v1/speedtest/upload`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream' },
  body: Buffer.alloc(4096, 65),
});
assert.equal(uploadResponse.status, 200);
assert.equal((await uploadResponse.json()).receivedBytes, 4096);

const publicCreateToken = await fetch(`${base}/api/v1/client/create-token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'SHOULD_NOT_BE_CREATED', bandwidthGb: 100 }),
});
assert.equal(publicCreateToken.status, 403, 'unauthenticated token creation must be denied');

const trialResponse = await fetch(`${base}/api/v1/client/claim-free-trial`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ deviceId: 'TEST-DEVICE-123456' }),
});
assert.equal(trialResponse.status, 503, 'trial issuance must stay disabled until a real data plane is running');

const telemetryResponse = await fetch(`${base}/api/v1/client/telemetry`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
assert.equal(telemetryResponse.status, 400, 'telemetry must reject a missing token');

const loginResponse = await fetch(`${base}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'ci-admin@example.test', password: 'ci-only-password-please-ignore-123' }),
});
assert.equal(loginResponse.status, 200, 'environment-provisioned admin should be able to log in');
const login = await loginResponse.json();
assert.ok(login.token);

const adminHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${login.token}`,
};

// Batch issuance must reject unbounded values even for the unlimited Super Admin.
for (const payload of [
  { count: 0 },
  { count: 201 },
  { bandwidthGb: 'Infinity' },
  { bandwidthGb: 100001 },
  { days: 3651 },
  { deviceLimit: 11 },
]) {
  const response = await fetch(`${base}/api/v1/admin/tokens/batch`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 400, `batch must reject invalid input: ${JSON.stringify(payload)}`);
}

// Privilege regression checks: reseller sessions must never expose backups,
// audit trails, global onboarding requests or infrastructure diagnostics.
const invalidInitialCredit = await fetch(`${base}/api/v1/admin/resellers`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({
    email: 'ci-infinite-credit@example.test',
    password: 'ci-reseller-password-please-ignore-123',
    name: 'Invalid Credit Reseller',
    initialCredits: 'Infinity',
  }),
});
assert.equal(invalidInitialCredit.status, 400, 'initial reseller credit must be finite and bounded');

const resellerCreate = await fetch(`${base}/api/v1/admin/resellers`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({
    email: 'ci-reseller@example.test',
    password: 'ci-reseller-password-please-ignore-123',
    name: 'CI Reseller',
    initialCredits: 20,
  }),
});
assert.equal(resellerCreate.status, 201);
const createdReseller = await resellerCreate.json();
const invalidResellerStatus = await fetch(`${base}/api/v1/admin/resellers/${createdReseller.id}/status`, {
  method: 'PUT',
  headers: adminHeaders,
  body: JSON.stringify({ status: 'disabled' }),
});
assert.equal(invalidResellerStatus.status, 400, 'reseller status must reject unknown values');
const resellerLogin = await fetch(`${base}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'ci-reseller@example.test', password: 'ci-reseller-password-please-ignore-123' }),
});
assert.equal(resellerLogin.status, 200);
const resellerSession = await resellerLogin.json();
const resellerHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${resellerSession.token}`,
};
const childCreate = await fetch(`${base}/api/v1/admin/resellers`, {
  method: 'POST',
  headers: resellerHeaders,
  body: JSON.stringify({
    email: 'ci-child-reseller@example.test',
    password: 'ci-child-password-please-ignore-123',
    name: 'CI Child Reseller',
    initialCredits: 10,
  }),
});
assert.equal(childCreate.status, 201);
const branchChild = await childCreate.json();
const childLogin = await fetch(`${base}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'ci-child-reseller@example.test', password: 'ci-child-password-please-ignore-123' }),
});
assert.equal(childLogin.status, 200);
const childSession = await childLogin.json();
const creditChildHeaders = { Authorization: `Bearer ${childSession.token}` };
const grandchildCreate = await fetch(`${base}/api/v1/admin/resellers`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${childSession.token}` },
  body: JSON.stringify({
    email: 'ci-grandchild-reseller@example.test',
    password: 'ci-grandchild-password-please-ignore-123',
    name: 'CI Grandchild Reseller',
    initialCredits: 5,
  }),
});
assert.equal(grandchildCreate.status, 201);
const grandchild = await grandchildCreate.json();
const grandchildLogin = await fetch(`${base}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'ci-grandchild-reseller@example.test', password: 'ci-grandchild-password-please-ignore-123' }),
});
assert.equal(grandchildLogin.status, 200);
const grandchildSession = await grandchildLogin.json();
const grandchildHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${grandchildSession.token}` };

const suspensionChildCreate = await fetch(`${base}/api/v1/admin/resellers`, {
  method: 'POST',
  headers: resellerHeaders,
  body: JSON.stringify({
    email: 'ci-suspension-child@example.test',
    password: 'ci-suspension-child-password-please-ignore-123',
    name: 'CI Suspension Child',
    initialCredits: 0,
  }),
});
assert.equal(suspensionChildCreate.status, 201);
const suspensionChildLogin = await fetch(`${base}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'ci-suspension-child@example.test', password: 'ci-suspension-child-password-please-ignore-123' }),
});
assert.equal(suspensionChildLogin.status, 200);
const suspensionChildSession = await suspensionChildLogin.json();
const childHeaders = { Authorization: `Bearer ${suspensionChildSession.token}` };

for (const path of [
  '/api/v1/admin/backup',
  '/api/v1/admin/system/backup',
  '/api/system/backup',
  '/api/v1/admin/audit-logs',
  '/api/system/audit-logs',
  '/api/v1/admin/requests',
  '/api/v1/admin/app-version',
]) {
  const response = await fetch(`${base}${path}`, { headers: resellerHeaders });
  assert.equal(response.status, 403, `reseller must not access ${path}`);
}
for (const [method, path] of [
  ['POST', '/api/v1/admin/requests/ci-missing/approve'],
  ['POST', '/api/v1/admin/requests/ci-missing/reject'],
  ['DELETE', '/api/v1/admin/requests/ci-missing'],
]) {
  const response = await fetch(`${base}${path}`, { method, headers: resellerHeaders, body: '{}' });
  assert.equal(response.status, 403, `reseller must not mutate onboarding via ${path}`);
}
const resellerProbe = await fetch(`${base}/api/probe`, {
  method: 'POST',
  headers: resellerHeaders,
  body: JSON.stringify({ target: '127.0.0.1:22', sni: 'localhost' }),
});
assert.equal(resellerProbe.status, 403, 'network probe must be Super Admin only');
const unauthenticatedProbe = await fetch(`${base}/api/probe`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ target: '127.0.0.1:22' }),
});
assert.equal(unauthenticatedProbe.status, 401, 'network probe must require authentication');

for (const [method, path] of [
  ['POST', '/api/v1/users/quick-trial'],
  ['POST', '/api/v1/token/verify'],
  ['POST', '/api/v1/vpn/heartbeat'],
]) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 410, `legacy endpoint ${path} must be retired`);
}

const adminRequests = await fetch(`${base}/api/v1/admin/requests`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(adminRequests.status, 200, 'Super Admin must retain access to onboarding requests');
const adminAppVersion = await fetch(`${base}/api/v1/admin/app-version`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(adminAppVersion.status, 200, 'Super Admin must retain access to app version configuration');

async function assertCorruptStoreFailsClosed(filename, endpoint, headers, corruptPayload = '{invalid-json') {
  const storePath = `${dataDir}/${filename}`;
  const existed = fs.existsSync(storePath);
  const previous = existed ? fs.readFileSync(storePath) : null;
  fs.writeFileSync(storePath, corruptPayload);
  try {
    const response = await fetch(`${base}${endpoint}`, { headers });
    assert.equal(response.status, 500, `${filename} corruption must not be treated as an empty store`);
  } finally {
    if (existed) fs.writeFileSync(storePath, previous);
    else fs.rmSync(storePath, { force: true });
  }
}

await assertCorruptStoreFailsClosed(
  'transactions.json',
  '/api/v1/admin/transactions',
  { Authorization: `Bearer ${login.token}` },
);
await assertCorruptStoreFailsClosed(
  'plans.json',
  '/api/plans',
  { Authorization: `Bearer ${login.token}` },
);
await assertCorruptStoreFailsClosed(
  'audit-logs.json',
  '/api/system/audit-logs',
  { Authorization: `Bearer ${login.token}` },
);
await assertCorruptStoreFailsClosed(
  'config.json',
  '/api/v1/admin/server-config',
  { Authorization: `Bearer ${login.token}` },
);
await assertCorruptStoreFailsClosed(
  'protocol-configs.json',
  '/api/v1/admin/protocol-configs',
  { Authorization: `Bearer ${login.token}` },
  '{}',
);
await assertCorruptStoreFailsClosed(
  'app-version.json',
  '/api/v1/admin/app-version',
  { Authorization: `Bearer ${login.token}` },
);
await assertCorruptStoreFailsClosed(
  'announcements.json',
  '/api/v1/announcements/active',
  {},
);

const adminBackup = await fetch(`${base}/api/v1/admin/backup`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(adminBackup.status, 200);
const adminBackupJson = await adminBackup.json();
assert.ok(!('secretPassphrase' in adminBackupJson.masterConfig), 'MASTER_SECRET must never be exported in backups');

const systemBackup = await fetch(`${base}/api/v1/admin/system/backup`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(systemBackup.status, 200);
const systemBackupJson = await systemBackup.json();
assert.ok(!('secretPassphrase' in systemBackupJson.config), 'system backup must redact MASTER_SECRET');

// The API's Caddy/domain variable must not silently become the VPN endpoint or TLS SNI.
// Simulate a config.json written by the retired implementation.
const legacyConfigFile = `${dataDir}/config.json`;
const legacyConfigFixture = JSON.parse(fs.readFileSync(legacyConfigFile, 'utf8'));
legacyConfigFixture.secretPassphrase = 'CI-LEGACY-MASTER-SECRET-FIXTURE';
fs.writeFileSync(legacyConfigFile, JSON.stringify(legacyConfigFixture, null, 2));

const initialMasterConfigResponse = await fetch(`${base}/api/v1/admin/server-config`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(initialMasterConfigResponse.status, 200);
const initialMasterConfig = await initialMasterConfigResponse.json();
assert.equal(initialMasterConfig.serverHost, '', 'the VPN profile destination must be configured explicitly in the panel');
assert.equal(initialMasterConfig.host, '', 'the HTTP Host header must be independent and optional');
assert.equal(initialMasterConfig.sniHost, '', 'the VPN profile SNI must be configured explicitly in the panel');
assert.ok(!('secretPassphrase' in initialMasterConfig), 'MASTER_SECRET must never be returned by the server-config API');
const storedMasterConfig = JSON.parse(fs.readFileSync(`${dataDir}/config.json`, 'utf8'));
assert.ok(!('secretPassphrase' in storedMasterConfig), 'MASTER_SECRET must never be persisted in config.json');

const autoBackupFiles = fs.readdirSync(`${dataDir}/backups`).filter(name => /^abessvpn-auto-.*\.json$/.test(name));
assert.ok(autoBackupFiles.length > 0, 'the daily auto-backup must be created at startup');
const encryptedAutoBackup = JSON.parse(fs.readFileSync(`${dataDir}/backups/${autoBackupFiles[0]}`, 'utf8'));
assert.equal(encryptedAutoBackup.format, 'abess-backup-v1');
const { unseal } = await import(`file://${process.cwd()}/modules/security.ts`);
const autoBackup = unseal(encryptedAutoBackup.sealed, process.env.MASTER_SECRET);
assert.ok(!('secretPassphrase' in autoBackup.masterConfig), 'daily backups must not persist MASTER_SECRET');

const prematureLicenceResponse = await fetch(`${base}/api/v1/admin/tokens`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({ plan: 'Should not be issued', bandwidthGb: 1, days: 1, deviceLimit: 1 }),
});
assert.equal(prematureLicenceResponse.status, 409, 'licences must not be issued before Host/SNI are configured');

// Admin-configured Host/SNI must survive subsequent master-config reads.
const protocolConfigUpdate = await fetch(`${base}/api/v1/admin/server-config`, {
  method: 'PUT',
  headers: adminHeaders,
  body: JSON.stringify({
    serverHost: 'profile.example.test',
    host: 'header.example.test',
    sniHost: 'vpn.example.test',
    serverPort: 443,
    protocol: 'vless',
    transport: 'ws',
  }),
});
assert.equal(protocolConfigUpdate.status, 200);
const protocolConfigUpdateJson = await protocolConfigUpdate.json();
assert.ok(!('secretPassphrase' in protocolConfigUpdateJson.config), 'server-config updates must not echo MASTER_SECRET');
const updatedStoredMasterConfig = JSON.parse(fs.readFileSync(`${dataDir}/config.json`, 'utf8'));
assert.ok(!('secretPassphrase' in updatedStoredMasterConfig), 'server-config updates must not persist MASTER_SECRET');
const protocolConfigRead = await fetch(`${base}/api/v1/admin/server-config`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(protocolConfigRead.status, 200);
const savedProtocolConfig = await protocolConfigRead.json();
assert.equal(savedProtocolConfig.serverHost, 'profile.example.test');
assert.equal(savedProtocolConfig.host, 'header.example.test');
assert.equal(savedProtocolConfig.sniHost, 'vpn.example.test');

const rejectedSniResponse = await fetch(`${base}/api/v1/admin/protocol-configs`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({
    name: 'CI invalid TLS SNI',
    serverHost: 'profile-invalid.example.test',
    host: 'header-invalid.example.test',
    sniHost: 'https://invalid.example.test',
    protocol: 'vless',
    transport: 'ws',
  }),
});
assert.equal(rejectedSniResponse.status, 400, 'TLS profiles must not use an SNI not covered by this deployment certificate');
assert.match((await rejectedSniResponse.json()).error, /SNI/);

// Multiple named profiles are managed only by the Super Admin and tokens select one profile.
const legacyProfilesResponse = await fetch(`${base}/api/v1/admin/protocol-configs`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(legacyProfilesResponse.status, 200);
const legacyProfiles = await legacyProfilesResponse.json();
assert.equal(legacyProfiles.length, 1);
const legacyProfile = legacyProfiles[0];
assert.equal(legacyProfile.id, 'cfg_legacy');
assert.equal(legacyProfile.serverHost, 'profile.example.test');

const createVlessTcpProfileResponse = await fetch(`${base}/api/v1/admin/protocol-configs`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({
    name: 'CI VLESS Direct TCP Profile',
    serverPort: 10050,
    serverHost: 'profile-tcp.example.test',
    host: 'header-tcp.example.test',
    sniHost: '',
    protocol: 'vless',
    transport: 'tcp',
  }),
});
assert.equal(createVlessTcpProfileResponse.status, 201);
const vlessTcpProfile = (await createVlessTcpProfileResponse.json()).config;
assert.equal(vlessTcpProfile.protocol, 'vless');
assert.equal(vlessTcpProfile.transport, 'tcp');
assert.equal(vlessTcpProfile.serverPort, 10050);

const availableProfilesResponse = await fetch(`${base}/api/v1/admin/available-configs`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(availableProfilesResponse.status, 200);
const availableProfiles = await availableProfilesResponse.json();
assert.equal(availableProfiles.length, 2);
assert.ok(!('serverHost' in availableProfiles[0]), 'profile chooser must not expose destination IP/host');
assert.ok(!('host' in availableProfiles[0]), 'profile chooser must not expose HTTP Host');
assert.ok(!('sniHost' in availableProfiles[0]), 'profile chooser must not expose TLS SNI');

const xssCustomerNote = '</script><script>globalThis.__abess_xss=1</script>';
const createA = await fetch(`${base}/api/v1/admin/tokens`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({
    plan: 'CI Xray UUID A',
    bandwidthGb: 2,
    days: 1,
    deviceLimit: 2,
    configurationId: legacyProfile.id,
    customerNote: xssCustomerNote,
  }),
});
assert.equal(createA.status, 201);
const licenceA = await createA.json();
const crossTenantVariants = await fetch(`${base}/api/v1/admin/tokens/${licenceA.id}/variants`, {
  headers: { Authorization: `Bearer ${resellerSession.token}` },
});
assert.equal(crossTenantVariants.status, 403, 'resellers must not inspect another reseller token variants');

const subscriptionPortal = await fetch(`${base}/sub/${licenceA.token}`, {
  headers: {
    Accept: 'text/html',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  },
});
assert.equal(subscriptionPortal.status, 200);
const subscriptionHtml = await subscriptionPortal.text();
assert.ok(
  subscriptionHtml.includes('&lt;/script&gt;&lt;script&gt;globalThis.__abess_xss=1&lt;/script&gt;'),
  'customer-controlled HTML text must be escaped'
);
assert.ok(
  subscriptionHtml.includes('\\u003c/script\\u003e\\u003cscript\\u003eglobalThis.__abess_xss=1\\u003c/script\\u003e'),
  'customer-controlled inline JSON must be escaped for a script context'
);
assert.ok(!subscriptionHtml.includes(xssCustomerNote), 'raw script-breaking customer text must never appear in portal HTML');
assert.match(licenceA.clientUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const variantsAResponse = await fetch(`${base}/api/v1/admin/tokens/${licenceA.id}/variants`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(variantsAResponse.status, 200);
const variantsAJson = await variantsAResponse.json();
assert.equal(variantsAJson.xrayClient.outbounds[0].streamSettings.network, 'ws');
assert.equal(variantsAJson.xrayClient.outbounds[0].streamSettings.security, 'tls');
assert.equal(variantsAJson.xrayClient.outbounds[0].streamSettings.wsSettings.headers.Host, 'header.example.test');
assert.equal(variantsAJson.variants.length, 1, 'only manually configured transports may be exported');
assert.equal(new URL(variantsAJson.variants[0].uri).searchParams.get('path'), '/@abess237');

let stableUuid;
for (const deviceId of ['CI-DEVICE-ONE', 'CI-DEVICE-TWO']) {
  const response = await fetch(`${base}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: licenceA.token, deviceId }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.valid, true);
  assert.equal(result.deviceLimit, 2);
  assert.equal(result.serverConfig.uuid, licenceA.clientUuid);
  assert.equal(result.serverConfig.address, 'profile.example.test');
  assert.equal(result.serverConfig.host, 'header.example.test');
  assert.equal(result.serverConfig.sni, 'vpn.example.test');
  assert.equal(result.serverConfig.wsHost, 'header.example.test');
  if (stableUuid) assert.equal(result.serverConfig.uuid, stableUuid, 'the VLESS UUID for one licence must remain stable');
  stableUuid = result.serverConfig.uuid;
}

const thirdDevice = await fetch(`${base}/api/v1/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: licenceA.token, deviceId: 'CI-DEVICE-THREE' }),
});
assert.equal(thirdDevice.status, 403, 'the configured device limit must be enforced');

const importLinkResponse = await fetch(`${base}/api/v1/auth/import-link`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ link: licenceA.encryptedLink, deviceId: 'CI-DEVICE-ONE' }),
});
assert.equal(importLinkResponse.status, 200, 'encrypted panel links must validate through the mobile API');
const importedLink = await importLinkResponse.json();
assert.equal(importedLink.serverConfig.uuid, licenceA.clientUuid);

const badLinkResponse = await fetch(`${base}/api/v1/auth/import-link`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ link: 'abess://invalid', deviceId: 'CI-BAD-LINK' }),
});
assert.equal(badLinkResponse.status, 400, 'invalid encrypted links must be rejected');

// A licence can optionally be pinned to the installation ID copied from ABESS VPN.
const pinnedDeviceId = 'ABESS-INST-0123456789ABCDEF01234567';
const pinnedCreate = await fetch(`${base}/api/v1/admin/tokens`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({
    plan: 'CI pinned device licence',
    bandwidthGb: 2,
    days: 1,
    deviceLimit: 1,
    configurationId: legacyProfile.id,
    allowedDeviceId: pinnedDeviceId,
  }),
});
assert.equal(pinnedCreate.status, 201);
const pinnedLicence = await pinnedCreate.json();
assert.equal(pinnedLicence.allowedDeviceId, pinnedDeviceId);

const wrongPinnedDevice = await fetch(`${base}/api/v1/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: pinnedLicence.token, deviceId: 'ABESS-INST-WRONGDEVICEID000000' }),
});
assert.equal(wrongPinnedDevice.status, 403, 'a pinned licence must refuse another installation ID');
assert.equal((await wrongPinnedDevice.json()).status, 'device_id_mismatch');

const correctPinnedDevice = await fetch(`${base}/api/v1/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: pinnedLicence.token, deviceId: pinnedDeviceId }),
});
assert.equal(correctPinnedDevice.status, 200, 'the pinned installation ID must be allowed');
const pinnedValidation = await correctPinnedDevice.json();
assert.equal(pinnedValidation.serverConfig.allowedDeviceId, pinnedDeviceId);

// Deleting a reseller branch refunds all unused credits and revokes every active child/grandchild licence.
const branchLicenceResponse = await fetch(`${base}/api/v1/admin/tokens`, {
  method: 'POST',
  headers: grandchildHeaders,
  body: JSON.stringify({
    plan: 'CI licence inside reseller branch',
    bandwidthGb: 1,
    days: 1,
    deviceLimit: 1,
    configurationId: legacyProfile.id,
  }),
});
assert.equal(branchLicenceResponse.status, 201);
const branchLicence = await branchLicenceResponse.json();
const deleteBranch = await fetch(`${base}/api/v1/admin/resellers/${branchChild.id}`, {
  method: 'DELETE',
  headers: resellerHeaders,
});
assert.equal(deleteBranch.status, 200);
const deleteBranchResult = await deleteBranch.json();
assert.equal(deleteBranchResult.deletedCount, 2);
assert.equal(deleteBranchResult.revokedTokenCount, 1);
assert.equal(deleteBranchResult.refundedCreditsGb, 9);
const parentAfterBranchDelete = await fetch(`${base}/api/v1/auth/me`, { headers: resellerHeaders });
assert.equal(parentAfterBranchDelete.status, 200);
assert.equal((await parentAfterBranchDelete.json()).credits, 19);
const branchUsersAfterDelete = JSON.parse(fs.readFileSync(`${dataDir}/users.json`, 'utf8'));
assert.ok(!branchUsersAfterDelete.some(item => item.id === grandchild.id));
const branchTokensAfterDelete = JSON.parse(fs.readFileSync(`${dataDir}/tokens.json`, 'utf8'));
assert.equal(branchTokensAfterDelete.find(item => item.id === branchLicence.id).status, 'revoked');
assert.ok(!fs.existsSync(`${dataDir}/xray-config.json`));
const deletedGrandchildSession = await fetch(`${base}/api/v1/auth/me`, { headers: grandchildHeaders });
assert.equal(deletedGrandchildSession.status, 401, 'deleting a branch must revoke descendant sessions');

const suspendParent = await fetch(`${base}/api/v1/admin/resellers/${createdReseller.id}/status`, {
  method: 'PUT',
  headers: adminHeaders,
  body: JSON.stringify({ status: 'suspended' }),
});
assert.equal(suspendParent.status, 200);
const childExistingSession = await fetch(`${base}/api/v1/auth/me`, { headers: childHeaders });
assert.equal(childExistingSession.status, 401, 'suspending a reseller must immediately revoke active descendant sessions');

const createB = await fetch(`${base}/api/v1/admin/tokens`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({ plan: 'CI Xray UUID B', bandwidthGb: 2, days: 1, deviceLimit: 1, configurationId: legacyProfile.id }),
});
assert.equal(createB.status, 201);
const licenceB = await createB.json();
assert.notEqual(licenceB.clientUuid, licenceA.clientUuid, 'licences must have distinct Xray user IDs');

const createdTokenValidation = await fetch(`${base}/api/v1/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: licenceB.token, deviceId: 'CI-B-DEVICE' }),
});
assert.equal(createdTokenValidation.status, 200);
const createC = await fetch(`${base}/api/v1/admin/tokens`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({ plan: 'CI VLESS TCP Direct', bandwidthGb: 2, days: 1, deviceLimit: 1, configurationId: vlessTcpProfile.id }),
});
assert.equal(createC.status, 201);
const licenceC = await createC.json();
assert.equal(licenceC.configurationId, vlessTcpProfile.id);
assert.equal(licenceC.configurationName, 'CI VLESS Direct TCP Profile');
assert.ok(!('configurationSnapshot' in licenceC), 'licence API must not expose private profile snapshot');

const tokenCValidation = await fetch(`${base}/api/v1/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: licenceC.token, deviceId: 'CI-C-DEVICE' }),
});
assert.equal(tokenCValidation.status, 200);
const configC = await tokenCValidation.json();
assert.equal(configC.serverConfig.protocol, 'vless');
assert.equal(configC.serverConfig.transport, 'tcp');
assert.equal(configC.serverConfig.address, 'profile-tcp.example.test');
assert.equal(configC.serverConfig.port, 10050);
assert.equal(configC.serverConfig.host, 'header-tcp.example.test');

const variantsCResponse = await fetch(`${base}/api/v1/admin/tokens/${licenceC.id}/variants`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(variantsCResponse.status, 200);
const variantsCJson = await variantsCResponse.json();
assert.equal(variantsCJson.xrayClient.outbounds[0].streamSettings.network, 'tcp');
assert.equal(variantsCJson.xrayClient.outbounds[0].streamSettings.security, 'none');
assert.deepEqual(variantsCJson.xrayClient.outbounds[0].streamSettings.tcpSettings, { header: { type: 'none' } });
assert.equal(variantsCJson.variants.length, 1);

async function assertGeneratedClientTransport(transport, expectedSettingsKey) {
  const profileResponse = await fetch(`${base}/api/v1/admin/protocol-configs`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      name: `CI VLESS ${transport.toUpperCase()}`,
      serverHost: `profile-${transport}.example.test`,
      host: `header-${transport}.example.test`,
      sniHost: process.env.VPN_DOMAIN,
      protocol: 'vless',
      transport,
    }),
  });
  assert.equal(profileResponse.status, 201, `${transport} profile must be accepted`);
  const profile = (await profileResponse.json()).config;
  const tokenResponse = await fetch(`${base}/api/v1/admin/tokens`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      plan: `CI ${transport} client JSON`,
      bandwidthGb: 1,
      days: 1,
      deviceLimit: 1,
      configurationId: profile.id,
    }),
  });
  assert.equal(tokenResponse.status, 201, `${transport} licence must be issued`);
  const token = await tokenResponse.json();
  const variantsResponse = await fetch(`${base}/api/v1/admin/tokens/${token.id}/variants`, {
    headers: adminHeaders,
  });
  assert.equal(variantsResponse.status, 200);
  const variants = await variantsResponse.json();
  const outbound = variants.xrayClient.outbounds[0];
  assert.equal(outbound.streamSettings.network, transport);
  assert.equal(outbound.streamSettings.security, 'tls');
  assert.equal(outbound.settings.vnext[0].port, 443);
  assert.equal(outbound.streamSettings.tlsSettings.serverName, process.env.VPN_DOMAIN);
  assert.ok(outbound.streamSettings[expectedSettingsKey], `${transport} settings must be present`);
  return outbound.streamSettings;
}

const grpcClientSettings = await assertGeneratedClientTransport('grpc', 'grpcSettings');
assert.equal(grpcClientSettings.grpcSettings.serviceName, '@abess237');
assert.deepEqual(grpcClientSettings.tlsSettings.alpn, ['h2']);

const httpUpgradeClientSettings = await assertGeneratedClientTransport('httpupgrade', 'httpupgradeSettings');
assert.equal(httpUpgradeClientSettings.httpupgradeSettings.path, '/@abess237');
assert.equal(httpUpgradeClientSettings.httpupgradeSettings.host, 'header-httpupgrade.example.test');

const xhttpClientSettings = await assertGeneratedClientTransport('xhttp', 'xhttpSettings');
assert.equal(xhttpClientSettings.xhttpSettings.path, '/@abess237');
assert.equal(xhttpClientSettings.xhttpSettings.mode, 'auto');

assert.ok(!fs.existsSync(`${dataDir}/xray-config.json`));

// The API must never fake an HTTP/WebSocket handshake as a VPN tunnel.
const crlf = String.fromCharCode(13, 10);
const websocketResponse = await new Promise((resolve, reject) => {
  const socket = net.connect(3187, '127.0.0.1', () => {
    socket.write([
      'GET /@abess237 HTTP/1.1',
      'Host: 127.0.0.1:3187',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      '',
      '',
  ].join(crlf));
  });
  let response = '';
  const timeout = setTimeout(() => {
    socket.destroy();
    reject(new Error('WebSocket fail-closed probe timed out'));
  }, 3000);
  socket.on('data', (chunk) => {
    response += chunk.toString('utf8');
    if (response.includes(crlf + crlf)) {
      clearTimeout(timeout);
      socket.destroy();
      resolve(response);
    }
  });
  socket.on('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
});
assert.ok(String(websocketResponse).includes('HTTP/1.1 503 Service Unavailable'));

// Public subscription URLs accept only the bearer token, not internal IDs or UUIDs.
const subscriptionByToken = await fetch(`${base}/sub/${licenceA.token}?raw=1`);
assert.equal(subscriptionByToken.status, 200);
const subscriptionById = await fetch(`${base}/sub/${licenceA.id}?raw=1`);
assert.equal(subscriptionById.status, 404, 'internal token IDs must not act as subscription credentials');
const subscriptionByUuid = await fetch(`${base}/sub/${licenceA.clientUuid}?raw=1`);
assert.equal(subscriptionByUuid.status, 404, 'Xray UUIDs must not act as subscription credentials');
const retiredSshConfigByToken = await fetch(`${base}/api/v1/ssh/config/${licenceA.token}`);
assert.equal(retiredSshConfigByToken.status, 410, 'legacy SSH config download must never return stored plaintext passwords');

// Membership status responses must not disclose customer contact/payment data.
const membershipCreate = await fetch(`${base}/api/v1/membership/request`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    firstName: 'CI',
    lastName: 'Customer',
    contactDetail: '+237600000000',
    deviceId: 'CI-REQUEST-DEVICE-123456',
    planId: 'plan_10gb',
    paymentMethod: 'ORANGE_MONEY',
    paymentRef: 'CI-PRIVATE-PAYMENT-REFERENCE',
  }),
});
assert.equal(membershipCreate.status, 200);
const membershipCreated = await membershipCreate.json();
await assertCorruptStoreFailsClosed(
  'requests.json',
  '/api/v1/admin/requests',
  { Authorization: `Bearer ${login.token}` },
);
const membershipStatus = await fetch(`${base}/api/v1/membership/status?request_id=${encodeURIComponent(membershipCreated.request.id)}`);
assert.equal(membershipStatus.status, 200);
const membershipStatusJson = await membershipStatus.json();
assert.equal(membershipStatusJson.status, 'pending');
assert.ok(!('fullName' in membershipStatusJson.request));
assert.ok(!('contactDetail' in membershipStatusJson.request));
assert.ok(!('paymentRef' in membershipStatusJson.request));
assert.ok(!('ipAddress' in membershipStatusJson.request));
const emptyMembershipLookup = await fetch(`${base}/api/v1/membership/status`);
assert.equal(emptyMembershipLookup.status, 400, 'membership status must require a request ID or device ID');

// SSH account creation and password delivery remain disabled until a
// dedicated, authenticated host-side provisioner is available.
const sshProfileResponse = await fetch(`${base}/api/v1/admin/protocol-configs`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({
    name: 'CI legacy SSH profile',
    serverHost: 'ssh-profile.example.test',
    serverPort: 22,
    protocol: 'ssh',
    transport: 'ws',
    payload: 'GET / HTTP/1.1[crlf]Host: example.test[crlf][crlf]',
  }),
});
assert.equal(sshProfileResponse.status, 400, 'the panel must not accept new SSH profiles');

const sshLicence = await fetch(`${base}/api/v1/admin/tokens`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({
    plan: 'CI unsupported SSH',
    protocol: 'ssh',
    bandwidthGb: 1,
    days: 1,
    deviceLimit: 1,
  }),
});
assert.equal(sshLicence.status, 503, 'the panel must not issue SSH licences without a real host provisioner');

// Legacy SSH credentials are never returned in generic licence objects or backups.
const tokenFile = `${dataDir}/tokens.json`;
const storedTokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
storedTokens.push({
  id: 'ci-legacy-ssh-token',
  token: 'ABESS-CI-LEGACY-SSH',
  clientUuid: 'abcdef12-3456-4123-8123-123456789abc',
  resellerId: 'ci-admin',
  resellerName: 'CI Admin',
  plan: 'Legacy SSH fixture',
  bandwidthGb: 1,
  bandwidthUsedGb: 0,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  days: 1,
  deviceLimit: 1,
  connectionCount: 0,
  lastSeenAt: null,
  lastSeenIp: null,
  status: 'active',
  encryptedLink: '',
  createdAt: new Date().toISOString(),
  protocolType: 'ssh',
  sshConfig: {
    sshConfigType: 'SSH-Payload',
    remarks: 'CI redaction fixture',
    sshHost: 'ssh.example.test',
    sshPort: 22,
    sshUsername: 'ci-user',
    sshPassword: 'CI-PLAINTEXT-SSH-PASSWORD-MUST-NOT-LEAK',
    payload: 'GET / HTTP/1.1[crlf][crlf]',
  },
});
fs.writeFileSync(tokenFile, JSON.stringify(storedTokens, null, 2));
const redactedBackup = await fetch(`${base}/api/v1/admin/backup`, { headers: adminHeaders });
assert.equal(redactedBackup.status, 200);
const redactedBackupJson = await redactedBackup.json();
const redactedLegacyToken = redactedBackupJson.tokens.find(token => token.id === 'ci-legacy-ssh-token');
assert.ok(redactedLegacyToken);
assert.ok(!('sshPassword' in redactedLegacyToken.sshConfig), 'legacy SSH passwords must not appear in API backups');
const backedUpLicenceA = redactedBackupJson.tokens.find(token => token.id === licenceA.id);
assert.ok(backedUpLicenceA?.configurationSnapshot, 'backups must preserve immutable per-licence protocol snapshots');
assert.equal(backedUpLicenceA.configurationSnapshot.serverHost, 'profile.example.test');

const legacySshActivation = await fetch(`${base}/api/v1/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'ABESS-CI-LEGACY-SSH', deviceId: 'CI-SSH-LEGACY-DEVICE' }),
});
assert.equal(legacySshActivation.status, 410, 'legacy SSH activation must be retired');

const legacySshSubscription = await fetch(`${base}/sub/ABESS-CI-LEGACY-SSH?raw=1`);
assert.equal(legacySshSubscription.status, 410, 'subscription URLs must not distribute legacy SSH credentials');

const legacySshVariants = await fetch(`${base}/api/v1/admin/tokens/ci-legacy-ssh-token/variants`, {
  headers: { Authorization: `Bearer ${login.token}` },
});
assert.equal(legacySshVariants.status, 410, 'legacy SSH tokens must not be converted into VLESS client JSON');

const resyncAfterLegacySsh = await fetch(`${base}/api/v1/admin/server-config`, {
  method: 'PUT',
  headers: adminHeaders,
  body: JSON.stringify({
    serverHost: 'profile.example.test',
    host: 'header.example.test',
    sniHost: 'vpn.example.test',
    serverPort: 443,
    protocol: 'vless',
    transport: 'ws',
  }),
});
assert.equal(resyncAfterLegacySsh.status, 200);
assert.ok(!fs.existsSync(`${dataDir}/xray-config.json`));

console.log('API, licensing, privacy, security and manual client export tests passed.');
