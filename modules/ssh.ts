import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Express, RequestHandler } from "express";
import { seal, unseal } from "./security.js";
export interface SshAccount {
  id: string;
  username: string;
  label: string;
  salt: string;
  verifier: string;
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
export function sshPayload(host: string) {
  return `GET /ws-ssh HTTP/1.1[crlf]Host: ${host}[crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]`;
}
export function registerSsh(
  app: Express,
  d: {
    authenticate: RequestHandler;
    read: () => SshState;
    write: (s: SshState) => void;
    audit: (event: any) => void;
    key: string;
    directory: string;
    publish: (state: SshState) => void;
  },
) {
  const enabled = process.env.SSH_GATEWAY_ENABLED === "true";
  const host = process.env.VPN_DOMAIN || "localhost";
  const guard: RequestHandler = (req, res, next) => {
    if ((req as any).user.role !== "SUPER_ADMIN") {
      res.sendStatus(403);
      return;
    }
    next();
  };
  const stats = () => {
    try {
      const value = JSON.parse(
        fs.readFileSync(path.join(d.directory, "stats.json"), "utf8"),
      );
      const age = Date.now() - Number(value.at);
      return age >= -5000 && age < 15000 && Array.isArray(value.accounts)
        ? value
        : null;
    } catch {
      return null;
    }
  };
  const ports = {
    tcp: Number(process.env.SSH_TCP_PORT || 2222),
    wss: 443,
    wssAlt: 2084,
  };
  app.get("/api/v1/admin/ssh", d.authenticate, guard, (_req, res) => {
    const status = stats();
    res.json({
      enabled,
      ready: Boolean(enabled && status?.ready),
      host,
      ports,
      path: "/ws-ssh",
      fingerprint: status?.fingerprint || null,
      accounts: d.read().accounts.map((a) => ({
        ...safeSshAccount(a),
        online: status?.accounts.find((s: any) => s.id === a.id)?.online || 0,
      })),
    });
  });
  app.post("/api/v1/admin/ssh/accounts", d.authenticate, guard, (req, res) => {
    if (!enabled || !stats()?.ready) {
      res
        .status(503)
        .json({
          error:
            "La passerelle SSH doit être opérationnelle avant de créer un compte.",
        });
      return;
    }
    const username = String(req.body?.username || "").trim();
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
      res
        .status(400)
        .json({
          error:
            "Utilisateur : 3–32 caractères, durée : 1–366 jours, quota : 0,01–100000 Go, connexions : 1–10.",
        });
      return;
    }
    const state = d.read();
    if (
      state.accounts.length >= 5000 ||
      state.accounts.some((a) => a.username === username)
    ) {
      res
        .status(409)
        .json({ error: "Utilisateur déjà présent ou capacité atteinte." });
      return;
    }
    const password = crypto.randomBytes(18).toString("base64url");
    const salt = crypto.randomBytes(16).toString("hex");
    const account: SshAccount = {
      id: "ssh_" + crypto.randomUUID(),
      username,
      label,
      salt,
      verifier: crypto.scryptSync(password, salt, 32).toString("hex"),
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
    d.publish(state);
    d.audit({
      action: "SSH_CREATED",
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
      d.publish(state);
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
      d.publish(state);
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
      if (!["tcp", "wss", "wss-alt"].includes(transport)) {
        res.sendStatus(400);
        return;
      }
      const tls = transport !== "tcp";
      const port = tls
        ? transport === "wss"
          ? ports.wss
          : ports.wssAlt
        : ports.tcp;
      d.audit({
        action: "SSH_CREDENTIALS_EXPORTED",
        by: (req as any).user.id,
        target: a.id,
      });
      res
        .set("Cache-Control", "no-store")
        .json({
          format: "abess-ssh-v1",
          protocol: "ssh",
          transport,
          host,
          port,
          username: a.username,
          password: unseal(a.password, d.key),
          tls,
          sni: tls ? host : null,
          path: tls ? "/ws-ssh" : null,
          payload: tls ? sshPayload(host) : null,
          fingerprint: stats()?.fingerprint || null,
          expiresAt: a.expiresAt,
          quotaGb: a.quotaBytes / 1e9,
          usedGb: a.usedBytes / 1e9,
          note: "Import direct dans ABESS VPN 2.5.0 ou supérieur. TCP et DNS dans le tunnel ; autres flux UDP non pris en charge. JSON générique, pas un fichier propriétaire .hc/.ehi.",
        });
    },
  );
}
