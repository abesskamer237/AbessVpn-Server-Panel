import assert from "node:assert/strict";
import { Pool } from "pg";
import { DocumentStore } from "../modules/store.ts";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
if (!process.env.TEST_DATABASE_URL)
  throw new Error("TEST_DATABASE_URL required (disposable PostgreSQL only).");
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const schema = "test_" + randomBytes(8).toString("hex");
await admin.query(`CREATE SCHEMA ${schema}`);
const url = new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set("options", `-c search_path=${schema}`);
const dir = await mkdtemp(path.join(tmpdir(), "abess-pg-"));
await writeFile(
  path.join(dir, "commerce.json"),
  JSON.stringify({ counter: 0, orders: [] }),
);
const store = new DocumentStore(dir, url.toString());
let child;
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  NODE_ENV: "production",
  PORT: "3215",
  DATA_DIR: dir,
  VPN_DOMAIN: "vpn.example.test",
  ADMIN_EMAIL: "pg@example.test",
  ADMIN_INITIAL_PASSWORD: randomBytes(24).toString("hex"),
  MASTER_SECRET: randomBytes(32).toString("hex"),
  TELEGRAM_BOT_TOKEN: "",
};
async function start() {
  child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    env,
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("PostgreSQL API exited");
    try {
      if ((await fetch("http://127.0.0.1:3215/api/v1/ping")).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("API readiness timed out");
}
async function stop() {
  if (child) {
    child.kill();
    await new Promise((r) => child.once("close", r));
    child = null;
  }
}
process.env.MASTER_SECRET = env.MASTER_SECRET;
try {
  await store.initialize();
  await assert.rejects(
    store.transaction(() => {
      store.write(path.join(dir, "commerce.json"), { counter: 99 });
      throw new Error("rollback");
    }),
  );
  await store.transaction(() =>
    assert.equal(store.read(path.join(dir, "commerce.json")).counter, 0),
  );
  await Promise.all(
    Array.from({ length: 16 }, () =>
      store.transaction(async () => {
        const value = store.read(path.join(dir, "commerce.json"));
        await delay(2);
        value.counter++;
        store.write(path.join(dir, "commerce.json"), value);
      }),
    ),
  );
  await store.transaction(() =>
    assert.equal(store.read(path.join(dir, "commerce.json")).counter, 16),
  );
  assert.equal(
    JSON.parse(await readFile(path.join(dir, "commerce.json"))).counter,
    0,
    "legacy source must remain untouched",
  );
  await assert.rejects(
    store.pool.query("UPDATE audit_events SET hash='modified'"),
  );
  const chain = await store.pool.query(
    "SELECT event,previous_hash,hash FROM audit_events ORDER BY id",
  );
  const { canonicalJson } = await import("../modules/store.ts");
  let previous = "";
  for (const row of chain.rows) {
    assert.equal(row.previous_hash, previous);
    assert.equal(
      row.hash,
      (await import("node:crypto"))
        .createHmac("sha256", process.env.MASTER_SECRET || "")
        .update(previous + canonicalJson(row.event))
        .digest("hex"),
    );
    previous = row.hash;
  }
  await start();
  const response = await fetch("http://127.0.0.1:3215/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: env.ADMIN_EMAIL,
      password: env.ADMIN_INITIAL_PASSWORD,
    }),
  });
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.ok(session.token);
  await stop();
  await start();
  assert.equal(
    (
      await fetch("http://127.0.0.1:3215/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${session.token}` },
      })
    ).status,
    200,
    "sessions survive restart",
  );
  async function apiCall(route, body, token, extra = {}, method) {
    const response = await fetch("http://127.0.0.1:3215/api/v1/" + route, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      body: response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : null,
    };
  }
  const resellerPassword = randomBytes(24).toString("hex");
  const reseller = await apiCall(
    "admin/resellers",
    {
      email: "manual@example.test",
      password: resellerPassword,
      name: "Manual payment test",
      initialCredits: 0,
    },
    session.token,
  );
  assert.equal(reseller.status, 201);
  const resellerLogin = await apiCall(
    "auth/login",
    { email: "manual@example.test", password: resellerPassword },
    session.token,
  );
  assert.equal(resellerLogin.status, 200);
  const resellerToken = resellerLogin.body.token;
  // Multi-level reseller tree: each reseller can create a direct child and
  // ancestors can observe their whole descendant branch without managing
  // a grandchild's balance directly.
  const level2Password = randomBytes(24).toString("hex");
  const level2 = await apiCall("admin/resellers", {
    email:"level2@example.test", password:level2Password, name:"Level 2", initialCredits:0
  }, resellerToken);
  assert.equal(level2.status,201);
  const level2Login = await apiCall("auth/login",{email:"level2@example.test",password:level2Password},session.token);
  assert.equal(level2Login.status,200);
  const level2Token=level2Login.body.token;

  // Credit the direct child, then let it allocate part of that balance to its own child.
  assert.equal((await apiCall(`admin/resellers/${level2.body.id}/credit`,{amount:8},resellerToken,{},"PUT")).status,200);
  const level3Password=randomBytes(24).toString("hex");
  const level3=await apiCall("admin/resellers",{
    email:"level3@example.test",password:level3Password,name:"Level 3",initialCredits:3
  },level2Token);
  assert.equal(level3.status,201);
  const level3Login=await apiCall("auth/login",{email:"level3@example.test",password:level3Password},session.token);
  assert.equal(level3Login.status,200);
  const level3Token=level3Login.body.token;
  const level4=await apiCall("admin/resellers",{
    email:"level4@example.test",password:randomBytes(24).toString("hex"),name:"Level 4",initialCredits:1
  },level3Token);
  assert.equal(level4.status,201,"a reseller descendant can create another reseller");

  const branch=await apiCall("admin/resellers",undefined,resellerToken);
  assert.equal(branch.status,200);
  assert.ok(branch.body.some(x=>x.id===level2.body.id&&x.hierarchyDepth===1));
  assert.ok(branch.body.some(x=>x.id===level3.body.id&&x.hierarchyDepth===2));
  assert.ok(branch.body.some(x=>x.id===level4.body.id&&x.hierarchyDepth===3));
  assert.ok(branch.body.find(x=>x.id===level2.body.id).descendantCount>=2);

  assert.equal(
    (await apiCall(`admin/resellers/${level3.body.id}/credit`,{amount:1},resellerToken,{},"PUT")).status,
    403,
    "an ancestor sees descendants but cannot bypass the direct-parent credit boundary",
  );
  assert.equal(
    (await apiCall(`admin/resellers/${level3.body.id}/credit`,{amount:1},level2Token,{},"PUT")).status,
    200,
    "the direct parent can transfer credits to its child",
  );
  const branchTransactions=await apiCall("admin/transactions",undefined,resellerToken);
  assert.ok(branchTransactions.body.some(x=>x.resellerId===level3.body.id),"ancestor sees descendant branch transactions");

  const plans = await apiCall("plans", undefined, resellerToken);
  const offer = plans.body.find((plan) => plan.priceCfa > 0);
  const order = await apiCall(
    "commerce/orders",
    { planId: offer.id },
    resellerToken,
    { "Idempotency-Key": "pg-manual-request-001" },
  );
  assert.equal(order.status, 201);
  assert.equal(
    (
      await apiCall(
        `commerce/orders/${order.body.id}/submit`,
        { channel: "MOMO", reference: "PG-MOMO-123456" },
        resellerToken,
      )
    ).status,
    200,
  );
  assert.equal(
    (await apiCall("auth/me", undefined, resellerToken)).body.credits,
    0,
    "declared transfers must never credit automatically",
  );
  const confirmation = {
    channel: "MOMO",
    reference: "PG-MOMO-123456",
    receivedAmount: offer.priceCfa,
    confirmedReceived: true,
  };
  assert.equal(
    (
      await apiCall(
        `commerce/orders/${order.body.id}/confirm`,
        confirmation,
        resellerToken,
      )
    ).status,
    403,
    "a reseller cannot approve a transfer",
  );
  const confirmations = await Promise.all(
    Array.from({ length: 4 }, () =>
      apiCall(
        `commerce/orders/${order.body.id}/confirm`,
        confirmation,
        session.token,
      ),
    ),
  );
  assert.ok(confirmations.every((result) => result.status === 200));
  assert.equal(
    (await apiCall("auth/me", undefined, resellerToken)).body.credits,
    offer.quotaGb,
    "concurrent admin approvals credit once",
  );
  const second = await apiCall(
    "commerce/orders",
    { planId: offer.id },
    resellerToken,
    { "Idempotency-Key": "pg-manual-request-002" },
  );
  await apiCall(
    `commerce/orders/${second.body.id}/submit`,
    { channel: "MOMO", reference: "PG-MOMO-123456" },
    resellerToken,
  );
  assert.equal(
    (
      await apiCall(
        `commerce/orders/${second.body.id}/confirm`,
        confirmation,
        session.token,
      )
    ).status,
    409,
    "a receipt cannot credit another order",
  );
  assert.equal(
    (
      await apiCall(
        `commerce/orders/${order.body.id}/invoice`,
        undefined,
        resellerToken,
      )
    ).status,
    200,
  );
  const backupResponse = await fetch(
    "http://127.0.0.1:3215/api/v1/admin/operations/backup",
    { headers: { Authorization: `Bearer ${session.token}` } },
  );
  assert.equal(backupResponse.status, 200);
  const backupFile = path.join(dir, "restore-fixture.encrypted.json");
  await writeFile(backupFile, JSON.stringify(await backupResponse.json()));
  await stop();
  await store.transaction(() => {
    const users = store.read(path.join(dir, "users.json"));
    users[0].name = "Changed after snapshot";
    store.write(path.join(dir, "users.json"), users);
  });
  const restore = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/restore-backup.mjs",
      backupFile,
      "--maintenance-confirmed",
    ],
    { env, stdio: "ignore" },
  );
  assert.equal(
    await new Promise((resolve) => restore.once("close", resolve)),
    0,
    "offline encrypted restore must complete",
  );
  await store.transaction(() => {
    assert.notEqual(
      store.read(path.join(dir, "users.json"))[0].name,
      "Changed after snapshot",
    );
    assert.deepEqual(store.read(path.join(dir, "security.json")).sessions, {});
  });
  console.log(
    "PostgreSQL passed: migration, rollback, 16 concurrent operations, API login, persistent sessions, recursive reseller hierarchy and branch isolation, manual transfer approval, no automatic credit, concurrent approval idempotence, encrypted offline recovery drill.",
  );
} finally {
  await stop();
  await store.pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
  await rm(dir, { recursive: true, force: true });
}
