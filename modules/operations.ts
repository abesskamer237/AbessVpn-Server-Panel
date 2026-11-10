import { asyncHandler } from './http.js';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Express, RequestHandler } from "express";
import { seal, unseal, digest } from "./security.js";

export function encryptedBackup(snapshot: unknown, key: string) {
  if (key.length < 32)
    throw new Error("Backup key must contain at least 32 characters");
  const envelope = {
    format: "abess-backup-v1",
    createdAt: new Date().toISOString(),
    sealed: seal(snapshot, key),
  };
  // Every generated artifact is authenticated and decoded before retention/upload.
  if (JSON.stringify(unseal(envelope.sealed, key)) !== JSON.stringify(snapshot))
    throw new Error("Backup verification failed");
  return envelope;
}
export async function uploadBackup(name: string, envelope: unknown) {
  if (!process.env.BACKUP_S3_BUCKET) return false;
  if (
    process.env.BACKUP_S3_ENDPOINT &&
    new URL(process.env.BACKUP_S3_ENDPOINT).protocol !== "https:"
  )
    throw new Error("Offsite backups require HTTPS");
  const client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.BACKUP_S3_PATH_STYLE === "true",
  });
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.BACKUP_S3_BUCKET,
        Key: `abessvpn/${name}`,
        Body: JSON.stringify(envelope),
        ContentType: "application/json",
        ChecksumAlgorithm: "SHA256",
      }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
    return true;
  } finally {
    client.destroy();
  }
}
export interface VpnNode {
  id: string;
  name: string;
  host: string;
  keyHash?: string;
  enabled: boolean;
  lastSeenAt?: string;
  ready?: boolean;
  version?: string;
  activeLicences?: number;
  generation?: string;
  counters?: Record<string, number>;
}
export class Operations {
  private errors: number[]=[];
  private errorCount=0;
  recordError(){this.errorCount++;this.errors.push(Date.now());if(this.errors.length>1000)this.errors.shift();}
  private previousAlerts = "";
  private lastAlertAt = 0;
  lastBackup: { at: string; offsite: boolean; error?: string } | null = null;
  constructor(
    private dir: string,
    private xrayReady: () => boolean,
    private postgres: () => boolean,
  ) {}
  health() {
    let freeBytes = 0;
    try {
      const stat = fs.statfsSync(this.dir);
      freeBytes = Number(stat.bavail) * Number(stat.bsize);
    } catch {}
    const alerts: string[] = [];
    this.errors=this.errors.filter(time=>Date.now()-time<300000);
    if(this.errors.length>5)alerts.push('API_ERRORS');
    if (!this.xrayReady()) alerts.push("XRAY_NOT_READY");
    if (!this.postgres()) alerts.push("POSTGRES_NOT_CONFIGURED");
    if (freeBytes < 1024 ** 3) alerts.push("LOW_DISK_SPACE");
    if (
      !this.lastBackup ||
      Date.now() - Date.parse(this.lastBackup.at) > 26 * 3600000
    )
      alerts.push("BACKUP_OVERDUE");
    if (!process.env.BACKUP_S3_BUCKET)
      alerts.push("OFFSITE_BACKUP_NOT_CONFIGURED");
    if (process.env.BACKUP_S3_BUCKET && !this.lastBackup?.offsite)
      alerts.push("OFFSITE_BACKUP_UNCONFIRMED");
    return {
      apiErrorTotal:this.errorCount,
      ok: alerts.length === 0,
      alerts,
      xray: this.xrayReady(),
      storage: this.postgres() ? "postgresql" : "json-development",
      freeBytes,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryBytes: process.memoryUsage().rss,
      loadAverage: os.loadavg(),
      backup: this.lastBackup,
    };
  }
  async notify() {
    const health = this.health();
    const signature = health.alerts.join(",");
    if (!signature || !process.env.OPS_ALERT_WEBHOOK_URL) return;
    if (
      signature === this.previousAlerts &&
      Date.now() - this.lastAlertAt < 3600000
    )
      return;
    const url = new URL(process.env.OPS_ALERT_WEBHOOK_URL);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Alert endpoint must use HTTPS");
    const body = JSON.stringify({
      service: "abessvpn",
      at: new Date().toISOString(),
      alerts: health.alerts,
    });
    const signatureHeader = crypto
      .createHmac(
        "sha256",
        process.env.OPS_ALERT_WEBHOOK_SECRET || process.env.MASTER_SECRET!,
      )
      .update(body)
      .digest("hex");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Abess-Signature": signatureHeader,
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Alert delivery failed");
    this.previousAlerts = signature;
    this.lastAlertAt = Date.now();
  }
}
export function registerOperations(
  app: Express,
  d: {
    authenticate: RequestHandler;
    limiter: RequestHandler;
    ops: Operations;
    snapshot: () => Promise<any>;
    restore: (snapshot: any) => Promise<void>;
    readNodes: () => VpnNode[];
    saveNodes: (nodes: VpnNode[]) => void;
    audit: (event: any) => void;
    nodeConfig: (node: VpnNode) => unknown;
    nodeUsage: (node: VpnNode, snapshot: any) => void;
  },
) {
  const admin: RequestHandler = (req, res, next) => {
    if ((req as any).user?.role !== "SUPER_ADMIN") {
      res.sendStatus(403);
      return;
    }
    next();
  };
  app.get("/api/v1/admin/operations", d.authenticate, admin, (_req, res) =>
    res.set("Cache-Control", "no-store").json(d.ops.health()),
  );
  const metricsAuth: RequestHandler = (req, res, next) => {
    const expected = process.env.METRICS_TOKEN_FILE
      ? fs.readFileSync(process.env.METRICS_TOKEN_FILE, "utf8").trim()
      : process.env.METRICS_TOKEN;
    const supplied = req.headers.authorization?.replace(/^Bearer /, "") || "";
    if (
      expected &&
      expected.length >= 32 &&
      digest(expected) === digest(supplied)
    )
      return next();
    return d.authenticate(req, res, () => admin(req, res, next));
  };
  app.get("/api/v1/admin/metrics", metricsAuth, (_req, res) => {
    const h = d.ops.health();
    res
      .type("text/plain")
      .send(
        `abess_xray_ready ${Number(h.xray)}\nabess_disk_free_bytes ${h.freeBytes}\nabess_process_memory_bytes ${h.memoryBytes}\nabess_uptime_seconds ${h.uptimeSeconds}\nabess_alert_count ${h.alerts.length}\nabess_api_error_total ${h.apiErrorTotal}\n`,
      );
  });
  app.get(
    "/api/v1/admin/operations/backup",
    d.authenticate,
    admin,
    asyncHandler(async (_req, res) => {
      const backup = encryptedBackup(
        await d.snapshot(),
        process.env.BACKUP_ENCRYPTION_KEY || process.env.MASTER_SECRET!,
      );
      res
        .set("Cache-Control", "no-store")
        .attachment(`abess-${Date.now()}.encrypted.json`)
        .json(backup);
    }),
  );
  app.post(
    "/api/v1/admin/operations/restore",
    d.authenticate,
    admin,
    asyncHandler(async (req, res) => {
      try {
        if (req.body?.format !== "abess-backup-v1")
          throw new Error("Invalid envelope");
        const snapshot = unseal(
          req.body.sealed,
          process.env.BACKUP_ENCRYPTION_KEY || process.env.MASTER_SECRET!,
        );
        await d.restore(snapshot);
        d.audit({
          actor: (req as any).user.id,
          role: "SUPER_ADMIN",
          action: "ENCRYPTED_RESTORE",
          details: "Sauvegarde chiffrée restaurée.",
        });
        res.json({ ok: true, relogin: true });
      } catch {
        res
          .status(400)
          .json({ error: "Sauvegarde invalide, altérée ou clé incompatible." });
      }
    }),
  );
  app.get("/api/v1/admin/nodes", d.authenticate, admin, (_req, res) =>
    res.json(
      d
        .readNodes()
        .map(({ keyHash, counters, generation, ...node }) => ({
          ...node,
          stale:
            !node.lastSeenAt ||
            Date.now() - Date.parse(node.lastSeenAt) > 60000,
        })),
    ),
  );
  app.post("/api/v1/admin/nodes", d.authenticate, admin, (req, res) => {
    const name = String(req.body?.name || "").trim();
    const host = String(req.body?.host || "").trim();
    if (
      host === process.env.VPN_DOMAIN ||
      name.length < 1 ||
      name.length > 80 ||
      !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)
    )
      return res.status(400).json({ error: "Nom et hôte DNS requis." });
    const nodes = d.readNodes();
    if (nodes.some((n) => n.host === host))
      return res.status(409).json({ error: "Hôte déjà enregistré." });
    const key = crypto.randomBytes(32).toString("hex");
    const node = {
      id: crypto.randomUUID(),
      name,
      host,
      keyHash: digest(key),
      enabled: true,
    };
    nodes.push(node);
    d.saveNodes(nodes);
    d.audit({
      actor: (req as any).user.id,
      role: "SUPER_ADMIN",
      action: "NODE_REGISTERED",
      details: node.id,
    });
    res.set("Cache-Control", "no-store").status(201).json({ id: node.id, key });
  });
  app.delete("/api/v1/admin/nodes/:id", d.authenticate, admin, (req, res) => {
    const nodes = d.readNodes();
    const node = nodes.find((n) => n.id === req.params.id);
    if (!node) return res.sendStatus(404);
    node.enabled = false;
    delete node.keyHash;
    d.saveNodes(nodes);
    res.sendStatus(204);
  });
  const nodeAuth: RequestHandler = (req, res, next) => {
    const key = req.headers.authorization?.replace(/^Bearer /, "") || "";
    const node = d.readNodes().find((n) => n.id === req.params.id && n.enabled);
    if (
      !node?.keyHash ||
      !crypto.timingSafeEqual(
        Buffer.from(node.keyHash),
        Buffer.from(digest(key)),
      )
    ) {
      res.sendStatus(401);
      return;
    }
    (req as any).vpnNode = node;
    next();
  };
  app.get("/api/v1/nodes/:id/config", d.limiter, nodeAuth, (req, res) =>
    res
      .set("Cache-Control", "no-store")
      .json(d.nodeConfig((req as any).vpnNode)),
  );
  app.post("/api/v1/nodes/:id/heartbeat", d.limiter, nodeAuth, (req, res) => {
    const nodes = d.readNodes();
    const node = nodes.find((n) => n.id === (req as any).vpnNode.id)!;
    if (req.body?.snapshot) {
      try {
        d.nodeUsage(node, req.body.snapshot);
      } catch {
        return res.sendStatus(400);
      }
    }
    node.lastSeenAt = new Date().toISOString();
    node.ready = req.body?.ready === true;
    node.version = String(req.body?.version || "").slice(0, 40);
    d.saveNodes(nodes);
    res.json({ ok: true });
  });
}
