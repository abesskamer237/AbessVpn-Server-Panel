import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  SecurityService,
  base32,
  totp,
  seal,
  unseal,
} from "../modules/security.ts";
import { encryptedBackup } from "../modules/operations.ts";
import {
  confirmManualOrder,
  MANUAL_PAYMENT_CONTACTS,
} from "../modules/commerce.ts";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const key = crypto.randomBytes(32).toString("hex");
assert.equal(
  totp(base32(Buffer.from("12345678901234567890")), 1),
  "287082",
  "RFC6238 vector",
);
let state = { mfa: {}, sessions: {} };
const security = new SecurityService(
  () => structuredClone(state),
  (v) => {
    state = structuredClone(v);
  },
  () => key,
);
const setup = security.begin("user", "user@example.test");
const code = totp(setup.secret);
const recovery = security.enable("user", code);
assert.equal(recovery.length, 8);
assert.equal(security.verify("user", code), false, "TOTP cannot be replayed");
assert.equal(security.verify("user", recovery[0]), true);
assert.equal(
  security.verify("user", recovery[0]),
  false,
  "Recovery code is single-use",
);
assert.ok(
  !JSON.stringify(state).includes(setup.secret),
  "MFA secret must be encrypted",
);
security.sessions.set("sess_test", {
  userId: "user",
  createdAt: Date.now(),
  role: "RESELLER",
  email: "user@example.test",
});
assert.ok(
  !JSON.stringify(state).includes("sess_test"),
  "Session bearer is hashed",
);
const archive = encryptedBackup({ test: 1 }, key);
assert.deepEqual(unseal(archive.sealed, key), { test: 1 });
const pieces = archive.sealed.split(".");
pieces[2] = crypto.randomBytes(16).toString("base64url");
assert.throws(() => unseal(pieces.join("."), key));
assert.deepEqual(
  MANUAL_PAYMENT_CONTACTS.map((c) => [c.number, c.holder]),
  [
    ["681328753", "manga Ghislain"],
    ["695140419", "mengue belinga"],
  ],
);
const order = {
  id: "ord_test",
  userId: "user",
  planId: "p",
  planName: "P",
  quotaGb: 10,
  amount: 2000,
  currency: "XAF",
  status: "submitted",
  createdAt: new Date().toISOString(),
  idempotencyKey: "abcdefghijklmnop",
};
const commerce = { orders: [order] };
const users = [{ id: "user", credits: 0, status: "active" }];
const verified = {
  channel: "MOMO",
  reference: "TEST-MOMO-12345",
  receivedAmount: 2000,
};
assert.throws(() =>
  confirmManualOrder(
    commerce,
    users,
    order,
    { ...verified, receivedAmount: 1 },
    "admin",
  ),
);
assert.equal(
  users[0].credits,
  0,
  "a declaration or wrong amount must not add credits",
);
assert.ok(confirmManualOrder(commerce, users, order, verified, "admin"));
assert.equal(
  confirmManualOrder(commerce, users, order, verified, "admin"),
  false,
);
assert.equal(
  users[0].credits,
  10,
  "manual confirmation must credit exactly once",
);
const duplicate = {
  ...order,
  id: "ord_duplicate",
  status: "submitted",
  transactionId: undefined,
};
commerce.orders.push(duplicate);
assert.throws(
  () =>
    confirmManualOrder(
      commerce,
      users,
      duplicate,
      { ...verified, reference: "test momo 12345" },
      "admin",
    ),
  "a receipt cannot be reused by changing formatting",
);
const directory = await mkdtemp(path.join(tmpdir(), "abess-platform-"));
const password = crypto.randomBytes(24).toString("hex");
const env = {
  ...process.env,
  DATABASE_URL: "",
  ALLOW_JSON_STORAGE: "true",
  NODE_ENV: "production",
  PORT: "3217",
  DATA_DIR: directory,
  VPN_DOMAIN: "vpn.example.test",
  ADMIN_EMAIL: "platform@example.test",
  ADMIN_INITIAL_PASSWORD: password,
  MASTER_SECRET: key,
  TELEGRAM_BOT_TOKEN: "",
};
const server = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
  env,
  stdio: "ignore",
});
async function call(route, body, token, method, extra = {}) {
  const response = await fetch("http://127.0.0.1:3217/api/v1/" + route, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...extra,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body:
      response.status === 204
        ? null
        : response.headers.get("content-type")?.includes("application/json")
          ? await response.json()
          : { message: await response.text() },
  };
}
try {
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error("API failed");
    try {
      if ((await call("ping")).status === 200) break;
    } catch {}
    await delay(100);
  }
  const session = await call("auth/login", {
    email: env.ADMIN_EMAIL,
    password,
  });
  assert.equal(session.status, 200);
  const token = session.body.token;
  assert.equal(
    (
      await call(
        "admin/protocol-configs",
        {
          name: "Unsafe TCP",
          serverHost: env.VPN_DOMAIN,
          transport: "tcp",
          protocol: "vless",
        },
        token,
      )
    ).status,
    400,
    "plaintext VLESS must be disabled by default",
  );
  const localProfile = await call(
    "admin/protocol-configs",
    {
      name: "Local test",
      serverHost: env.VPN_DOMAIN,
      host: env.VPN_DOMAIN,
      sniHost: env.VPN_DOMAIN,
      transport: "ws",
      protocol: "vless",
    },
    token,
  );
  assert.equal(localProfile.status, 201);
  const localLicense = await call(
    "admin/tokens",
    {
      configurationId: localProfile.body.config.id,
      bandwidthGb: 10,
      days: 30,
      deviceLimit: 1,
    },
    token,
  );
  assert.equal(localLicense.status, 201);
  const renewed = await call(
    `admin/tokens/${localLicense.body.id}/renew`,
    { additionalGb: 2, days: 5 },
    token,
    undefined,
    { "Idempotency-Key": "test-renewal-request-001" },
  );
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.bandwidthGb, 12);
  const replay = await call(
    `admin/tokens/${localLicense.body.id}/renew`,
    { additionalGb: 2, days: 5 },
    token,
    undefined,
    { "Idempotency-Key": "test-renewal-request-001" },
  );
  assert.equal(replay.body.bandwidthGb, 12, "renewal must not debit twice");
  const remoteNode = await call(
    "admin/nodes",
    { name: "Remote test", host: "node.example.test" },
    token,
  );
  assert.equal(remoteNode.status, 201);
  const remoteProfile = await call(
    "admin/protocol-configs",
    {
      name: "Remote test",
      serverHost: "node.example.test",
      host: "node.example.test",
      sniHost: "node.example.test",
      transport: "ws",
      protocol: "vless",
    },
    token,
  );
  assert.equal(remoteProfile.status, 201);
  const remoteLicense = await call(
    "admin/tokens",
    {
      configurationId: remoteProfile.body.config.id,
      bandwidthGb: 2,
      days: 30,
      deviceLimit: 1,
    },
    token,
  );
  assert.equal(remoteLicense.status, 201);
  const configuration = await call(
    `nodes/${remoteNode.body.id}/config`,
    undefined,
    remoteNode.body.key,
  );
  assert.equal(configuration.status, 200);
  const remoteUsers = configuration.body.inbounds.find(
    (i) => i.tag === "vless-ws-in",
  ).settings.users;
  assert.ok(remoteUsers.some((u) => u.id === remoteLicense.body.clientUuid));
  assert.ok(
    !remoteUsers.some((u) => u.id === localLicense.body.clientUuid),
    "node configurations must be isolated",
  );
  const email = remoteUsers.find(
    (u) => u.id === remoteLicense.body.clientUuid,
  ).email;
  const heartbeat = {
    ready: true,
    snapshot: {
      generation: "remote-process-1",
      stat: [
        {
          name: `user>>>${email}>>>traffic>>>uplink`,
          value: String(1024 ** 3),
        },
      ],
    },
  };
  assert.equal(
    (
      await call(
        `nodes/${remoteNode.body.id}/heartbeat`,
        heartbeat,
        remoteNode.body.key,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        `nodes/${remoteNode.body.id}/heartbeat`,
        heartbeat,
        remoteNode.body.key,
      )
    ).status,
    200,
  );
  const allTokens = await call("admin/tokens", undefined, token);
  assert.equal(
    allTokens.body.find((t) => t.id === remoteLicense.body.id).bandwidthUsedGb,
    1,
    "repeated counters must not double count",
  );
  heartbeat.snapshot.stat[0].value = String(2 * 1024 ** 3);
  await call(
    `nodes/${remoteNode.body.id}/heartbeat`,
    heartbeat,
    remoteNode.body.key,
  );
  const exhausted = await call(
    `nodes/${remoteNode.body.id}/config`,
    undefined,
    remoteNode.body.key,
  );
  assert.ok(
    !exhausted.body.inbounds
      .find((i) => i.tag === "vless-ws-in")
      .settings.users.some((u) => u.id === remoteLicense.body.clientUuid),
    "quota exhaustion removes the remote user",
  );
  await call(`admin/nodes/${remoteNode.body.id}`, undefined, token, "DELETE");
  assert.equal(
    (
      await call(
        `nodes/${remoteNode.body.id}/config`,
        undefined,
        remoteNode.body.key,
      )
    ).status,
    401,
    "revoked agent cannot pull credentials",
  );
  const setupResponse = await call("auth/mfa/setup", { password }, token);
  assert.equal(setupResponse.status, 200);
  const enabled = await call(
    "auth/mfa/enable",
    { code: totp(setupResponse.body.secret) },
    token,
  );
  assert.equal(enabled.status, 200);
  assert.equal(
    (await call("auth/login", { email: env.ADMIN_EMAIL, password })).body
      .mfaRequired,
    true,
  );
  const mfaLogin = await call("auth/login", {
    email: env.ADMIN_EMAIL,
    password,
    code: enabled.body.recoveryCodes[0],
  });
  assert.equal(mfaLogin.status, 200);
  assert.equal(
    (
      await call("auth/login", {
        email: env.ADMIN_EMAIL,
        password,
        code: enabled.body.recoveryCodes[0],
      })
    ).status,
    401,
  );
  const snapshot = await call(
    "admin/operations/backup",
    undefined,
    mfaLogin.body.token,
  );
  assert.equal(snapshot.body.format, "abess-backup-v1");
  assert.equal(unseal(snapshot.body.sealed, key).users.length, 1);
  const instructions = await call("payments/instructions");
  assert.equal(instructions.body.mode, "manual");
  assert.equal(instructions.body.contacts[0].number, "681328753");
  assert.equal(instructions.body.contacts[1].number, "695140419");
  const plans = await call("plans");
  const offer = plans.body.find((p) => p.priceCfa > 0);
  const manual = await call(
    "commerce/orders",
    { planId: offer.id },
    mfaLogin.body.token,
    undefined,
    { "Idempotency-Key": "manual-test-order-001" },
  );
  assert.equal(manual.status, 201);
  assert.equal(
    (
      await call(
        `commerce/orders/${manual.body.id}/submit`,
        { channel: "OM", reference: "TEST-OM-12345" },
        mfaLogin.body.token,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        `commerce/orders/${manual.body.id}/confirm`,
        {
          channel: "OM",
          reference: "TEST-OM-12345",
          receivedAmount: offer.priceCfa,
          confirmedReceived: true,
        },
        mfaLogin.body.token,
      )
    ).status,
    503,
    "manual credit confirmation requires transactional storage",
  );
  assert.equal(
    (await call("payments/automatic/notify", {}, mfaLogin.body.token)).status,
    404,
    "no automatic payment gateway is integrated",
  );
  const changed = await call(
    "auth/password",
    {
      password,
      newPassword: crypto.randomBytes(24).toString("hex"),
      code: enabled.body.recoveryCodes[1],
    },
    mfaLogin.body.token,
  );
  assert.equal(changed.status, 200);
  assert.equal(
    (await call("auth/me", undefined, mfaLogin.body.token)).status,
    401,
  );
  console.log(
    "Platform passed: RFC TOTP, replay/recovery protection, encrypted backups, manual transfer verification, amount and receipt replay protection, MFA API, renewal idempotence, isolated remote nodes, quota accounting, password and session revocation.",
  );
} finally {
  server.kill();
  await new Promise((r) => server.once("close", r));
  await rm(directory, { recursive: true, force: true });
}
