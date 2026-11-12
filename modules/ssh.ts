import crypto from "node:crypto";
import type { Express, RequestHandler } from "express";
import type { VpnNode } from "./operations.js";
import { seal, unseal } from "./security.js";
export interface SshAccount {
  id: string;
  username: string;
  label: string;
  salt?: string;
  verifier?: string;
  nodeId?: string;
  connection?: Record<string, any>;
  online?: number;
  password: string;
  quotaBytes: number;
  usedBytes: number;
  maxConnections: number;
  expiresAt: string;
  enabled: boolean;
  createdAt: string;
}
export interface SshState {
  accounts: SshAccount[];
}
export function safeSshAccount(a: SshAccount) {
  const { password, salt, verifier, ...safe } = a;
  return safe;
}
export function sshPayload(host: string, port = 80, pathname = '/ws-ssh') {
  const authority = [80, 443].includes(port) ? host : `${host}:${port}`;
  return `GET ${pathname} HTTP/1.1[crlf]Host: ${authority}[crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]`;
}
export function registerSsh(
  app: Express,
  d: {
    authenticate: RequestHandler;
    read: () => SshState;
    write: (s: SshState) => void;
    audit: (event: any) => void;
    key: string;
    nodes: () => VpnNode[];
  },
) {
  const guard: RequestHandler = (req, res, next) => {
    if ((req as any).user.role !== "SUPER_ADMIN") {
      res.sendStatus(403);
      return;
    }
    next();
  };
  const ready = (id?: string) => d.nodes().some(n => n.id === id && n.enabled && n.ready &&
    Date.now() - Date.parse(n.observedAt || '') >= -5000 && Date.now() - Date.parse(n.observedAt || '') <= 60000);
  app.get('/api/v1/admin/ssh', d.authenticate, guard, (_req, res) => {
    const nodes = d.nodes().filter(n => n.enabled);
    res.json({enabled: true, ready: nodes.some(n => ready(n.id)), nodes: nodes.map(n => ({id:n.id,name:n.name,host:n.host})),
      accounts: d.read().accounts.map(a => ({...safeSshAccount(a), online: ready(a.nodeId) ? a.online || 0 : 0}))});
  });
  app.post("/api/v1/admin/ssh/accounts", d.authenticate, guard, (req, res) => {
    const nodeId = String(req.body?.nodeId || '');
    const node = d.nodes().find(n => n.id === nodeId && n.enabled);
    const config = req.body?.config;
    const modes = ['tcp', 'ws', 'ws-alt', 'wss-raw', 'wss-raw-alt', 'wss', 'wss-alt'];
    if (!node || !config || config.host !== node.host || !modes.includes(config.transport) ||
      !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
      typeof config.password !== 'string' || !config.password.length || config.password.length > 1024 ||
      typeof config.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(config.fingerprint) ||
      (config.transport.startsWith('wss') && (config.tls !== true || typeof config.sni !== 'string' || !/^[a-zA-Z0-9.-]+$/.test(config.sni))) ||
      (config.path !== undefined && (typeof config.path !== 'string' || !config.path.startsWith('/') || config.path.length > 2048 || /[\r\n\x00]/.test(config.path)))) {
      res.status(400).json({error: 'Configuration SSH invalide.'}); return;
    }
    const username = String(config.username || "").trim();
    const label = String(req.body?.label || username).trim();
    const days = Number(req.body?.days);
    const quotaGb = Number(req.body?.quotaGb);
    const maxConnections = Number(req.body?.maxConnections);
    if (
      !/^[a-z][a-z0-9_-]{2,31}$/.test(username) ||
      label.length > 80 ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 366 ||
      !Number.isFinite(quotaGb) ||
      quotaGb < 0.01 ||
      quotaGb > 100000 ||
      !Number.isInteger(maxConnections) ||
      maxConnections < 1 ||
      maxConnections > 10
    ) {
      res.status(400).json({
        error:
          "Utilisateur : 3–32 caractères, durée : 1–366 jours, quota : 0,01–100000 Go, connexions : 1–10.",
      });
      return;
    }
    const state = d.read();
    if (
      state.accounts.length >= 5000 ||
      state.accounts.some((a) => a.username === username && a.nodeId === nodeId)
    ) {
      res
        .status(409)
        .json({ error: "Utilisateur déjà présent ou capacité atteinte." });
      return;
    }
    const password = config.password;
    const account: SshAccount = {
      id: "ssh_" + crypto.randomUUID(),
      username,
      label,
      nodeId,
      connection: {host:config.host, port:config.port, transport:config.transport, fingerprint:config.fingerprint,
        tls:config.transport.startsWith('wss'), sni:config.sni || null, path:config.path || '/ws-ssh',
        wire:config.transport === 'tcp' ? 'ssh' : ['wss','wss-alt'].includes(config.transport) ? 'websocket' : 'http-upgrade'},
      password: seal(password, d.key),
      quotaBytes: Math.floor(quotaGb * 1e9),
      usedBytes: 0,
      maxConnections,
      enabled: true,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
    };
    state.accounts.push(account);
    d.write(state);
    d.audit({
      action: "SSH_IMPORTED",
      by: (req as any).user.id,
      target: account.id,
    });
    res.status(201).json(safeSshAccount(account));
  });
  app.patch(
    "/api/v1/admin/ssh/accounts/:id",
    d.authenticate,
    guard,
    (req, res) => {
      const state = d.read();
      const a = state.accounts.find((a) => a.id === req.params.id);
      if (!a) {
        res.sendStatus(404);
        return;
      }
      if (typeof req.body?.enabled !== "boolean") {
        res.sendStatus(400);
        return;
      }
      a.enabled = req.body.enabled;
      d.write(state);
        d.audit({
        action: a.enabled ? "SSH_ENABLED" : "SSH_DISABLED",
        by: (req as any).user.id,
        target: a.id,
      });
      res.json(safeSshAccount(a));
    },
  );
  app.delete(
    "/api/v1/admin/ssh/accounts/:id",
    d.authenticate,
    guard,
    (req, res) => {
      const state = d.read();
      const index = state.accounts.findIndex((a) => a.id === req.params.id);
      if (index < 0) {
        res.sendStatus(404);
        return;
      }
      state.accounts.splice(index, 1);
      d.write(state);
        d.audit({
        action: "SSH_DELETED",
        by: (req as any).user.id,
        target: req.params.id,
      });
      res.sendStatus(204);
    },
  );
  app.post(
    "/api/v1/admin/ssh/accounts/:id/config",
    d.authenticate,
    guard,
    (req, res) => {
      const a = d.read().accounts.find((a) => a.id === req.params.id);
      if (!a) {
        res.sendStatus(404);
        return;
      }
      const transport = req.body?.transport;
      if (!a.connection || transport !== a.connection.transport) { res.sendStatus(400); return; }
      if (!a.enabled || Date.parse(a.expiresAt) <= Date.now() || a.usedBytes >= a.quotaBytes || !ready(a.nodeId)) {
        res.status(503).json({error: 'Accès SSH indisponible.'}); return;
      }
      d.audit({
        action: "SSH_CREDENTIALS_EXPORTED",
        by: (req as any).user.id,
        target: a.id,
      });
      res.set("Cache-Control", "no-store").json({
        format: "abess-ssh-v1",
        protocol: "ssh",
        ...a.connection,
        username: a.username,
        password: unseal(a.password, d.key),
        payload: transport !== 'tcp' ? sshPayload(a.connection.host, a.connection.port, a.connection.path) : null,
        expiresAt: a.expiresAt,
        quotaGb: a.quotaBytes / 1e9,
        usedGb: a.usedBytes / 1e9,
        note: "SSH-WS HTTP Upgrade brut : ABESS VPN 2.5.4 ou supérieur. TCP et DNS dans le tunnel ; autres flux UDP non pris en charge. JSON générique, pas un fichier propriétaire .hc/.ehi.",
      });
    },
  );
}
