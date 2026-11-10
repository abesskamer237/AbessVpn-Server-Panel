import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { spawn } from "node:child_process";
import ssh2 from "ssh2";
const { Client } = ssh2;
import WebSocket, { createWebSocketStream } from "ws";
import { setTimeout as delay } from "node:timers/promises";
const targetHost = process.env.SSH_TEST_TARGET_HOST;
assert.match(
  targetHost || "",
  /^11\.237\.0\./,
  "Run using test-ssh-docker.sh in its isolated network",
);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "abess-ssh-test-"));
const control = path.join(dir, "control");
await fs.mkdir(control);
const logs = [];
const children = [];
const clients = [];
let api;
let gateway;
let bearer;
const password = crypto.randomBytes(24).toString("hex");
const target = http.createServer((req, res) => {
  res.end(Buffer.alloc(req.url === "/large" ? 12 * 1024 * 1024 : 65536, 65));
});
await new Promise((r) => target.listen(18080, targetHost, r));
const environment = {
  ...process.env,
  DATA_DIR: path.join(dir, "api"),
  SSH_CONTROL_DIR: control,
  SSH_DATA_DIR: path.join(dir, "gateway"),
  SSH_GATEWAY_ENABLED: "true",
  SSH_WS_HOST: targetHost,
  SSH_LISTEN_PORT: "12222",
  SSH_WS_PORT: "8085",
  PORT: "13188",
  NODE_ENV: "production",
  ALLOW_JSON_STORAGE: "true",
  COOKIE_SECURE: "false",
  VPN_DOMAIN: "vpn.example.test",
  ADMIN_EMAIL: "ssh-test@example.test",
  ADMIN_INITIAL_PASSWORD: password,
  MASTER_SECRET: crypto.randomBytes(32).toString("hex"),
  TELEGRAM_BOT_TOKEN: "",
  DATABASE_URL: "",
};
function start(args) {
  const p = spawn(process.execPath, args, { env: environment });
  children.push(p);
  p.stdout.on("data", () => {});
  p.stderr.on("data", (b) => logs.push(b.toString()));
  return p;
}
async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    try {
      if (await check()) return;
    } catch {}
    await delay(100);
  }
  throw new Error(message);
}
async function request(route, body, method) {
  const r = await fetch("http://127.0.0.1:13188/api/v1/" + route, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  return { status: r.status, data };
}
function connect(config, sock) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    clients.push(c);
    c.on("error", reject);
    c.once("ready", () => resolve(c));
    c.connect({
      host: "127.0.0.1",
      port: 12222,
      username: config.username,
      password: config.password,
      readyTimeout: 5000,
      hostHash: "sha256",
      hostVerifier: (digest) =>
        "SHA256:" +
          Buffer.from(digest, "hex").toString("base64").replace(/=+$/, "") ===
        config.fingerprint,
      ...(sock ? { sock } : {}),
    });
  });
}
function forward(client, host, port) {
  return new Promise((resolve, reject) =>
    client.forwardOut("127.0.0.1", 12345, host, port, (err, channel) =>
      err ? reject(err) : resolve(channel),
    ),
  );
}
async function transfer(client, url = "/") {
  const channel = await forward(client, targetHost, 18080);
  let total = 0;
  channel.on("error", () => {});
  channel.on("data", (b) => (total += b.length));
  channel.end(`GET ${url} HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n`);
  await new Promise((r) => channel.on("close", r));
  return total;
}
async function close(c) {
  const done = new Promise((r) => c.once("close", r));
  c.end();
  await done;
}
try {
  api = start(["--import", "tsx", "server.ts"]);
  await until(
    async () => (await fetch("http://127.0.0.1:13188/api/v1/ping")).ok,
    "API did not start",
  );
  gateway = start(["scripts/ssh-gateway.mjs"]);
  bearer = (
    await request("auth/login", { email: environment.ADMIN_EMAIL, password })
  ).data.token;
  assert.ok(bearer);
  const resellerEmail = "ssh-reseller@example.test";
  const resellerPassword = crypto.randomBytes(24).toString("hex");
  assert.equal(
    (
      await request("admin/resellers", {
        email: resellerEmail,
        password: resellerPassword,
        name: "SSH scope test",
        initialCredits: 0,
      })
    ).status,
    201,
  );
  const adminBearer = bearer;
  bearer = (
    await request("auth/login", {
      email: resellerEmail,
      password: resellerPassword,
    })
  ).data.token;
  assert.equal(
    (await request("admin/ssh")).status,
    403,
    "Reseller cannot access SSH administration",
  );
  bearer = adminBearer;

  await until(
    async () => (await request("admin/ssh")).data.ready,
    "SSH not ready",
  );
  const created = await request("admin/ssh/accounts", {
    username: "ssh_demo",
    label: "Test SSH",
    days: 1,
    quotaGb: 0.01,
    maxConnections: 1,
  });
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal(created.data.verifier, undefined);
  assert.equal(created.data.password, undefined);
  assert.equal(
    (
      await request("admin/ssh/accounts", {
        username: "ssh_demo",
        days: 1,
        quotaGb: 0.01,
        maxConnections: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("admin/ssh/accounts", {
        username: "root;id",
        days: 1,
        quotaGb: 0.01,
        maxConnections: 1,
      })
    ).status,
    400,
  );
  const config = (
    await request(`admin/ssh/accounts/${id}/config`, { transport: "wss-alt" })
  ).data;
  assert.equal(config.port, 2084);
  assert.equal(config.path, "/ws-ssh");
  assert.equal(config.tls, true);
  assert.match(config.payload, /Upgrade: websocket/);
  const stored = JSON.parse(
    await fs.readFile(path.join(environment.DATA_DIR, "ssh.json"), "utf8"),
  );
  assert.ok(
    !JSON.stringify(stored).includes(config.password),
    "Password encrypted at rest",
  );
  await delay(1200);
  await assert.rejects(connect({ ...config, password: "wrong-password" }));
  let client = await connect(config);
  assert.ok(
    (await transfer(client)) > 65536,
    "Real SSH forwarded HTTP response",
  );
  await assert.rejects(connect(config), "Concurrent login limited");
  await assert.rejects(
    forward(client, "127.0.0.1", 13188),
    "Private API access denied",
  );
  await assert.rejects(
    forward(client, "::ffff:127.0.0.1", 13188),
    "Mapped IPv6 private access denied",
  );
  await new Promise((resolve) =>
    client.exec("id", (err) => {
      assert.ok(err, "OS commands denied");
      resolve();
    }),
  );
  await close(client);
  const raw = net.connect(8085, "127.0.0.1");
  await new Promise((resolve, reject) => {
    let response = Buffer.alloc(0);
    raw.on("error", reject);
    const read = (chunk) => {
      response = Buffer.concat([response, chunk]);
      const end = response.indexOf("\r\n\r\n");
      if (end < 0) return;
      raw.removeListener("data", read);
      raw.pause();
      assert.match(
        response.subarray(0, end).toString(),
        /101 Switching Protocols/,
      );
      if (response.length > end + 4) raw.unshift(response.subarray(end + 4));
      resolve();
    };
    raw.on("data", read);
    raw.write(
      "GET /ws-ssh HTTP/1.1\r\nHost: test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
  });
  client = await connect(config, raw);
  assert.ok((await transfer(client)) > 65536, "Raw HTTP Upgrade SSH works");
  await close(client);
  for (const [mode, port, isTls] of [
    ["ws", 80, false],
    ["ws-alt", 85, false],
    ["wss-raw", 443, true],
    ["wss-raw-alt", 2084, true],
  ]) {
    const exported = await request(`admin/ssh/accounts/${id}/config`, {
      transport: mode,
    });
    assert.equal(exported.status, 200);
    assert.equal(exported.data.port, port);
    assert.equal(exported.data.tls, isTls);
    assert.equal(exported.data.wire, "http-upgrade");
    assert.equal(
      exported.data.host,
      isTls ? environment.VPN_DOMAIN : targetHost,
      "Plain SSH-WS uses the direct origin, TLS retains its certified domain",
    );
    assert.equal(exported.data.path, "/ws-ssh");
    assert.ok(!exported.data.payload.includes("Sec-WebSocket-Key"));
  }
  if (process.env.SSH_TEST_CADDY_HOST) {
    for (const port of [80, 85, 443, 2084]) {
      const socket =
        port < 100
          ? net.connect(port, process.env.SSH_TEST_CADDY_HOST)
          : tls.connect({
              host: process.env.SSH_TEST_CADDY_HOST,
              servername: process.env.SSH_TEST_CADDY_HOST,
              port,
            });
      await new Promise((resolve, reject) => {
        let response = Buffer.alloc(0);
        socket.on("error", reject);
        const read = (chunk) => {
          response = Buffer.concat([response, chunk]);
          const end = response.indexOf("\r\n\r\n");
          if (end < 0) return;
          socket.off("data", read);
          socket.pause();
          assert.match(
            response.subarray(0, end).toString(),
            /^HTTP\/1[.]1 101/,
          );
          if (response.length > end + 4)
            socket.unshift(response.subarray(end + 4));
          resolve();
        };
        socket.on("data", read);
        socket.write(
          "GET /ws-ssh HTTP/1.1\r\nHost: ssh-tls\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
        );
      });
      const rawClient = await connect(config, socket);
      assert.ok(
        (await transfer(rawClient)) > 65536,
        `Raw SSH-WS through Caddy ${port}`,
      );
      await close(rawClient);
    }
    const redirect = await fetch(
      `http://${process.env.SSH_TEST_CADDY_HOST}/api/v1/ping`,
      { redirect: "manual" },
    );
    assert.equal(redirect.status, 308, "Management API stays on HTTPS");
    assert.equal(
      (await fetch(`http://${process.env.SSH_TEST_CADDY_HOST}:85/api/v1/ping`))
        .status,
      404,
      "No management API on WS-only port",
    );
    for (const port of [443, 2084]) {
      const tlsWs = new WebSocket(
        `wss://${process.env.SSH_TEST_CADDY_HOST}:${port}/ws-ssh`,
      );
      const tlsStream = createWebSocketStream(tlsWs);
      tlsStream.on("error", () => {});
      await new Promise((resolve, reject) => {
        tlsWs.once("open", resolve);
        tlsWs.once("error", reject);
      });
      const tlsClient = await connect(config, tlsStream);
      assert.ok(
        (await transfer(tlsClient)) > 65536,
        `Production Caddy WSS routing on ${port}`,
      );
      await close(tlsClient);
    }
  }
  const ws = new WebSocket("ws://127.0.0.1:8085/ws-ssh");
  const wsStream = createWebSocketStream(ws);
  wsStream.on("error", () => {});
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  client = await connect(config, wsStream);
  assert.ok((await transfer(client)) > 65536, "Framed WebSocket SSH works");
  await request(`admin/ssh/accounts/${id}`, { enabled: false }, "PATCH");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Revocation did not disconnect")),
      4000,
    );
    client.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await assert.rejects(connect(config), "Disabled user cannot authenticate");
  await request(`admin/ssh/accounts/${id}`, { enabled: true }, "PATCH");
  await delay(1200);
  client = await connect(config);
  await transfer(client, "/large");
  await delay(1200);
  await assert.rejects(connect(config), "Exhausted quota prevents reconnect");
  const usage = JSON.parse(
    await fs.readFile(
      path.join(environment.SSH_DATA_DIR, "usage.json"),
      "utf8",
    ),
  );
  assert.equal(usage[id], 10000000, "Quota enforced and persisted");
  const fingerprint = config.fingerprint;
  gateway.kill("SIGTERM");
  await new Promise((r) => gateway.once("exit", r));
  gateway = start(["scripts/ssh-gateway.mjs"]);
  await delay(1200);
  assert.equal(
    (await request(`admin/ssh/accounts/${id}/config`, { transport: "tcp" }))
      .data.fingerprint,
    fingerprint,
    "Stable host key across restarts",
  );
  await assert.rejects(connect(config), "Restart does not reset quota");
  api.kill("SIGTERM");
  await new Promise((r) => api.once("exit", r));
  const projectionPath = path.join(control, "config.json");
  const projection = JSON.parse(await fs.readFile(projectionPath, "utf8"));
  projection.at = Date.now() - 31000;
  await fs.writeFile(projectionPath, JSON.stringify(projection));
  await delay(1200);
  const status = JSON.parse(
    await fs.readFile(path.join(control, "stats.json"), "utf8"),
  );
  assert.equal(status.ready, false, "Stale controller closes gateway");
  console.log(
    "SSH integration PASS: TCP, raw Upgrade, framed WS, raw SSH-WS 80/85/443/2084 and Caddy WSS, credentials, host key, session cap, private access denied, revocation, quota, restart and fail-closed.",
  );
} catch (e) {
  console.error("SSH integration failed:", e.message);
  for (const line of logs.slice(-5))
    console.error(line.replaceAll(password, "[redacted]"));
  process.exitCode = 1;
} finally {
  for (const c of clients) c.destroy();
  for (const p of children) if (p.exitCode === null) p.kill("SIGKILL");
  target.closeAllConnections();
  await new Promise((r) => target.close(r));
  await fs.rm(dir, { recursive: true, force: true });
}
