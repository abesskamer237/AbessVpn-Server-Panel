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
  observedAt?: string;
  snapshotHash?: string;
  online?: number;
  counters?: Record<string, number>;
  /** Explicit administrator opt-in to automated SSH-WS user provisioning. */
  sshWsManaged?: boolean;
  sshWsFingerprint?: string;
  sshWsSni?: string;
  sshWsPath?: string;
  sshWsPort?: number;
  sshWsAgentSeenAt?: string;
  sshWsHost?: {
    observedAt: string;
    uptimeSeconds: number;
    cpuPercent: number;
    load1: number;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    diskTotalBytes: number;
    diskFreeBytes: number;
    services: {sshd: boolean; gateway: boolean; reconciler: boolean};
  };
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
    private monitoringConfigured: () => boolean = () => true,
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
    if (process.env.SSH_WSS_ONLY!=='true' && this.monitoringConfigured() && !this.xrayReady()) alerts.push("XRAY_NOT_READY");
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
      monitoringConfigured: this.monitoringConfigured(),
      storage: this.postgres() ? "postgresql" : "json-development",
      freeBytes,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryBytes: process.memoryUsage().rss,
      loadAverage: os.loadavg(),
      backup: this.lastBackup,
    };
  }
  async notify(health = this.health()) {
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
    nodeSshDesired: (node: VpnNode) => unknown;
    nodeSshReport: (node: VpnNode, reports: Array<{id: string; state: string; usedBytes?: number; online?: number}>) => void;
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
        .map(({ keyHash, counters, generation, snapshotHash, ...node }) => ({
          ...node,
          stale:
            !node.lastSeenAt ||
            Date.now() - Date.parse(node.lastSeenAt) > 60000,
        })),
    ),
  );
  app.post("/api/v1/admin/nodes", d.authenticate, admin, (req, res) => {
    const name = String(req.body?.name || "").trim();
    const host = String(req.body?.host || "").trim().toLowerCase();
    if (
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
  app.post('/api/v1/admin/nodes/:id/key', d.authenticate, admin, (req, res) => {
    const nodes=d.readNodes(), node=nodes.find(n=>n.id===req.params.id);
    if(!node)return res.sendStatus(404);
    const key=crypto.randomBytes(32).toString('hex');
    node.keyHash=digest(key);node.enabled=true;node.ready=false;delete node.lastSeenAt;
    // Preserve generation and counter baselines so rotation never bills history twice.
    d.saveNodes(nodes);d.audit({action:'NODE_KEY_ROTATED',actor:(req as any).user.id,role:'SUPER_ADMIN',details:node.id});
    res.set('Cache-Control','no-store').json({id:node.id,key});
  });
  // Security boundary: admin must explicitly enable a managed node and pin its
  // SSH server fingerprint. This endpoint performs no VPS deployment.
  app.put('/api/v1/admin/nodes/:id/ssh-ws', d.authenticate, admin, (req, res) => {
    const nodes = d.readNodes(), node = nodes.find(n => n.id === req.params.id && n.enabled);
    if (!node) return res.sendStatus(404);
    if (typeof req.body?.enabled !== 'boolean') return res.sendStatus(400);
    if (req.body.enabled) {
      const fingerprint = String(req.body.fingerprint || '');
      const sni = String(req.body.sni || node.host).toLowerCase();
      const p = req.body.port === undefined ? 443 : Number(req.body.port);
      const wsPath = String(req.body.path || '/ssh-ws');
      if (!/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(fingerprint) ||
          !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(sni) ||
          !Number.isInteger(p) || p < 1 || p > 65535 ||
          !/^\/[A-Za-z0-9/_-]{1,80}$/.test(wsPath)) {
        return res.status(400).json({error:'Fingerprint SSH, SNI, chemin ou port WSS invalide.'});
      }
      node.sshWsFingerprint = fingerprint.replace(/=+$/, '');
      node.sshWsSni = sni;
      node.sshWsPort = p;
      node.sshWsPath = wsPath;
      node.sshWsManaged = true;
    } else {
      node.sshWsManaged = false;
    }
    d.saveNodes(nodes);
    d.audit({action:'NODE_SSH_WS_POLICY',actor:(req as any).user.id,role:'SUPER_ADMIN',
      details:JSON.stringify({nodeId:node.id,enabled:node.sshWsManaged})});
    return res.json({id:node.id,sshWsManaged:node.sshWsManaged,sshWsSni:node.sshWsSni,
      sshWsPort:node.sshWsPort,sshWsPath:node.sshWsPath,sshWsFingerprint:node.sshWsFingerprint});
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
  // Only the registered node's bearer key can read its own desired SSH user state.
  // Credentials are never included in the ordinary inventory endpoint.
  app.get('/api/v1/nodes/:id/ssh-ws/desired', d.limiter, nodeAuth, (req, res) => {
    const node = (req as any).vpnNode as VpnNode;
    if (!node.sshWsManaged) return res.sendStatus(403);
    return res.set('Cache-Control','no-store').json(d.nodeSshDesired(node));
  });
  app.post('/api/v1/nodes/:id/ssh-ws/status', d.limiter, nodeAuth, (req, res) => {
    const node = (req as any).vpnNode as VpnNode;
    if (!node.sshWsManaged) return res.sendStatus(403);
    const reports = req.body?.reports;
    if (!Array.isArray(reports) || reports.length > 2000 ||
        reports.some((x: any) => !x || typeof x.id !== 'string' ||
          !/^ssh_[a-f0-9-]{36}$/.test(x.id) ||
          !['active','blocked','error'].includes(x.state) ||
          (x.state==='active' && (x.usedBytes===undefined || x.online===undefined)) ||
          (x.usedBytes!==undefined && (!Number.isSafeInteger(x.usedBytes) || x.usedBytes<0)) ||
          (x.online!==undefined && (!Number.isInteger(x.online)||x.online<0||x.online>10)))) return res.sendStatus(400);
    const telemetry=req.body?.telemetry;
    let safeTelemetry:VpnNode['sshWsHost']|undefined;
    if(telemetry!==undefined){
      const observedAt=String(telemetry?.observedAt||'');
      const age=Date.now()-Date.parse(observedAt);
      const services=telemetry?.services;
      const nums=['uptimeSeconds','cpuPercent','load1','totalMemoryBytes','freeMemoryBytes','diskTotalBytes','diskFreeBytes'] as const;
      if(!Number.isFinite(age)||age<-5000||age>60000||!services||
        typeof services.sshd!=='boolean'||typeof services.gateway!=='boolean'||typeof services.reconciler!=='boolean'||
        nums.some(key=>!Number.isFinite(Number(telemetry?.[key]))||Number(telemetry[key])<0)||
        Number(telemetry.freeMemoryBytes)>Number(telemetry.totalMemoryBytes)||
        Number(telemetry.diskFreeBytes)>Number(telemetry.diskTotalBytes)){
        return res.sendStatus(400);
      }
      safeTelemetry={
        observedAt,
        uptimeSeconds:Math.floor(Number(telemetry.uptimeSeconds)),
        cpuPercent:Math.max(0,Math.min(100,Number(telemetry.cpuPercent))),
        load1:Number(telemetry.load1),
        totalMemoryBytes:Math.floor(Number(telemetry.totalMemoryBytes)),
        freeMemoryBytes:Math.floor(Number(telemetry.freeMemoryBytes)),
        diskTotalBytes:Math.floor(Number(telemetry.diskTotalBytes)),
        diskFreeBytes:Math.floor(Number(telemetry.diskFreeBytes)),
        services:{sshd:services.sshd,gateway:services.gateway,reconciler:services.reconciler}
      };
    }
    d.nodeSshReport(node, reports);
    const nodes=d.readNodes(), current=nodes.find(n=>n.id===node.id);
    if (current) {
      current.sshWsAgentSeenAt=new Date().toISOString();
      if(safeTelemetry)current.sshWsHost=safeTelemetry;
      d.saveNodes(nodes);
    }
    return res.set('Cache-Control','no-store').json({ok:true});
  });
    app.post("/api/v1/nodes/:id/heartbeat", d.limiter, nodeAuth, (req, res) => {
    const nodes = d.readNodes();
    const node = nodes.find((n) => n.id === (req as any).vpnNode.id)!;
    const snapshot = req.body?.snapshot;
    if (snapshot) {
      try {
        const time = Date.parse(snapshot.observedAt);
        const age = Date.now() - time;
        if (typeof snapshot.generation !== 'string' || !snapshot.generation.length || snapshot.generation.length > 100 ||
          !Number.isFinite(age) || age < -5000 || age > 60000 ||
          !Array.isArray(snapshot.stat) || snapshot.stat.length > 10000 ||
          (snapshot.accounts !== undefined && (!Array.isArray(snapshot.accounts) || snapshot.accounts.length > 5000))) throw Error('Invalid snapshot');
        const names = new Set<string>();
        for (const item of snapshot.stat) {
          if (!item || typeof item.name !== 'string' || item.name.length > 256 || names.has(item.name) ||
            !['number', 'string'].includes(typeof item.value) || String(item.value).trim() === '' || !Number.isSafeInteger(Number(item.value)) || Number(item.value) < 0) throw Error('Invalid counter');
          names.add(item.name);
        }
        const accounts = new Set<string>();
        for (const item of snapshot.accounts || []) {
          if (!item || typeof item.id !== 'string' || accounts.has(item.id) || !Number.isSafeInteger(item.usedBytes) || item.usedBytes < 0 ||
            (item.online !== undefined && (!Number.isSafeInteger(item.online) || item.online < 0))) throw Error('Invalid SSH counter');
          accounts.add(item.id);
        }
        const hash = digest(JSON.stringify(snapshot));
        const previousTime = Date.parse(node.observedAt || '');
        if (time < previousTime || (time === previousTime && hash !== node.snapshotHash)) throw Error('Out-of-order snapshot');
        if (hash !== node.snapshotHash) d.nodeUsage(node, snapshot);
        node.observedAt = snapshot.observedAt;
        node.snapshotHash = hash;
      } catch {
        return res.sendStatus(400);
      }
    }
    node.lastSeenAt = new Date().toISOString();
    node.ready = req.body?.ready === true && Boolean(snapshot);
    node.version = String(req.body?.version || "").slice(0, 40);
    d.saveNodes(nodes);
    res.json({ ok: true });
  });
}
