import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DocumentStore } from "../modules/store.ts";
import { unseal } from "../modules/security.ts";
import { encryptedBackup } from "../modules/operations.ts";
if (!process.argv.includes("--maintenance-confirmed"))
  throw new Error("Stop the API first, then pass --maintenance-confirmed.");
const file = process.argv.find(
  (value, index) => index > 1 && !value.startsWith("--"),
);
const master = process.env.MASTER_SECRET;
const key = process.env.BACKUP_ENCRYPTION_KEY || master;
if (!file || !process.env.DATABASE_URL || !master || master.length < 32 || !key)
  throw new Error(
    "Backup path, DATABASE_URL and the original keys are required.",
  );
const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
if (envelope.format !== "abess-backup-v1")
  throw new Error("Unsupported backup");
const snapshot = unseal(envelope.sealed, key);
if (
  snapshot.version !== 3 ||
  snapshot.masterKeyId !==
    crypto.createHash("sha256").update(master).digest("hex").slice(0, 16)
)
  throw new Error("Master key mismatch");
if (
  !Array.isArray(snapshot.users) ||
  !snapshot.users.some(
    (u) => u.role === "SUPER_ADMIN" && u.status === "active",
  ) ||
  !Array.isArray(snapshot.tokens) ||
  !Array.isArray(snapshot.plans) ||
  !Array.isArray(snapshot.protocolConfigs)
)
  throw new Error("Invalid backup structure");
const directory = process.env.DATA_DIR || path.resolve("data");
fs.mkdirSync(directory, { recursive: true });
const store = new DocumentStore(directory, process.env.DATABASE_URL);
try {
  await store.initialize();
  await store.transaction(() => {
    const names = [
      "users",
      "tokens",
      "config",
      "protocol-configs",
      "transactions",
      "app-version",
      "announcements",
      "plans",
      "requests",
      "audit-logs",
      "security",
      "commerce",
      "nodes",
      "xray-usage-state",
    ];
    const previous = {};
    for (const name of names) {
      const file = path.join(directory, name + ".json");
      if (store.exists(file)) previous[name] = store.read(file);
    }
    const backupDirectory = path.join(directory, "backups");
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(
        backupDirectory,
        "pre-offline-restore-" + Date.now() + ".encrypted.json",
      ),
      JSON.stringify(
        encryptedBackup(
          {
            version: 3,
            masterKeyId: snapshot.masterKeyId,
            users: previous.users || [],
            tokens: previous.tokens || [],
            masterConfig: previous.config,
            protocolConfigs: previous["protocol-configs"] || [],
            plans: previous.plans || [],
            requests: previous.requests || [],
            transactions: previous.transactions || [],
            appVersion: previous["app-version"],
            announcements: previous.announcements || [],
            security: { mfa: previous.security?.mfa || {}, sessions: {} },
            commerce: previous.commerce || { orders: [] },
            nodes: previous.nodes || [],
          },
          key,
        ),
      ),
      { mode: 0o600, flag: "wx" },
    );
    const docs = {
      users: snapshot.users,
      tokens: snapshot.tokens,
      config: snapshot.masterConfig,
      "protocol-configs": snapshot.protocolConfigs,
      plans: snapshot.plans,
      requests: snapshot.requests || [],
      transactions: snapshot.transactions || [],
      "app-version": snapshot.appVersion,
      announcements: snapshot.announcements || [],
      security: { mfa: snapshot.security?.mfa || {}, sessions: {} },
      commerce: snapshot.commerce || { orders: [] },
      nodes: snapshot.nodes || [],
      "xray-usage-state": { generation: "", lastCounters: {} },
    };
    for (const [name, value] of Object.entries(docs)) {
      if (value === undefined) throw new Error("Incomplete backup");
      store.write(path.join(directory, name + ".json"), value);
    }
    if (Array.isArray(snapshot.auditEvents))
      store.importAudit(snapshot.auditEvents);
    store.appendAudit({
      action: "OFFLINE_RESTORE",
      at: new Date().toISOString(),
    });
  });
  console.log(
    "Encrypted backup restored transactionally. Sessions revoked. Restart API and verify Xray before reopening access.",
  );
} finally {
  await store.pool.end();
}
