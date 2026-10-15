import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

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
  resellerId: string;
  resellerName: string;
  plan: string;
  bandwidthGb: number;
  bandwidthUsedGb: number;
  expiresAt: string;
  days: number;
  deviceLimit: number;
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
      return JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
    } catch {
      // fallback
    }
  }

  const sample: ClientToken[] = [
    {
      id: 'tok_root_1',
      token: 'ABESS-VIP-ROOT-2026',
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
let totalBytesTransferred = 1024 * 1024 * 460;
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
    const finalToken = (token || 'ABESS-' + Math.random().toString(36).substring(2, 9).toUpperCase()).trim();
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
      uuid: masterConfig.uuid,
      protocol: masterConfig.protocol,
      transport: masterConfig.transport
    };
    const encryptedLink = encryptConfig(encryptedPayload, masterConfig.secretPassphrase);

    const tokens = loadTokens();
    const newToken: ClientToken = {
      id: 'tok_' + Math.random().toString(36).substring(2, 9),
      token: finalToken,
      resellerId: user.id,
      resellerName: user.name,
      plan: plan || `${requestedGb} GO CYBER VIP`,
      bandwidthGb: requestedGb,
      bandwidthUsedGb: 0,
      expiresAt: calculatedExpiresAt,
      days: daysRemaining,
      deviceLimit: Number(deviceLimit) || 2,
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
    if (!rawToken) {
      res.status(400).json({ valid: false, error: 'Token manquant' });
      return;
    }

    const tokens = loadTokens();
    const found = tokens.find(t => t.token.toUpperCase() === rawToken.toUpperCase());
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

    if (found) {
      const now = Date.now();
      const expiryTime = new Date(found.expiresAt).getTime();

      if (now > expiryTime) {
        found.status = 'expired';
        saveTokens(tokens);
        res.status(403).json({
          valid: false,
          error: `Licence expirée le ${new Date(found.expiresAt).toLocaleDateString()}. Veuillez contacter votre revendeur.`,
          status: 'expired'
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

      found.connectionCount = (found.connectionCount || 0) + 1;
      found.lastSeenAt = new Date().toISOString();
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
        deviceLimit: found.deviceLimit,
        bandwidthGb: found.bandwidthGb,
        bandwidthUsedGb: Number(found.bandwidthUsedGb.toFixed(2)),
        bandwidthRemainingGb: Number(Math.max(0, found.bandwidthGb - found.bandwidthUsedGb).toFixed(2)),
        status: found.status,
        serverConfig: {
          address: host,
          port: masterConfig.serverPort,
          path: masterConfig.path,
          uuid: masterConfig.uuid,
          sni: masterConfig.sniHost,
          protocol: masterConfig.protocol,
          transport: masterConfig.transport,
          security: 'tls'
        }
      });
      return;
    }

    res.status(401).json({ valid: false, error: 'Token client non reconnu ou révoqué.' });
  });

  // WebSocket Server on /@abess237
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    if (pathname === '/@abess237' || pathname.startsWith('/@abess237')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    activeTunnelConnections++;
    ws.on('message', (message, isBinary) => {
      const len = isBinary ? (message as Buffer).length : Buffer.byteLength(message.toString());
      totalBytesTransferred += len;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.from([0x00, 0x00])); // VLESS handshake response
      }
    });

    ws.on('close', () => {
      activeTunnelConnections = Math.max(0, activeTunnelConnections - 1);
    });

    ws.on('error', () => {
      activeTunnelConnections = Math.max(0, activeTunnelConnections - 1);
    });
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
