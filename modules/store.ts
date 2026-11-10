import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { RequestHandler } from "express";

export function canonicalJson(value: any): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

type Transaction = {
  client: PoolClient;
  documents: Map<string, unknown>;
  dirty: Set<string>;
  afterCommit: Array<() => void>;
  audit: unknown[];
  archivedAudit?: any[];
};
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
  "ssh",
  "nodes",
  "xray-usage-state",
];

/** Transactional document adapter preserves the established API while moving
 * every commercial aggregate into one PostgreSQL commit. Runtime Xray files
 * remain on the shared volume. JSON mode is explicitly development-only. */
export class DocumentStore {
  readonly pool: Pool | null;
  private context = new AsyncLocalStorage<Transaction>();
  private files: Set<string>;
  constructor(
    readonly directory: string,
    url?: string,
  ) {
    this.files = new Set(
      names.map((name) => path.resolve(directory, `${name}.json`)),
    );
    this.pool = url
      ? new Pool({
          connectionString: url,
          max: 8,
          connectionTimeoutMillis: 5000,
          statement_timeout: 30000,
          application_name: "abessvpn",
        })
      : null;
    this.pool?.on("error", () =>
      console.error("[DATABASE] Connection unavailable."),
    );
  }
  handles(file: string) {
    return this.pool !== null && this.files.has(path.resolve(file));
  }
  private current() {
    const tx = this.context.getStore();
    if (!tx) throw new Error("Business storage accessed outside a transaction");
    return tx;
  }
  exists(file: string) {
    return this.handles(file)
      ? this.current().documents.has(path.basename(file))
      : fs.existsSync(file);
  }
  read(file: string) {
    return this.handles(file)
      ? structuredClone(this.current().documents.get(path.basename(file)))
      : JSON.parse(fs.readFileSync(file, "utf8"));
  }
  write(file: string, value: unknown) {
    const tx = this.current();
    const name = path.basename(file);
    if (JSON.stringify(tx.documents.get(name)) === JSON.stringify(value))
      return false;
    tx.documents.set(name, structuredClone(value));
    tx.dirty.add(name);
    return true;
  }
  afterCommit(action: () => void) {
    const tx = this.context.getStore();
    if (tx) tx.afterCommit.push(action);
    else action();
  }
  appendAudit(event: unknown) {
    if (this.pool) this.current().audit.push(event);
  }
  async exportAudit() {
    return this.pool
      ? (
          await (this.context.getStore()?.client || this.pool).query(
            "SELECT event,previous_hash,hash,created_at FROM audit_events ORDER BY id",
          )
        ).rows
      : [];
  }
  importAudit(rows: any[]) {
    if (this.pool && Array.isArray(rows)) this.current().archivedAudit = rows;
  }
  async initialize() {
    if (!this.pool) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(2372026)");
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS app_documents(name text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS audit_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event jsonb NOT NULL, previous_hash text NOT NULL, hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());`);
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version=1",
      );
      if (!existing.rowCount) {
        for (const file of this.files) {
          if (fs.existsSync(file)) {
            const value = JSON.parse(fs.readFileSync(file, "utf8"));
            const arrays = new Set([
              "users",
              "tokens",
              "protocol-configs",
              "transactions",
              "announcements",
              "plans",
              "requests",
              "audit-logs",
              "nodes",
            ]);
            if (
              value === null ||
              typeof value !== "object" ||
              (arrays.has(path.basename(file, ".json")) &&
                !Array.isArray(value))
            )
              throw new Error("Invalid migration source");
            await client.query(
              "INSERT INTO app_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO NOTHING",
              [path.basename(file), JSON.stringify(value)],
            );
          }
        }
        await client.query("INSERT INTO schema_migrations(version) VALUES(1)");
      }
      await client.query(`CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_events is append only'; END $$;
        DROP TRIGGER IF EXISTS audit_no_mutation ON audit_events;
        CREATE TRIGGER audit_no_mutation BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async transaction<T>(work: () => T | Promise<T>): Promise<T> {
    if (!this.pool || this.context.getStore()) return work();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("SELECT pg_advisory_xact_lock(2372026)");
      const rows = await client.query("SELECT name,value FROM app_documents");
      const tx: Transaction = {
        client,
        documents: new Map(rows.rows.map((row) => [row.name, row.value])),
        dirty: new Set(),
        afterCommit: [],
        audit: [],
      };
      const result = await this.context.run(tx, work);
      for (const name of tx.dirty) {
        await client.query(
          "INSERT INTO app_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
          [name, JSON.stringify(tx.documents.get(name))],
        );
      }
      if (
        tx.archivedAudit?.length &&
        !(await client.query("SELECT 1 FROM audit_events LIMIT 1")).rowCount
      ) {
        let previous = "";
        for (const row of tx.archivedAudit) {
          const hash = crypto
            .createHmac("sha256", process.env.MASTER_SECRET!)
            .update(previous + canonicalJson(row.event))
            .digest("hex");
          if (row.previous_hash !== previous || row.hash !== hash)
            throw new Error("Invalid archived audit chain");
          await client.query(
            "INSERT INTO audit_events(event,previous_hash,hash,created_at) VALUES($1,$2,$3,$4)",
            [
              JSON.stringify(row.event),
              row.previous_hash,
              row.hash,
              row.created_at,
            ],
          );
          previous = row.hash;
        }
      }
      const auditable = [...tx.dirty].filter(
        (name) =>
          !["nodes.json", "xray-usage-state.json", "tokens.json"].includes(
            name,
          ),
      );
      if (auditable.length || tx.audit.length) {
        let previous =
          (
            await client.query(
              "SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1",
            )
          ).rows[0]?.hash || "";
        for (const event of [
          ...tx.audit,
          ...(auditable.length
            ? [
                {
                  action: "STORAGE_COMMIT",
                  documents: auditable.map((name) => ({
                    name,
                    hash: crypto
                      .createHash("sha256")
                      .update(canonicalJson(tx.documents.get(name)))
                      .digest("hex"),
                  })),
                },
              ]
            : []),
        ]) {
          const entry = { event, timestamp: new Date().toISOString() };
          const hash = crypto
            .createHmac("sha256", process.env.MASTER_SECRET || "")
            .update(previous + canonicalJson(entry))
            .digest("hex");
          await client.query(
            "INSERT INTO audit_events(event,previous_hash,hash) VALUES($1,$2,$3)",
            [JSON.stringify(entry), previous, hash],
          );
          previous = hash;
        }
      }
      await client.query("COMMIT");
      for (const action of tx.afterCommit) {
        try {
          action();
        } catch {
          console.error(
            "[RUNTIME] Post-commit projection failed; retry scheduled.",
          );
        }
      }
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  middleware(): RequestHandler {
    return (req, res, next) => {
      if (
        !this.pool ||
        !(
          req.path.startsWith("/api/") ||
          req.path.startsWith("/sub/") ||
          req.path.startsWith("/nexus/sub/")
        )
      )
        return next();
      const originalEnd = res.end.bind(res);
      const originalWrite = res.write.bind(res);
      const originalWriteHead = res.writeHead.bind(res);
      const chunks: Buffer[] = [];
      let head: unknown[] | undefined;
      let finish!: () => void;
      let fail!: (error: unknown) => void;
      const completed = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      res.writeHead = ((...args: unknown[]) => {
        head = args;
        return res;
      }) as typeof res.writeHead;
      res.write = ((chunk: any, encoding?: any) => {
        chunks.push(
          Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(
                chunk,
                typeof encoding === "string"
                  ? (encoding as BufferEncoding)
                  : undefined,
              ),
        );
        return true;
      }) as typeof res.write;
      res.end = ((chunk?: any, encoding?: any) => {
        if (chunk)
          chunks.push(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(
                  chunk,
                  typeof encoding === "string"
                    ? (encoding as BufferEncoding)
                    : undefined,
                ),
          );
        finish();
        return res;
      }) as typeof res.end;
      const onClose = () => fail(new Error("Client disconnected"));
      res.once("close", onClose);
      this.transaction(async () => {
        next();
        await completed;
        if (res.statusCode >= 500) throw new Error("Request failed");
      })
        .then(() => {
          res.removeListener("close", onClose);
          res.writeHead = originalWriteHead;
          res.write = originalWrite;
          res.end = originalEnd;
          if (head) (originalWriteHead as Function)(...head);
          originalEnd(Buffer.concat(chunks));
        })
        .catch(() => {
          res.removeListener("close", onClose);
          res.writeHead = originalWriteHead;
          res.write = originalWrite;
          res.end = originalEnd;
          if (!res.destroyed) {
            res.removeHeader("Content-Length");
            res
              .status(503)
              .json({
                error: "Opération annulée. Stockage indisponible ; réessayez.",
              });
          }
        });
    };
  }
}
