import crypto from "node:crypto";
import type { Express, RequestHandler, Request } from "express";

export function seal(value: unknown, secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    crypto.createHash("sha256").update(secret).digest(),
    iv,
  );
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function unseal(value: string, secret: string): any {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1") throw new Error("Unknown encrypted format");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    crypto.createHash("sha256").update(secret).digest(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString(),
  );
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes: Buffer) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let i = 0; i < bits.length; i += 5)
    result += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return result;
}
function decode32(text: string) {
  let bits = "";
  for (const c of text.replace(/=+$/, "").toUpperCase()) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw new Error("Invalid secret");
    bits += n.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret: string, counter = Math.floor(Date.now() / 30000)) {
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest = crypto
    .createHmac("sha1", decode32(secret))
    .update(input)
    .digest();
  const offset = digest[19] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
export const digest = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
interface Mfa {
  secret: string;
  enabled: boolean;
  expiresAt?: number;
  lastCounter: number;
  recoveryHashes: string[];
}
export interface Session {
  userId: string;
  role: string;
  email: string;
  createdAt: number;
  ip?: string;
  agent?: string;
}
interface State {
  mfa: Record<string, Mfa>;
  sessions: Record<string, Session>;
}
export class SecurityService {
  constructor(
    private read: () => State,
    private write: (state: State) => void,
    private secret: () => string,
  ) {}
  state() {
    const value = this.read();
    return { mfa: value.mfa || {}, sessions: value.sessions || {} };
  }
  enabled(userId: string) {
    return this.state().mfa[userId]?.enabled === true;
  }
  verify(userId: string, code: unknown, recovery = true) {
    if (typeof code !== "string") return false;
    const state = this.state();
    const mfa = state.mfa[userId];
    if (!mfa) return false;
    if (
      recovery &&
      mfa.enabled &&
      mfa.recoveryHashes.includes(digest(code.trim()))
    ) {
      mfa.recoveryHashes = mfa.recoveryHashes.filter(
        (hash) => hash !== digest(code.trim()),
      );
      this.write(state);
      return true;
    }
    if (
      !/^\d{6}$/.test(code) ||
      (!mfa.enabled && (mfa.expiresAt || 0) < Date.now())
    )
      return false;
    const counter = Math.floor(Date.now() / 30000);
    for (const candidate of [counter - 1, counter, counter + 1]) {
      if (candidate <= mfa.lastCounter) continue;
      if (
        crypto.timingSafeEqual(
          Buffer.from(totp(unseal(mfa.secret, this.secret()), candidate)),
          Buffer.from(code),
        )
      ) {
        mfa.lastCounter = candidate;
        this.write(state);
        return true;
      }
    }
    return false;
  }
  begin(userId: string, email: string) {
    const state = this.state();
    const secret = base32(crypto.randomBytes(20));
    state.mfa[userId] = {
      secret: seal(secret, this.secret()),
      enabled: false,
      expiresAt: Date.now() + 600000,
      lastCounter: -1,
      recoveryHashes: [],
    };
    this.write(state);
    return {
      secret,
      uri: `otpauth://totp/${encodeURIComponent("ABESS VPN:" + email)}?secret=${secret}&issuer=ABESS%20VPN&algorithm=SHA1&digits=6&period=30`,
    };
  }
  enable(userId: string, code: unknown) {
    if (!this.verify(userId, code, false)) return null;
    const state = this.state();
    const codes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(12).toString("hex"),
    );
    state.mfa[userId].enabled = true;
    delete state.mfa[userId].expiresAt;
    state.mfa[userId].recoveryHashes = codes.map(digest);
    this.write(state);
    return codes;
  }
  disable(userId: string) {
    const state = this.state();
    delete state.mfa[userId];
    this.write(state);
  }
  sessions = {
    get: (token: string): Session | undefined =>
      this.state().sessions[digest(token)],
    set: (token: string, session: Session) => {
      const state = this.state();
      state.sessions[digest(token)] = session;
      this.write(state);
    },
    delete: (tokenOrHash: string) => {
      const state = this.state();
      delete state.sessions[
        tokenOrHash.startsWith("sess_") ? digest(tokenOrHash) : tokenOrHash
      ];
      this.write(state);
    },
    entries: (): Array<[string, Session]> =>
      Object.entries(this.state().sessions),
    clear: () => {
      const state = this.state();
      state.sessions = {};
      this.write(state);
    },
  };
  revokeUser(userId: string, except?: string) {
    for (const [id, session] of this.sessions.entries())
      if (session.userId === userId && id !== except) this.sessions.delete(id);
  }
}

type Dependencies = {
  authenticate: RequestHandler;
  security: SecurityService;
  users: () => any[];
  saveUsers: (users: any[]) => void;
  verifyPassword: (password: string, hash: string) => boolean;
  hashPassword: (password: string) => string;
  audit: (event: any) => void;
  guard: (ip: string) => boolean;
  failure: (ip: string) => void;
};
export function registerSecurityRoutes(app: Express, d: Dependencies) {
  const user = (req: Request) => (req as any).user;
  const confirm = (req: Request) => {
    if (!d.guard(req.ip || "unknown")) return false;
    const valid =
      typeof req.body?.password === "string" &&
      d.verifyPassword(req.body.password, user(req).passwordHash) &&
      (!d.security.enabled(user(req).id) ||
        d.security.verify(user(req).id, req.body?.code));
    if (!valid) d.failure(req.ip || "unknown");
    return valid;
  };
  app.get("/api/v1/auth/security", d.authenticate, (req, res) => {
    const current = digest((req as any).sessionToken);
    res.set("Cache-Control", "no-store").json({
      mfaEnabled: d.security.enabled(user(req).id),
      mfaRequired:
        process.env.REQUIRE_ADMIN_MFA === "true" &&
        ["SUPER_ADMIN", "ADMIN"].includes(user(req).role),
      sessions: d.security.sessions
        .entries()
        .filter(
          ([, s]) =>
            s.userId === user(req).id && Date.now() - s.createdAt < 86400000,
        )
        .map(([id, s]) => ({
          id,
          createdAt: s.createdAt,
          ip: s.ip,
          agent: s.agent,
          current: id === current,
        })),
    });
  });
  app.post("/api/v1/auth/mfa/setup", d.authenticate, (req, res) => {
    if (d.security.enabled(user(req).id))
      return res
        .status(409)
        .json({ error: "La double authentification est déjà active." });
    if (!confirm(req))
      return res
        .status(403)
        .json({ error: "Vérification du mot de passe refusée." });
    res
      .set("Cache-Control", "no-store")
      .json(d.security.begin(user(req).id, user(req).email));
  });
  app.post("/api/v1/auth/mfa/enable", d.authenticate, (req, res) => {
    if (d.security.enabled(user(req).id))
      return res.status(409).json({ error: "Déjà activée." });
    if (!d.guard(req.ip || "unknown")) return res.sendStatus(429);
    const recoveryCodes = d.security.enable(user(req).id, req.body?.code);
    if (!recoveryCodes) {
      d.failure(req.ip || "unknown");
      return res.status(400).json({ error: "Code invalide ou expiré." });
    }
    d.security.revokeUser(user(req).id, digest((req as any).sessionToken));
    d.audit({
      actor: user(req).id,
      role: user(req).role,
      action: "MFA_ENABLED",
      details: "Double authentification activée.",
    });
    res.set("Cache-Control", "no-store").json({ recoveryCodes });
  });
  app.post("/api/v1/auth/mfa/disable", d.authenticate, (req, res) => {
    if (!confirm(req))
      return res
        .status(403)
        .json({ error: "Mot de passe et code de sécurité requis." });
    d.security.disable(user(req).id);
    d.security.revokeUser(user(req).id);
    d.audit({
      actor: user(req).id,
      role: user(req).role,
      action: "MFA_DISABLED",
      details: "Double authentification désactivée.",
    });
    res.json({ ok: true, relogin: true });
  });
  app.delete("/api/v1/auth/sessions/:id", d.authenticate, (req, res) => {
    const entry = d.security.sessions
      .entries()
      .find(([id, s]) => id === req.params.id && s.userId === user(req).id);
    if (!entry) return res.sendStatus(404);
    d.security.sessions.delete(entry[0]);
    res.sendStatus(204);
  });
  app.post("/api/v1/auth/password", d.authenticate, (req, res) => {
    if (!confirm(req))
      return res
        .status(403)
        .json({ error: "Vérification de sécurité refusée." });
    if (
      typeof req.body?.newPassword !== "string" ||
      req.body.newPassword.length < 16 ||
      req.body.newPassword.length > 256
    )
      return res.status(400).json({ error: "Utilisez 16 à 256 caractères." });
    const users = d.users();
    users.find((u) => u.id === user(req).id).passwordHash = d.hashPassword(
      req.body.newPassword,
    );
    d.saveUsers(users);
    d.security.revokeUser(user(req).id);
    d.audit({
      actor: user(req).id,
      role: user(req).role,
      action: "PASSWORD_CHANGED",
      details: "Mot de passe modifié ; sessions révoquées.",
    });
    res.json({ ok: true, relogin: true });
  });
}
