/** Independent SSH protocol implementation for TCP and HTTP Upgrade/WebSocket.
 * No OS users, shell, Docker socket or administrative SSH access. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import dns from "node:dns/promises";
import http from "node:http";
import { Transform } from "node:stream";
import ssh2 from "ssh2";
const { Server, utils } = ssh2;
import { WebSocketServer, createWebSocketStream } from "ws";
const control = process.env.SSH_CONTROL_DIR || "/ssh-control";
const data = process.env.SSH_DATA_DIR || "/ssh-data";
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
fs.mkdirSync(control, { recursive: true, mode: 0o700 });
function atomic(file, value) {
  fs.writeFileSync(file + ".new", JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(file + ".new", file);
}
const keyFile = path.join(data, "host.key");
if (!fs.existsSync(keyFile))
  fs.writeFileSync(
    keyFile,
    crypto.generateKeyPairSync("rsa", {
      modulusLength: 3072,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey,
    { mode: 0o600 },
  );
const key = fs.readFileSync(keyFile);
const publicKey = utils.parseKey(key).getPublicSSH();
const fingerprint =
  "SHA256:" +
  crypto
    .createHash("sha256")
    .update(publicKey)
    .digest("base64")
    .replace(/=+$/, "");
let state = { at: 0, enabled: false, accounts: [] };
let usage = {};
try {
  usage = JSON.parse(fs.readFileSync(path.join(data, "usage.json"), "utf8"));
} catch {}
const live = new Map();
const attempts = new Map();
const pending = new Set();
const allClients = new Set();
const blocked = new net.BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
])
  blocked.addSubnet(ip, bits, "ipv4");
// Only globally routed IPv6 unicast; exclude transition/translation mechanisms.
const ipv6Allowed = new net.BlockList();
ipv6Allowed.addSubnet("2000::", 3, "ipv6");
for (const [ip, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
])
  blocked.addSubnet(ip, bits, "ipv6");
export function isPublicAddress(ip) {
  const family = net.isIP(ip);
  return family === 4
    ? !blocked.check(ip, "ipv4")
    : family === 6 &&
        ipv6Allowed.check(ip, "ipv6") &&
        !blocked.check(ip, "ipv6");
}
function fresh() {
  const age = Date.now() - state.at;
  return state.enabled && age >= -5000 && age < 30000;
}
function allowed(a) {
  return (
    fresh() &&
    a?.enabled &&
    /^[a-f0-9]{64}$/.test(a.verifier) &&
    /^[a-f0-9]{32}$/.test(a.salt) &&
    Date.parse(a.expiresAt) > Date.now() &&
    (usage[a.id] || 0) < a.quotaBytes
  );
}
function disconnect(id) {
  for (const c of live.get(id) || []) c.end();
}
function load() {
  try {
    const input = JSON.parse(
      fs.readFileSync(path.join(control, "config.json"), "utf8"),
    );
    if (!Array.isArray(input.accounts) || input.accounts.length > 5000)
      throw new Error();
    state = input;
    const ids = new Set(state.accounts.map((a) => a.id));
    for (const id of Object.keys(usage)) if (!ids.has(id)) delete usage[id];
    for (const a of state.accounts)
      usage[a.id] = Math.max(usage[a.id] || 0, a.usedBytes || 0);
  } catch {
    state.enabled = false;
  }
  for (const [id, clients] of live) {
    const a = state.accounts.find((a) => a.id === id);
    if (!allowed(a)) disconnect(id);
    else for (const c of [...clients].slice(a.maxConnections)) c.end();
  }
  // Persist usage before publishing it. Refuse service if accounting cannot be saved.
  try {
    atomic(path.join(data, "usage.json"), usage);
    atomic(path.join(control, "stats.json"), {
      at: Date.now(),
      ready: fresh(),
      fingerprint,
      accounts: state.accounts.map((a) => ({
        id: a.id,
        usedBytes: usage[a.id] || 0,
        online: live.get(a.id)?.size || 0,
      })),
    });
  } catch {
    state.enabled = false;
    for (const id of live.keys()) disconnect(id);
  }
  for (const [ip, a] of attempts)
    if (Date.now() - a.at > 60000) attempts.delete(ip);
}
load();
function connection(client, info) {
  if (allClients.size >= 256 || !fresh()) {
    client.end();
    return;
  }
  pending.add(client);
  allClients.add(client);
  let account;
  let checks = 0;
  let authenticationPending = false;
  const ip = info.ip || "unknown";
  client.on("error", () => {});
  client.on("authentication", (ctx) => {
    if (
      authenticationPending ||
      account ||
      ++checks > 5 ||
      ctx.method !== "password"
    ) {
      ctx.reject(["password"]);
      return;
    }
    const attempt = attempts.get(ip) || { count: 0, at: Date.now() };
    if (attempt.count >= 100 || attempts.size > 10000) {
      ctx.reject(["password"]);
      return;
    }
    attempt.count++;
    attempts.set(ip, attempt);
    const a = state.accounts.find((a) => a.username === ctx.username);
    if (
      !allowed(a) ||
      typeof ctx.password !== "string" ||
      ctx.password.length > 256
    ) {
      ctx.reject(["password"]);
      return;
    }
    authenticationPending = true;
    crypto.scrypt(ctx.password, a.salt, 32, (err, hash) => {
      authenticationPending = false;
      const current = state.accounts.find((other) => other.id === a.id);
      if (
        err ||
        !allowed(current) ||
        current.verifier !== a.verifier ||
        !crypto.timingSafeEqual(hash, Buffer.from(a.verifier, "hex")) ||
        (live.get(a.id)?.size || 0) >= a.maxConnections ||
        !pending.has(client)
      ) {
        ctx.reject(["password"]);
        return;
      }
      account = a.id;
      if (!live.has(a.id)) live.set(a.id, new Set());
      live.get(a.id).add(client);
      ctx.accept();
    });
  });
  client.on("ready", () => {
    pending.delete(client);
    // No executable commands, PTY, SFTP, remote forwarding or OS shell.
    client.on("session", (accept) => {
      const session = accept();
      for (const event of ["exec", "pty", "sftp", "env"])
        session.on(event, (_accept, reject) => reject?.());
      session.on("shell", (acceptShell) => {
        const stream = acceptShell();
        stream.write("ABESS VPN: SSH TCP forwarding only.\r\n");
        stream.resume();
      });
    });
    let channels = 0;
    const sockets = new Set();
    client.once("close", () => {
      for (const s of sockets) s.destroy();
    });
    client.on("tcpip", async (accept, reject, info) => {
      const a = state.accounts.find((a) => a.id === account);
      if (
        !allowed(a) ||
        channels >= 32 ||
        !Number.isInteger(info.destPort) ||
        info.destPort < 1 ||
        info.destPort > 65535 ||
        info.destIP.length > 253
      ) {
        reject();
        return;
      }
      channels++;
      try {
        const answers = await dns.lookup(info.destIP, { all: true });
        if (!answers.length || answers.some((v) => !isPublicAddress(v.address)))
          throw new Error();
        const current = state.accounts.find((v) => v.id === account);
        if (!allowed(current) || client.destroyed) throw new Error();
        const target = net.createConnection({
          host: answers[0].address,
          family: answers[0].family,
          port: info.destPort,
          timeout: 15000,
        });
        sockets.add(target);
        let accepted = false;
        target.once("connect", () => {
          const a = state.accounts.find((v) => v.id === account);
          if (!allowed(a)) {
            target.destroy();
            reject();
            return;
          }
          target.setTimeout(120000);
          accepted = true;
          const channel = accept();
          const meter = () =>
            new Transform({
              transform(chunk, _encoding, callback) {
                const current = state.accounts.find((v) => v.id === account);
                if (
                  !allowed(current) ||
                  chunk.length > current.quotaBytes - (usage[account] || 0)
                ) {
                  usage[account] = current?.quotaBytes || usage[account];
                  disconnect(account);
                  callback(new Error("quota"));
                  return;
                }
                usage[account] = (usage[account] || 0) + chunk.length;
                callback(null, chunk);
              },
            });
          const up = meter(),
            down = meter();
          for (const s of [channel, up, down])
            s.on("error", () => {
              channel.destroy();
              target.destroy();
            });
          channel.pipe(up).pipe(target);
          target.pipe(down).pipe(channel);
          channel.on("close", () => target.destroy());
          target.on("close", () => channel.destroy());
        });
        target.on("timeout", () => target.destroy());
        target.on("error", () => {
          if (!accepted) reject();
        });
        target.once("close", () => {
          channels--;
          sockets.delete(target);
        });
      } catch {
        channels--;
        reject();
      }
    });
  });
  client.once("close", () => {
    pending.delete(client);
    allClients.delete(client);
    if (account) {
      live.get(account)?.delete(client);
      if (!live.get(account)?.size) live.delete(account);
    }
  });
}
const config = { hostKeys: [key], ident: "ABESS_SSH", readyTimeout: 15000 };
const tcp = new Server(config, connection);
tcp.listen(Number(process.env.SSH_LISTEN_PORT || 2222), "0.0.0.0");
const upgrade = new Server(config, connection);
const web = http.createServer((req, res) => {
  res.writeHead(req.url === "/health" && fresh() ? 200 : 404);
  res.end();
});
const framed = new WebSocketServer({
  noServer: true,
  maxPayload: 256 * 1024,
  perMessageDeflate: false,
});
web.on("upgrade", (req, socket, head) => {
  socket.on("error", () => {});
  if (
    !fresh() ||
    req.url !== "/ws-ssh" ||
    String(req.headers.upgrade).toLowerCase() !== "websocket"
  ) {
    socket.destroy();
    return;
  }
  if (req.headers["sec-websocket-key"]) {
    framed.handleUpgrade(req, socket, head, (ws) => {
      const stream = createWebSocketStream(ws);
      stream.remoteAddress = socket.remoteAddress;
      stream.remotePort = socket.remotePort;
      stream.remoteFamily = socket.remoteFamily;
      upgrade.injectSocket(stream);
    });
  } else {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    if (head.length) socket.unshift(head);
    upgrade.injectSocket(socket);
  }
});
web.maxConnections = 512;
web.headersTimeout = 10000;
web.requestTimeout = 10000;
web.listen(Number(process.env.SSH_WS_PORT || 8085), "0.0.0.0");
const timer = setInterval(load, 1000);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    state.enabled = false;
    for (const id of live.keys()) disconnect(id);
    atomic(path.join(data, "usage.json"), usage);
    clearInterval(timer);
    tcp.close();
    web.close();
    for (const c of pending) c.end();
    process.exit(0);
  });
console.log(
  "SSH gateway started; shell and private-network forwarding disabled.",
);
