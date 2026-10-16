import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

// Persistent Data Storage
const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const usersFile = path.resolve(dataDir, 'users.json');
const tokensFile = path.resolve(dataDir, 'tokens.json');
const configFile = path.resolve(dataDir, 'config.json');

// Interfaces
export interface AppUser {
  id: string;
  email: string;
  passwordHash: string; // Plain or sha256
  name: string;
  role: 'SUPER_ADMIN' | 'RESELLER';
  credits: number; // Balance in credits / GB
  totalTokensCreated: number;
  totalBandwidthAllocatedGb: number;
  status: 'active' | 'suspended';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ClientToken {
  id: string;
  token: string;
  /** Per-licence VLESS identity; legacy records are migrated on load. */
  clientUuid?: string;
  resellerId: string;
  resellerName: string;
  plan: string;
  bandwidthGb: number;
  bandwidthUsedGb: number;
  expiresAt: string;
  days: number;
  deviceLimit: number;
  /** Stable device IDs which have claimed this licence. */
  deviceIds?: string[];
  connectionCount: number;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  status: 'active' | 'revoked' | 'expired' | 'quota_exceeded';
  encryptedLink: string;
  createdAt: string;
}

export interface MasterServerConfig {
  serverHost: string;
  serverPort: number;
  protocol: string;
  transport: string;
  path: string;
  sniHost: string;
  uuid: string;
  secretPassphrase: string;
  systemName: string;
  contactTelegram: string;
}

// Master Configuration Helper
function loadMasterConfig(): MasterServerConfig {
  const defaults: MasterServerConfig = {
    serverHost: 'abess-ops-hub-d-ploiement-docker.ai.studio',
    serverPort: 443,
    protocol: 'vless',
    transport: 'ws',
    path: '/@abess237',
    sniHost: 'crashlyticsreports-pa.googleapis.com',
    uuid: 'abe55237-0237-4237-8237-ab3552370237',
    secretPassphrase: 'AbessVpn-Master-SecretKey-2026',
    systemName: 'AbessVpn Master Server',
    contactTelegram: '@abess237'
  };

  if (fs.existsSync(configFile)) {
    try {
      return { ...defaults, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
    } catch {
      // fallback
    }
  }

  fs.writeFileSync(configFile, JSON.stringify(defaults, null, 2), 'utf8');
  return defaults;
}

function saveMasterConfig(cfg: MasterServerConfig) {
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), 'utf8');
}

// User Storage with Initial Super Admin
function loadUsers(): AppUser[] {
  if (fs.existsSync(usersFile)) {
    try {
      return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    } catch {
      // fallback
    }
  }

  const superAdmin: AppUser = {
    id: 'usr_admin_master',
    email: 'rigomanga4@gmail.com',
    passwordHash: 'abess237', // Master admin password as specified
    name: 'Rigobert Manga (Admin Principal)',
    role: 'SUPER_ADMIN',
    credits: 999999,
    totalTokensCreated: 12,
    totalBandwidthAllocatedGb: 600,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  };

  const sampleReseller: AppUser = {
    id: 'usr_reseller_demo',
    email: 'revendeur@abessvpn.com',
    passwordHash: 'revendeur123',
    name: 'Distributeur Cameroun VIP',
    role: 'RESELLER',
    credits: 250, // 250 Go disponibles à vendre
    totalTokensCreated: 5,
    totalBandwidthAllocatedGb: 150,
    status: 'active',
    createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    lastLoginAt: new Date().toISOString()
  };

  const initial = [superAdmin, sampleReseller];
  fs.writeFileSync(usersFile, JSON.stringify(initial, null, 2), 'utf8');
  return initial;
}

function saveUsers(users: AppUser[]) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');
}

// Tokens Storage
function loadTokens(): ClientToken[] {
  if (fs.existsSync(tokensFile)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(tokensFile, 'utf8')) as ClientToken[];
      let changed = false;
      for (const token of loaded) {
        if (!token.clientUuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token.clientUuid)) {
          token.clientUuid = crypto.randomUUID();
          changed = true;
        }
        if (!Array.isArray(token.deviceIds)) {
          token.deviceIds = [];
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(tokensFile, JSON.stringify(loaded, null, 2), 'utf8');
      return loaded;
    } catch {
      // fallback
    }
  }

  const sample: ClientToken[] = [
    {
      id: 'tok_root_1',
      token: 'ABESS-VIP-ROOT-2026',
      clientUuid: crypto.randomUUID(),
      deviceIds: [],
      resellerId: 'usr_admin_master',
      resellerName: 'Rigobert Manga (Admin Principal)',
      plan: 'COMMERCE VIP ULTRA 50 GO',
      bandwidthGb: 50,
      bandwidthUsedGb: 3.42,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      days: 30,
      deviceLimit: 2,
      connectionCount: 38,
      lastSeenAt: new Date().toISOString(),
      lastSeenIp: '197.234.221.14',
      status: 'active',
      encryptedLink: 'abess://MASTER.ENCRYPTED.PAYLOAD',
      createdAt: new Date().toISOString()
    }
  ];
  fs.writeFileSync(tokensFile, JSON.stringify(sample, null, 2), 'utf8');
  return sample;
}

function saveTokens(tokens: ClientToken[]) {
  fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2), 'utf8');
}

// AES-256 Encryption Helper
function encryptConfig(plainJson: object, secret: string): string {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(JSON.stringify(plainJson), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return `abess://${iv.toString('base64')}.${encrypted}`;
}

// Telemetry & metrics
let activeTunnelConnections = 0;
let totalBytesTransferred = 0;
const startTime = Date.now();

// Sessions in memory for token authentication
const activeSessions = new Map<string, { userId: string; role: string; email: string }>();

async function startServer() {
  const app = express();
  app.use(express.json());

  // CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  const server = http.createServer(app);

  // Public health check used by the mobile client before token operations.
  app.get('/api/v1/ping', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      service: 'abessvpn-master',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      // The current WebSocket implementation is only a handshake placeholder.
      // Do not advertise the data plane as ready until it is replaced by Xray-core.
      dataPlane: 'not-ready'
    });
  });

  // Real HTTP throughput probes. Limit payload size to protect the management API.
  app.get('/api/v1/speedtest/download', (req, res) => {
    const requested = Number(req.query.bytes ?? 1024 * 1024);
    const byteCount = Number.isFinite(requested)
      ? Math.max(16 * 1024, Math.min(5 * 1024 * 1024, Math.floor(requested)))
      : 1024 * 1024;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(byteCount));
    res.end(Buffer.alloc(byteCount, 0x61));
  });

  app.post(
    '/api/v1/speedtest/upload',
    express.raw({ type: 'application/octet-stream', limit: '5mb' }),
    (req, res) => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, receivedBytes: body.length, timestamp: new Date().toISOString() });
    }
  );

  // The Android app previously called these routes, but they did not exist.
  // This endpoint only records client-reported usage; it is not authoritative
  // quota enforcement. The VLESS data plane must account server-side bytes.
  app.post('/api/v1/client/telemetry', (req, res) => {
    const rawToken = req.body?.token?.toString()?.trim();
    if (!rawToken) {
      res.status(400).json({ ok: false, error: 'Token manquant' });
      return;
    }

    const tokens = loadTokens();
    const found = tokens.find(t => t.token.toUpperCase() === rawToken.toUpperCase());
    if (!found) {
      res.status(401).json({ ok: false, error: 'Token client non reconnu ou révoqué.' });
      return;
    }

    const now = Date.now();
    const expiry = new Date(found.expiresAt).getTime();
    const isExpired = !Number.isFinite(expiry) || now >= expiry;

    // V2RayStatus reports real byte counters in the mobile client. This API
    // accepts bounded client-reported deltas for display/compatibility only;
    // a hostile client can falsify them, so they are not a substitute for
    // accounting bytes in the VLESS data plane.
    const maxBytesPerDirection = 256 * 1024 * 1024;
    const parseBytes = (value: unknown) => {
      const bytes = Number(value);
      return Number.isFinite(bytes) && bytes > 0
        ? Math.min(maxBytesPerDirection, Math.floor(bytes))
        : 0;
    };
    if (!isExpired && found.status === 'active') {
      const reportedBytes = parseBytes(req.body?.bytesDownloaded) + parseBytes(req.body?.bytesUploaded);
      found.bandwidthUsedGb = Math.min(
        found.bandwidthGb,
        found.bandwidthUsedGb + reportedBytes / (1024 * 1024 * 1024)
      );
    }

    const isQuotaExceeded = found.bandwidthUsedGb >= found.bandwidthGb;
    if (isExpired) found.status = 'expired';
    else if (isQuotaExceeded) found.status = 'quota_exceeded';

    found.lastSeenAt = new Date(now).toISOString();
    found.lastSeenIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    saveTokens(tokens);

    res.json({
      ok: true,
      isExpired,
      isQuotaExceeded,
      status: found.status,
      bandwidthGb: found.bandwidthGb,
      bandwidthUsedGb: Number(found.bandwidthUsedGb.toFixed(3)),
      bandwidthRemainingGb: Number(Math.max(0, found.bandwidthGb - found.bandwidthUsedGb).toFixed(3)),
      expiresAt: found.expiresAt,
      quotaSource: 'client-reported-not-authoritative'
    });
  });

  // Licence creation stays inside the authenticated admin/reseller panel.
  // Never create paid tokens through an unauthenticated public mobile endpoint.
  app.post('/api/v1/client/create-token', (_req, res) => {
    res.status(403).json({
      ok: false,
      error: 'La création de tokens doit passer par le panneau ABESS VPN avec une session administrateur ou revendeur authentifiée.'
    });
  });

  // A trial cannot be issued until a real data plane is configured. Returning a
  // clear error avoids telling the user a free VPN connection is active when it is not.
  app.post('/api/v1/client/claim-free-trial', (_req, res) => {
    res.status(503).json({
      ok: false,
      error: 'Essai temporairement indisponible : le moteur de tunnel VPN n’est pas encore opérationnel sur ce serveur.'
    });
  });


  // Authentication Middleware
  const authenticate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Session non authentifiée. Veuillez vous connecter.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const session = activeSessions.get(token);
    if (!session) {
      res.status(401).json({ error: 'Session expirée ou invalide.' });
      return;
    }

    const users = loadUsers();
    const user = users.find(u => u.id === session.userId && u.status === 'active');
    if (!user) {
      res.status(401).json({ error: 'Compte suspendu ou introuvable.' });
      return;
    }

    (req as any).user = user;
    next();
  };

  // ==========================================
  // 1. AUTHENTICATION & LOGIN (Admin & Reseller)
  // ==========================================
  app.post('/api/v1/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email et mot de passe requis' });
      return;
    }

    const users = loadUsers();
    const user = users.find(
      u => u.email.toLowerCase().trim() === email.toLowerCase().trim() && u.passwordHash === password
    );

    if (!user) {
      res.status(401).json({ error: 'Identifiants incorrects (Email ou Mot de passe invalide)' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ error: 'Ce compte a été suspendu par l\'administrateur principal.' });
      return;
    }

    user.lastLoginAt = new Date().toISOString();
    saveUsers(users);

    const sessionToken = 'sess_' + crypto.randomBytes(32).toString('hex');
    activeSessions.set(sessionToken, {
      userId: user.id,
      role: user.role,
      email: user.email
    });

    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        credits: user.credits,
        totalTokensCreated: user.totalTokensCreated,
        totalBandwidthAllocatedGb: user.totalBandwidthAllocatedGb
      }
    });
  });

  app.get('/api/v1/auth/me', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      credits: user.credits,
      totalTokensCreated: user.totalTokensCreated,
      totalBandwidthAllocatedGb: user.totalBandwidthAllocatedGb
    });
  });

  // ==========================================
  // 2. RESELLER MANAGEMENT (SUPER ADMIN ONLY)
  // ==========================================
  app.get('/api/v1/admin/resellers', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }

    const users = loadUsers();
    const resellers = users
      .filter(u => u.role === 'RESELLER')
      .map(({ passwordHash, ...rest }) => rest);

    res.json(resellers);
  });

  app.post('/api/v1/admin/resellers', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }

    const { email, password, name, initialCredits } = req.body;
    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, mot de passe et nom requis pour le revendeur' });
      return;
    }

    const users = loadUsers();
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase().trim())) {
      res.status(400).json({ error: 'Un compte avec cet email existe déjà.' });
      return;
    }

    const newReseller: AppUser = {
      id: 'usr_reseller_' + Math.random().toString(36).substring(2, 9),
      email: email.toLowerCase().trim(),
      passwordHash: password,
      name: name.trim(),
      role: 'RESELLER',
      credits: Number(initialCredits) || 100, // Solde initial
      totalTokensCreated: 0,
      totalBandwidthAllocatedGb: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    };

    users.push(newReseller);
    saveUsers(users);

    const { passwordHash, ...safeReseller } = newReseller;
    res.status(201).json(safeReseller);
  });

  // Credit / Recharge Reseller
  app.put('/api/v1/admin/resellers/:id/credit', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }

    const { amount } = req.body;
    if (typeof amount !== 'number') {
      res.status(400).json({ error: 'Montant de crédit numérique requis' });
      return;
    }

    const users = loadUsers();
    const reseller = users.find(u => u.id === req.params.id && u.role === 'RESELLER');
    if (!reseller) {
      res.status(404).json({ error: 'Revendeur introuvable' });
      return;
    }

    reseller.credits = Math.max(0, reseller.credits + amount);
    saveUsers(users);

    res.json({
      success: true,
      resellerId: reseller.id,
      name: reseller.name,
      newCredits: reseller.credits
    });
  });

  // Toggle Reseller Status (Active / Suspended)
  app.put('/api/v1/admin/resellers/:id/status', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }

    const { status } = req.body;
    const users = loadUsers();
    const reseller = users.find(u => u.id === req.params.id && u.role === 'RESELLER');
    if (!reseller) {
      res.status(404).json({ error: 'Revendeur introuvable' });
      return;
    }

    reseller.status = status === 'suspended' ? 'suspended' : 'active';
    saveUsers(users);

    res.json({ success: true, status: reseller.status });
  });

  // Delete Reseller
  app.delete('/api/v1/admin/resellers/:id', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }

    const users = loadUsers();
    const filtered = users.filter(u => u.id !== req.params.id || u.role !== 'RESELLER');
    saveUsers(filtered);
    res.json({ success: true });
  });

  // ==========================================
  // 3. TOKENS CREATION & MANAGEMENT
  // (Resellers see ONLY their tokens, NEVER server config!)
  // ==========================================
  app.get('/api/v1/admin/tokens', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const tokens = loadTokens();

    if (user.role === 'SUPER_ADMIN') {
      // Super Admin sees all tokens with full reseller visibility
      res.json(tokens);
    } else {
      // Reseller sees ONLY his own tokens
      const myTokens = tokens.filter(t => t.resellerId === user.id);
      res.json(myTokens);
    }
  });

  // Create Client Token (Deducts credits from Reseller)
  app.post('/api/v1/admin/tokens', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const { token, plan, bandwidthGb, expiresAt, days, deviceLimit } = req.body;

    const requestedGb = Number(bandwidthGb) || 50;

    // Credit Verification for Resellers
    if (user.role === 'RESELLER') {
      if (user.credits < requestedGb) {
        res.status(400).json({
          error: `Crédits insuffisants ! Votre solde actuel est de ${user.credits} Go. Vous avez demandé ${requestedGb} Go. Veuillez contacter le Super Administrateur pour recharger votre compte.`
        });
        return;
      }
    }

    const masterConfig = loadMasterConfig();
    const clientUuid = crypto.randomUUID();
    const finalToken = (token || 'ABESS-' + crypto.randomBytes(5).toString('hex').toUpperCase()).trim();
    const calculatedExpiresAt = expiresAt || new Date(Date.now() + (Number(days) || 30) * 24 * 3600 * 1000).toISOString();
    const daysRemaining = Math.max(0, Math.ceil((new Date(calculatedExpiresAt).getTime() - Date.now()) / (1000 * 3600 * 24)));

    // Generate Encrypted abess:// Link without exposing master host/ip to reseller UI
    const encryptedPayload = {
      vpnName: 'AbessVpn',
      token: finalToken,
      bandwidthGb: requestedGb,
      expiresAt: calculatedExpiresAt,
      serverHost: masterConfig.serverHost,
      serverPort: masterConfig.serverPort,
      path: masterConfig.path,
      sniHost: masterConfig.sniHost,
      uuid: clientUuid,
      protocol: masterConfig.protocol,
      transport: masterConfig.transport
    };
    const encryptedLink = encryptConfig(encryptedPayload, masterConfig.secretPassphrase);

    const tokens = loadTokens();
    const newToken: ClientToken = {
      id: 'tok_' + Math.random().toString(36).substring(2, 9),
      token: finalToken,
      clientUuid,
      deviceIds: [],
      resellerId: user.id,
      resellerName: user.name,
      plan: plan || `${requestedGb} GO CYBER VIP`,
      bandwidthGb: requestedGb,
      bandwidthUsedGb: 0,
      expiresAt: calculatedExpiresAt,
      days: daysRemaining,
      deviceLimit: Math.max(1, Math.min(10, Math.floor(Number(deviceLimit) || 2))),
      deviceIds: [],
      connectionCount: 0,
      lastSeenAt: null,
      lastSeenIp: null,
      status: 'active',
      encryptedLink,
      createdAt: new Date().toISOString()
    };

    tokens.unshift(newToken);
    saveTokens(tokens);

    // Deduct credits from reseller & update stats
    const users = loadUsers();
    const currentUser = users.find(u => u.id === user.id);
    if (currentUser) {
      if (user.role === 'RESELLER') {
        currentUser.credits = Math.max(0, currentUser.credits - requestedGb);
      }
      currentUser.totalTokensCreated = (currentUser.totalTokensCreated || 0) + 1;
      currentUser.totalBandwidthAllocatedGb = (currentUser.totalBandwidthAllocatedGb || 0) + requestedGb;
      saveUsers(users);
    }

    res.status(201).json(newToken);
  });

  // Revoke / Delete Token
  app.delete('/api/v1/admin/tokens/:id', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const tokens = loadTokens();

    const targetToken = tokens.find(t => t.id === req.params.id);
    if (!targetToken) {
      res.status(404).json({ error: 'Token introuvable' });
      return;
    }

    if (user.role !== 'SUPER_ADMIN' && targetToken.resellerId !== user.id) {
      res.status(403).json({ error: 'Vous ne pouvez révoquer que vos propres tokens clients.' });
      return;
    }

    const updated = tokens.filter(t => t.id !== req.params.id);
    saveTokens(updated);
    res.json({ success: true });
  });

  // ==========================================
  // 4. MASTER SERVER CONFIGURATION (SUPER ADMIN ONLY)
  // (NEVER ACCESSIBLE TO RESELLERS!)
  // ==========================================
  app.get('/api/v1/admin/server-config', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'ACCÈS REFUSÉ : Les informations d\'infrastructure (Host, SNI, IP) sont confidentielles et réservées au Super Administrateur.' });
      return;
    }
    res.json(loadMasterConfig());
  });

  app.put('/api/v1/admin/server-config', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'ACCÈS REFUSÉ : Seul le Super Administrateur peut modifier l\'infrastructure.' });
      return;
    }

    const current = loadMasterConfig();
    const updated = { ...current, ...req.body };
    saveMasterConfig(updated);
    res.json({ success: true, config: updated });
  });

  // ==========================================
  // 5. GLOBAL METRICS & STATS
  // ==========================================
  app.get('/api/v1/admin/stats', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const users = loadUsers();
    const tokens = loadTokens();

    if (user.role === 'SUPER_ADMIN') {
      const resellers = users.filter(u => u.role === 'RESELLER');
      const totalCreditsInCirculation = resellers.reduce((sum, r) => sum + r.credits, 0);
      const totalBandwidthAllocated = tokens.reduce((sum, t) => sum + t.bandwidthGb, 0);
      const totalBandwidthConsumed = tokens.reduce((sum, t) => sum + t.bandwidthUsedGb, 0);

      res.json({
        role: 'SUPER_ADMIN',
        totalResellers: resellers.length,
        totalTokens: tokens.length,
        activeTokens: tokens.filter(t => t.status === 'active').length,
        totalCreditsInCirculation,
        totalBandwidthAllocated,
        totalBandwidthConsumed: Number(totalBandwidthConsumed.toFixed(2)),
        activeTunnelConnections,
        totalBytesTransferred
      });
    } else {
      const myTokens = tokens.filter(t => t.resellerId === user.id);
      const myBandwidthAllocated = myTokens.reduce((sum, t) => sum + t.bandwidthGb, 0);
      const myBandwidthConsumed = myTokens.reduce((sum, t) => sum + t.bandwidthUsedGb, 0);

      res.json({
        role: 'RESELLER',
        creditsRemaining: user.credits,
        totalTokens: myTokens.length,
        activeTokens: myTokens.filter(t => t.status === 'active').length,
        totalBandwidthAllocated: myBandwidthAllocated,
        totalBandwidthConsumed: Number(myBandwidthConsumed.toFixed(2))
      });
    }
  });

  // ==========================================
  // 6. CLIENT MOBILE APPLICATION AUTHENTICATION
  // (Called by flutter_v2ray on Android/iOS)
  // ==========================================
  app.post('/api/v1/auth/token', (req, res) => {
    const rawToken = req.body?.token?.toString()?.trim();
    const deviceId = req.body?.deviceId?.toString()?.trim();

    if (!rawToken) {
      res.status(400).json({ valid: false, error: 'Token manquant' });
      return;
    }
    if (!deviceId || deviceId.length > 128 || /[\\r\\n\\0]/.test(deviceId)) {
      res.status(400).json({ valid: false, error: 'Identifiant d’appareil invalide ou manquant.' });
      return;
    }

    const tokens = loadTokens();
    const found = tokens.find(t => t.token.toUpperCase() === rawToken.toUpperCase());
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';

    if (!found) {
      res.status(401).json({ valid: false, error: 'Token client non reconnu ou révoqué.' });
      return;
    }

    const now = Date.now();
    const expiryTime = new Date(found.expiresAt).getTime();

    if (!Number.isFinite(expiryTime) || now >= expiryTime || found.status === 'expired') {
      found.status = 'expired';
      saveTokens(tokens);
      res.status(403).json({
        valid: false,
        error: `Licence expirée le ${new Date(found.expiresAt).toLocaleDateString()}. Veuillez contacter votre revendeur.`,
        status: 'expired'
      });
      return;
    }

    if (found.status !== 'active') {
      res.status(403).json({
        valid: false,
        error: found.status === 'quota_exceeded'
          ? 'Quota de données épuisé. Veuillez renouveler votre accès.'
          : 'Cette licence a été révoquée ou désactivée.',
        status: found.status
      });
      return;
    }

    if (found.bandwidthUsedGb >= found.bandwidthGb) {
      found.status = 'quota_exceeded';
      saveTokens(tokens);
      res.status(403).json({
        valid: false,
        error: `Quota de données épuisé (${found.bandwidthUsedGb.toFixed(2)} Go / ${found.bandwidthGb} Go).`,
        status: 'quota_exceeded'
      });
      return;
    }

    const knownDevices = Array.isArray(found.deviceIds)
      ? found.deviceIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    const normalizedDeviceId = deviceId;
    const alreadyRegistered = knownDevices.includes(normalizedDeviceId);
    const deviceLimit = Math.max(1, Math.floor(Number(found.deviceLimit) || 1));

    if (!alreadyRegistered && knownDevices.length >= deviceLimit) {
      res.status(403).json({
        valid: false,
        error: `Limite d’appareils atteinte (${deviceLimit}). Déconnectez ou retirez un appareil avant d’utiliser cette licence sur un autre téléphone.`,
        status: 'device_limit_exceeded',
        deviceLimit
      });
      return;
    }

    if (!alreadyRegistered) knownDevices.push(normalizedDeviceId);
    found.deviceIds = knownDevices;
    found.connectionCount = (found.connectionCount || 0) + 1;
    found.lastSeenAt = new Date(now).toISOString();
    found.lastSeenIp = clientIp;
    saveTokens(tokens);

    const masterConfig = loadMasterConfig();
    const host = masterConfig.serverHost || req.get('host') || 'abess-ops-hub-d-ploiement-docker.ai.studio';
    const msRemaining = Math.max(0, expiryTime - now);
    const daysRemaining = Math.ceil(msRemaining / (1000 * 3600 * 24));

    res.json({
      valid: true,
      token: found.token,
      plan: found.plan,
      reseller: found.resellerName,
      expiresAt: found.expiresAt,
      daysRemaining,
      deviceLimit,
      registeredDevices: knownDevices.length,
      bandwidthGb: found.bandwidthGb,
      bandwidthUsedGb: Number(found.bandwidthUsedGb.toFixed(2)),
      bandwidthRemainingGb: Number(Math.max(0, found.bandwidthGb - found.bandwidthUsedGb).toFixed(2)),
      status: found.status,
      serverConfig: {
        address: host,
        port: masterConfig.serverPort,
        path: masterConfig.path,
        uuid: found.clientUuid || masterConfig.uuid,
        sni: masterConfig.sniHost,
        protocol: masterConfig.protocol,
        transport: masterConfig.transport,
        security: 'tls'
      }
    });
  });

  // Fail closed until an actual Xray/VLESS data plane is connected.
  // The previous implementation replied with a two-byte placeholder to every
  // message. That is not a tunnel and can make a client appear connected while
  // no Internet traffic is relayed.
  server.on('upgrade', (request, socket) => {
    let pathname = '';
    try {
      pathname = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`).pathname;
    } catch {
      socket.destroy();
      return;
    }

    const configuredPath = loadMasterConfig().path || '/@abess237';
    if (pathname === configuredPath || pathname.startsWith(`${configuredPath}/`)) {
      const body = 'VLESS data plane is not configured on this server.';
      socket.end(
        `HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\n\r\n${body}`
      );
      return;
    }
    socket.destroy();
  });

  // Frontend static / dev middleware
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ABESSVPN MASTER SERVER] Running on port ${PORT}`);
    console.log(`[ABESSVPN MASTER SERVER] Super Admin: rigomanga4@gmail.com`);
  });
}

startServer().catch(console.error);
