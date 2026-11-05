import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import tls from 'tls';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import QRCode from 'qrcode';
import { startTelegramBot } from './telegram-bot.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

// Persistent Data Storage
const dataDir = process.env.DATA_DIR || path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const usersFile = path.resolve(dataDir, 'users.json');
const tokensFile = path.resolve(dataDir, 'tokens.json');
const configFile = path.resolve(dataDir, 'config.json');
const protocolConfigsFile = path.resolve(dataDir, 'protocol-configs.json');
const transactionsFile = path.resolve(dataDir, 'transactions.json');
const appVersionFile = path.resolve(dataDir, 'app-version.json');
const announcementsFile = path.resolve(dataDir, 'announcements.json');
const plansFile = path.resolve(dataDir, 'plans.json');
const requestsFile = path.resolve(dataDir, 'requests.json');
const auditLogsFile = path.resolve(dataDir, 'audit-logs.json');
const africanCountriesFile = path.resolve(dataDir, 'african-countries.json');
const templatesDir = path.resolve(__dirname, 'templates');
const staticDir = path.resolve(__dirname, 'static');

const backupsDir = path.resolve(dataDir, 'backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

const xrayConfigFile = process.env.XRAY_CONFIG_PATH || path.resolve(dataDir, 'xray-config.json');
const xrayStatusFile = process.env.XRAY_STATUS_FILE || path.resolve(dataDir, 'xray-ready');
const xrayStatsFile = process.env.XRAY_STATS_FILE || path.resolve(dataDir, 'xray-stats.json');
const xrayUsageStateFile = process.env.XRAY_USAGE_STATE_FILE || path.resolve(dataDir, 'xray-usage-state.json');

// Atomic File Persistence Helper
function writeJsonAtomically(filePath: string, value: unknown): boolean {
  const contents = JSON.stringify(value, null, 2) + '\n';
  if (fs.existsSync(filePath)) {
    try {
      if (fs.readFileSync(filePath, 'utf8') === contents) return false;
    } catch {
      // Rewrite an unreadable or incomplete file atomically.
    }
  }
  const tempPath = `${filePath}.${process.pid}.${Math.random().toString(36).substring(2, 7)}.tmp`;
  fs.writeFileSync(tempPath, contents, { encoding: 'utf8', mode: 0o640 });
  fs.renameSync(tempPath, filePath);
  return true;
}

// Commercial Transaction & Audit Log
export interface TransactionLog {
  id: string;
  resellerId: string;
  resellerName: string;
  type: 'CREDIT_ADD' | 'TOKEN_CREATE' | 'BATCH_CREATE' | 'TOKEN_REVOKE' | 'RESET_DEVICES' | 'SERVER_UPDATE' | 'APP_VERSION_UPDATE' | 'ANNOUNCEMENT_PUBLISH';
  amountGb: number;
  balanceBefore: number;
  balanceAfter: number;
  note: string;
  timestamp: string;
}

function loadTransactions(): TransactionLog[] {
  if (fs.existsSync(transactionsFile)) {
    try {
      return JSON.parse(fs.readFileSync(transactionsFile, 'utf8')) as TransactionLog[];
    } catch {
      return [];
    }
  }
  return [];
}

function logTransaction(tx: Omit<TransactionLog, 'id' | 'timestamp'>): void {
  const list = loadTransactions();
  list.unshift({
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    ...tx,
    timestamp: new Date().toISOString()
  });
  if (list.length > 1000) list.length = 1000;
  writeJsonAtomically(transactionsFile, list);
}

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
  /** Optional pinned ABESS installation ID; when set, only that app installation may activate. */
  allowedDeviceId?: string;
  connectionCount: number;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  status: 'active' | 'revoked' | 'expired' | 'quota_exceeded';
  configurationId?: string;
  configurationName?: string;
  /** Immutable server-side profile snapshot keeps existing licences stable after profile edits. */
  configurationSnapshot?: ProtocolConfig;
  /** Optional customer name or contact information for reseller management */
  customerNote?: string;
  customerContact?: string;
  on_hold?: boolean;
  firstConnectedAt?: string | null;
  encryptedLink: string;
  directLink?: string;
  createdAt: string;
}

export interface MasterServerConfig {
  serverHost: string;
  /** Optional HTTP Host/:authority override, separate from the destination and TLS SNI. */
  host: string;
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

export interface ProtocolConfig {
  id: string;
  name: string;
  serverHost: string;
  host: string;
  serverPort: number;
  protocol: string;
  transport: string;
  path: string;
  sniHost: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppVersionConfig {
  latestVersion: string;
  minRequiredVersion: string;
  isMandatory: boolean;
  downloadUrl: string;
  releaseNotes: string;
  publishedAt: string;
}

export function loadAppVersionConfig(): AppVersionConfig {
  if (fs.existsSync(appVersionFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(appVersionFile, 'utf8'));
      if (data && typeof data.latestVersion === 'string') {
        return {
          latestVersion: String(data.latestVersion || '2.1.0').trim(),
          minRequiredVersion: String(data.minRequiredVersion || data.latestVersion || '2.0.0').trim(),
          isMandatory: Boolean(data.isMandatory),
          downloadUrl: String(data.downloadUrl || 'https://t.me/Abess_Vpn').trim(),
          releaseNotes: String(data.releaseNotes || 'Mise à jour majeure obligatoire avec protocoles optimisés.').trim(),
          publishedAt: String(data.publishedAt || new Date().toISOString())
        };
      }
    } catch {
      // rewrite default
    }
  }
  const defaultConfig: AppVersionConfig = {
    latestVersion: '2.1.0',
    minRequiredVersion: '2.0.0',
    isMandatory: true,
    downloadUrl: 'https://t.me/Abess_Vpn',
    releaseNotes: 'Mise à jour obligatoire de sécurité et intégration des protocoles renforcés.',
    publishedAt: new Date().toISOString()
  };
  writeJsonAtomically(appVersionFile, defaultConfig);
  return defaultConfig;
}

export function saveAppVersionConfig(config: AppVersionConfig): void {
  writeJsonAtomically(appVersionFile, config);
}

// ==========================================
// ANNOUNCEMENTS & BROADCASTING SYSTEM
// ==========================================
export interface Announcement {
  id: string;
  title: string;
  message: string;
  type: 'INFO' | 'WARNING' | 'CRITICAL' | 'PROMO' | 'UPDATE';
  targetPlatform: 'ALL' | 'ANDROID' | 'WINDOWS';
  isMandatory: boolean;
  dismissible: boolean;
  actionButtonText?: string;
  actionButtonUrl?: string;
  bannerImageUrl?: string;
  publishedAt: string;
  expiresAt?: string;
  isActive: boolean;
  priority: number;
  showMode: 'EVERY_LAUNCH' | 'ONCE_PER_USER';
  createdBy?: string;
}

export function loadAnnouncements(): Announcement[] {
  if (fs.existsSync(announcementsFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(announcementsFile, 'utf8'));
      if (Array.isArray(data)) return data;
    } catch {}
  }
  const defaultAnnouncements: Announcement[] = [
    {
      id: 'ann-welcome-01',
      title: '🛡️ Bienvenue sur AbessVpn v2.1.0',
      message: 'Votre infrastructure commerciale haute vitesse est pleinement active. Profitez de nos serveurs VLESS Reality, VMess et Trojan sans aucune restriction. Rejoignez le canal officiel pour les dernières actualités !',
      type: 'INFO',
      targetPlatform: 'ALL',
      isMandatory: false,
      dismissible: true,
      actionButtonText: '📢 Canal Telegram Officiel',
      actionButtonUrl: 'https://t.me/Abess_Vpn',
      publishedAt: new Date().toISOString(),
      isActive: true,
      priority: 10,
      showMode: 'ONCE_PER_USER',
      createdBy: 'System'
    }
  ];
  writeJsonAtomically(announcementsFile, defaultAnnouncements);
  return defaultAnnouncements;
}

export function saveAnnouncements(announcements: Announcement[]): void {
  writeJsonAtomically(announcementsFile, announcements);
}

// Commercial Pricing Plans & Tiers
export interface PricingPlan {
  id: string;
  name: string;
  quotaGb: number;
  durationDays: number;
  priceCfa: number;
  badge?: string;
  description?: string;
  activeUsersCount?: number;
}

// Membership & Onboarding Requests
export interface MembershipRequest {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  countryCode: string;
  countryName: string;
  flag: string;
  dialPrefix: string;
  channel: 'WHATSAPP' | 'TELEGRAM';
  contactDetail: string;
  deviceId?: string;
  deviceModel?: string;
  deviceOs?: string;
  ipAddress: string;
  planId?: string;
  planName?: string;
  paymentMethod?: 'ORANGE_MONEY' | 'MTN_MOMO' | 'WAVE' | 'FREE_TRIAL';
  paymentRef?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  assignedTokenId?: string;
  assignedToken?: string;
  submittedAt: string;
  processedAt?: string;
}

// Persistent Audit Trail
export interface AuditLog {
  id: string;
  actor: string;
  role: string;
  action: string;
  details: string;
  ip?: string;
  timestamp: string;
}

// Multi-Variant VPN Configuration
export interface VlessVariant {
  id: string;
  label: string;
  badge: string;
  protocol: string;
  uri: string;
  sni: string;
  target: string;
  qrCode?: string;
}

export const DEFAULT_PLANS: PricingPlan[] = [
  { id: 'plan_trial', name: 'Essai Gratuit 24h', quotaGb: 2.0, durationDays: 1, priceCfa: 0, badge: 'GRATUIT', description: 'Accès ultra-rapide 24h sans engagement pour tester le service.' },
  { id: 'plan_10gb', name: 'Découverte 10 Go', quotaGb: 10.0, durationDays: 30, priceCfa: 2000, badge: 'POPULAIRE', description: 'Idéal pour messagerie WhatsApp, Telegram et navigation quotidienne.' },
  { id: 'plan_25gb', name: 'Standard 25 Go', quotaGb: 25.0, durationDays: 30, priceCfa: 3500, badge: 'RECOMMANDÉ', description: 'Parfait pour réseaux sociaux, streaming HD et téléchargements modérés.' },
  { id: 'plan_50gb', name: 'Performance 50 Go', quotaGb: 50.0, durationDays: 60, priceCfa: 6000, badge: 'PRO', description: 'Gros volume de données valable 60 jours pour utilisateurs intensifs.' },
  { id: 'plan_unlimited', name: 'VIP Illimité', quotaGb: 100.0, durationDays: 30, priceCfa: 10000, badge: 'ILLIMITÉ', description: 'Priorité réseau maximale et bande passante ultra-rapide non bridée.' }
];

export function loadPlans(): PricingPlan[] {
  if (fs.existsSync(plansFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(plansFile, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fallback
    }
  }
  writeJsonAtomically(plansFile, DEFAULT_PLANS);
  return DEFAULT_PLANS;
}

export function savePlans(plans: PricingPlan[]): void {
  writeJsonAtomically(plansFile, plans);
}

export function loadRequests(): MembershipRequest[] {
  if (fs.existsSync(requestsFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(requestsFile, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fallback
    }
  }
  return [];
}

export function saveRequests(reqs: MembershipRequest[]): void {
  writeJsonAtomically(requestsFile, reqs);
}

export function loadAuditLogs(): AuditLog[] {
  if (fs.existsSync(auditLogsFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(auditLogsFile, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fallback
    }
  }
  return [];
}

export function logAudit(entry: Omit<AuditLog, 'id' | 'timestamp'>): void {
  const list = loadAuditLogs();
  list.unshift({
    id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    ...entry,
    timestamp: new Date().toISOString()
  });
  if (list.length > 2000) list.length = 2000;
  writeJsonAtomically(auditLogsFile, list);
}

export function loadAfricanCountries(): any[] {
  if (fs.existsSync(africanCountriesFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(africanCountriesFile, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fallback
    }
  }
  return [
    { code: "CM", name: "Cameroun", flag: "🇨🇲", dial: "+237", digits: 9, example: "690123456" },
    { code: "CI", name: "Côte d'Ivoire", flag: "🇨🇮", dial: "+225", digits: 10, example: "0701234567" },
    { code: "SN", name: "Sénégal", flag: "🇸🇳", dial: "+221", digits: 9, example: "770123456" },
    { code: "CD", name: "RD Congo", flag: "🇨🇩", dial: "+243", digits: 9, example: "810123456" },
    { code: "GA", name: "Gabon", flag: "🇬🇦", dial: "+241", digits: 8, example: "74012345" },
    { code: "ML", name: "Mali", flag: "🇲🇱", dial: "+223", digits: 8, example: "70012345" },
    { code: "BF", name: "Burkina Faso", flag: "🇧🇫", dial: "+226", digits: 8, example: "70012345" },
    { code: "GN", name: "Guinée", flag: "🇬🇳", dial: "+224", digits: 9, example: "620123456" },
    { code: "BJ", name: "Bénin", flag: "🇧🇯", dial: "+229", digits: 8, example: "97012345" },
    { code: "TG", name: "Togo", flag: "🇹🇬", dial: "+228", digits: 8, example: "90012345" },
    { code: "CG", name: "Congo-Brazzaville", flag: "🇨🇬", dial: "+242", digits: 9, example: "060123456" },
    { code: "TD", name: "Tchad", flag: "🇹🇩", dial: "+235", digits: 8, example: "66012345" }
  ];
}

export interface ServerUpdateStatus {
  isGitRepo: boolean;
  currentCommit: string;
  remoteCommit: string;
  hasUpdate: boolean;
  branch: string;
  lastChecked: string;
  error?: string;
}

export async function getServerUpdateStatus(): Promise<ServerUpdateStatus> {
  const result: ServerUpdateStatus = {
    isGitRepo: false,
    currentCommit: 'unknown',
    remoteCommit: 'unknown',
    hasUpdate: false,
    branch: 'main',
    lastChecked: new Date().toISOString()
  };

  try {
    if (!fs.existsSync(path.resolve(__dirname, '.git'))) {
      result.error = 'Pas de dépôt git détecté.';
      return result;
    }
    result.isGitRepo = true;
    const { stdout: localHead } = await execAsync('git rev-parse --short HEAD', { cwd: __dirname });
    result.currentCommit = localHead.trim();

    await execAsync('git fetch origin main --quiet', { cwd: __dirname, timeout: 15000 });
    const { stdout: remoteHead } = await execAsync('git rev-parse --short origin/main', { cwd: __dirname });
    result.remoteCommit = remoteHead.trim();
    result.hasUpdate = result.currentCommit !== result.remoteCommit;
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}

export async function executeServerUpdate(): Promise<{ success: boolean; output: string; currentCommit: string }> {
  try {
    if (!fs.existsSync(path.resolve(__dirname, '.git'))) {
      return { success: false, output: 'Dépôt git absent', currentCommit: 'unknown' };
    }
    const { stdout: pullOut } = await execAsync('git pull origin main', { cwd: __dirname, timeout: 30000 });
    const { stdout: newCommit } = await execAsync('git rev-parse --short HEAD', { cwd: __dirname });

    syncXrayConfig();

    try {
      await execAsync('npm run build', { cwd: __dirname, timeout: 60000 });
    } catch (buildErr) {
      console.error('[AUTO-UPDATE] Note build frontend:', buildErr);
    }

    logTransaction({
      resellerId: 'system',
      resellerName: 'Système Auto-Update',
      type: 'SERVER_UPDATE',
      amountGb: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      note: `Mise à jour serveur vers commit ${newCommit.trim()}`
    });

    return {
      success: true,
      output: pullOut.trim(),
      currentCommit: newCommit.trim()
    };
  } catch (err: unknown) {
    return {
      success: false,
      output: err instanceof Error ? err.message : String(err),
      currentCommit: 'error'
    };
  }
}

// Master Configuration Helper
const PUBLIC_HOST_PATTERN = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;

// Hosts and SNI are deliberately not inferred from the API/panel domain.
// The Super Administrator must enter the public endpoint in the infrastructure panel.
function isValidPublicHost(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && PUBLIC_HOST_PATTERN.test(value);
}

function normalizedStoredHost(value: unknown): string {
  if (typeof value !== 'string') return '';
  const host = value.trim().toLowerCase();
  return isValidPublicHost(host) ? host : '';
}

function loadMasterConfig(): MasterServerConfig {
  const defaults: MasterServerConfig = {
    // The API/Caddy hostname from VPN_DOMAIN is not automatically a VPN profile host/SNI.
    // The Super Admin explicitly configures both in the panel before issuing licences.
    serverHost: '',
    host: '',
    serverPort: Number(process.env.VPN_PORT) || 443,
    protocol: 'vless',
    transport: 'ws',
    path: '/@abess237',
    sniHost: '',
    uuid: 'abe55237-0237-4237-8237-ab3552370237',
    secretPassphrase: process.env.MASTER_SECRET || '',
    systemName: 'AbessVpn Master Server',
    contactTelegram: process.env.CONTACT_TELEGRAM || '@abess237'
  };

  if (fs.existsSync(configFile)) {
    try {
      const stored = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Partial<MasterServerConfig>;
      const rawStoredHost = typeof stored.serverHost === 'string' ? stored.serverHost.trim() : '';
      const rawStoredHeaderHost = typeof stored.host === 'string' ? stored.host.trim() : '';
      const rawStoredSni = typeof stored.sniHost === 'string' ? stored.sniHost.trim() : '';
      const merged: MasterServerConfig = {
        ...defaults,
        ...stored,
        // Normalize persisted Host/SNI values and never infer either one from the API domain.
        serverHost: normalizedStoredHost(stored.serverHost),
        host: normalizedStoredHost(stored.host),
        serverPort: Number(stored.serverPort) || defaults.serverPort,
        path: '/@abess237',
        sniHost: normalizedStoredHost(stored.sniHost),
        secretPassphrase: process.env.MASTER_SECRET || ''
      };
      // Persist normalized fields when whitespace or letter case changed.
      if (merged.serverHost !== rawStoredHost || merged.host !== rawStoredHeaderHost || merged.sniHost !== rawStoredSni) {
        saveMasterConfig(merged);
      }
      // Shadowsocks UDP uses its native socket, not an HTTP/WebSocket proxy.
      if (merged.protocol === 'shadowsocks' && merged.transport !== 'native') {
        merged.transport = 'native';
      } else if (
        (merged.protocol !== 'vmess' && ['raw', 'kcp'].includes(merged.transport)) ||
        (merged.protocol !== 'shadowsocks' && merged.transport === 'native')
      ) {
        merged.transport = 'ws';
      }
      merged.serverPort = xrayPublicPort(merged.protocol, merged.transport, 443);
      return merged;
    } catch {
      // Recreate from environment defaults below.
    }
  }

  fs.writeFileSync(configFile, JSON.stringify(defaults, null, 2), 'utf8');
  return defaults;
}
function saveMasterConfig(cfg: MasterServerConfig) {
  writeJsonAtomically(configFile, cfg);
}

// User Storage with Initial Super Admin
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    try {
      const salt = Buffer.from(parts[1], 'hex');
      const expected = Buffer.from(parts[2], 'hex');
      if (salt.length !== 16 || expected.length !== 64) return false;
      const actual = crypto.scryptSync(password, salt, expected.length);
      return crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  return Buffer.byteLength(password) === Buffer.byteLength(storedHash)
    && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(storedHash));
}

function loadUsers(): AppUser[] {
  if (fs.existsSync(usersFile)) {
    try {
      return JSON.parse(fs.readFileSync(usersFile, 'utf8')) as AppUser[];
    } catch {
      throw new Error('Le fichier data/users.json est illisible. Restaurez une sauvegarde avant de redémarrer.');
    }
  }

  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password) {
    throw new Error('Première initialisation impossible : ADMIN_EMAIL et ADMIN_INITIAL_PASSWORD doivent être définis.');
  }

  const superAdmin: AppUser = {
    id: 'usr_admin_' + crypto.randomUUID(),
    email,
    passwordHash: hashPassword(password),
    name: process.env.ADMIN_NAME?.trim() || 'ABESS VPN Administrator',
    role: 'SUPER_ADMIN',
    credits: 999999,
    totalTokensCreated: 0,
    totalBandwidthAllocatedGb: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastLoginAt: null
  };

  const initial = [superAdmin];
  fs.writeFileSync(usersFile, JSON.stringify(initial, null, 2), 'utf8');
  return initial;
}
function saveUsers(users: AppUser[]) {
  writeJsonAtomically(usersFile, users);
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
      throw new Error('Le fichier data/tokens.json est illisible. Restaurez une sauvegarde avant de redémarrer.');
    }
  }

  const initial: ClientToken[] = [];
  fs.writeFileSync(tokensFile, JSON.stringify(initial, null, 2), 'utf8');
  return initial;
}


function xrayUserEmail(token: ClientToken): string {
  return 'abess-' + token.id.replace(/[^a-zA-Z0-9_.@-]/g, '_');
}

const XRAY_PROTOCOLS = ['vless', 'vmess', 'trojan', 'shadowsocks'] as const;
const XRAY_WEB_TRANSPORTS = ['ws', 'grpc', 'httpupgrade', 'xhttp'] as const;
// RAW is direct TCP; mKCP is a UDP-based transport. They are enabled for VMess,
// whose protocol layer supplies encryption without relying on a TLS web proxy.
const XRAY_DIRECT_TRANSPORTS = ['raw', 'kcp'] as const;
const XRAY_TRANSPORTS: readonly (typeof XRAY_WEB_TRANSPORTS[number] | typeof XRAY_DIRECT_TRANSPORTS[number])[] = [
  ...XRAY_WEB_TRANSPORTS, ...XRAY_DIRECT_TRANSPORTS
];
type XrayProtocol = typeof XRAY_PROTOCOLS[number];
type XrayWebTransport = typeof XRAY_WEB_TRANSPORTS[number];
type XrayTransport = XrayWebTransport | typeof XRAY_DIRECT_TRANSPORTS[number] | 'native';

function isXrayProtocol(value: unknown): value is XrayProtocol {
  return typeof value === 'string' && (XRAY_PROTOCOLS as readonly string[]).includes(value);
}
function isXrayTransport(value: unknown): value is XrayTransport {
  return value === 'native' || (typeof value === 'string' && (XRAY_TRANSPORTS as readonly string[]).includes(value));
}
function normalizedPath(_value: string): string { return '/@abess237'; }
function xrayProfilePath(protocol: XrayProtocol, transport: XrayTransport, customWsPath = '/@abess237'): string {
  if (protocol === 'shadowsocks' && transport === 'native') return '';
  if (protocol === 'vless' && transport === 'ws') return normalizedPath(customWsPath);
  return '/@abess237/' + protocol + '/' + transport;
}
function xrayProfilePort(protocol: XrayProtocol, transport: XrayTransport): number {
  if (transport === 'raw') return 10060;
  if (transport === 'kcp') return 10061;
  if (transport === 'native') return 10050;
  const transportIndex = XRAY_WEB_TRANSPORTS.indexOf(transport as XrayWebTransport);
  if (transportIndex < 0) throw new Error('Transport Xray non pris en charge.');
  return 10000 + XRAY_PROTOCOLS.indexOf(protocol) * 5 + transportIndex;
}
function xrayPublicPort(protocol: string, transport: string, _fallbackPort: number): number {
  if (transport === 'native' && protocol === 'shadowsocks') return 10050;
  if (protocol === 'vmess' && (transport === 'raw' || transport === 'kcp')) {
    return xrayProfilePort('vmess', transport);
  }
  // All HTTP-based transports terminate TLS at Caddy, which serves public TCP/443.
  return 443;
}
function xrayStreamSettings(transport: XrayTransport, profilePath: string): Record<string, unknown> {
  switch (transport) {
    case 'ws': return { network: 'ws', security: 'none', wsSettings: { path: profilePath } };
    case 'grpc': return { network: 'grpc', security: 'none', grpcSettings: { serviceName: profilePath.replace(/^\/+/, ''), multiMode: false } };
    case 'httpupgrade': return { network: 'httpupgrade', security: 'none', httpupgradeSettings: { path: profilePath, host: '' } };
    case 'xhttp': return { network: 'xhttp', security: 'none', xhttpSettings: { path: profilePath, mode: 'auto' } };
    case 'raw': return { network: 'raw', security: 'none', rawSettings: { header: { type: 'none' } } };
    case 'kcp': return {
      network: 'kcp',
      security: 'none',
      kcpSettings: {
        mtu: 1350, tti: 20, uplinkCapacity: 5, downlinkCapacity: 20,
        congestion: false, readBufferSize: 2, writeBufferSize: 2
      }
    };
    default: throw new Error('Transport non routable dans la matrice HTTP.');
  }
}


function isTlsWebTransport(transport: string): boolean {
  return ['ws', 'grpc', 'httpupgrade', 'xhttp'].includes(transport);
}

// This deployment's Caddyfile obtains an automatic certificate for VPN_DOMAIN only.
// A different SNI is not made valid merely by entering it in a profile.
function configuredTlsDomain(): string {
  return (process.env.VPN_DOMAIN || '').trim().toLowerCase();
}
function tlsSniValidationError(transport: string, sniHost: unknown): string | null {
  if (!isTlsWebTransport(transport)) return null;
  const configured = configuredTlsDomain();
  const supplied = typeof sniHost === 'string' ? sniHost.trim().toLowerCase() : '';
  if (!configured || !isValidPublicHost(configured)) {
    return 'Le domaine VPN_DOMAIN est absent ou invalide; le certificat TLS du serveur ne peut pas être vérifié.';
  }
  if (!isValidPublicHost(supplied)) {
    return `Indiquez un SNI TLS valide. Pour ce déploiement, le certificat Caddy est émis pour « ${configured} ».`;
  }
  if (supplied !== configured) {
    return `SNI TLS « ${supplied} » incompatible avec le certificat Caddy de ce déploiement. Utilisez exactement « ${configured} ». Le champ Host HTTP reste distinct et ne remplace pas le certificat.`;
  }
  return null;
}
function publicProtocolConfig(config: ProtocolConfig): ProtocolConfig {
  return {
    id: config.id, name: config.name, serverHost: config.serverHost, host: config.host || '',
    serverPort: config.serverPort, protocol: config.protocol, transport: config.transport,
    path: config.path || '/@abess237', sniHost: config.sniHost || '',
    createdAt: config.createdAt, updatedAt: config.updatedAt
  };
}
function legacyProtocolConfig(): ProtocolConfig | null {
  const legacy = loadMasterConfig();
  if (!isValidPublicHost(legacy.serverHost) ||
      (isTlsWebTransport(legacy.transport) && !isValidPublicHost(legacy.sniHost)) ||
      !isXrayProtocol(legacy.protocol) || !isXrayTransport(legacy.transport)) return null;
  const now = new Date().toISOString();
  return {
    id: 'cfg_legacy', name: legacy.systemName?.trim() || 'Configuration existante',
    serverHost: legacy.serverHost, host: legacy.host || '',
    serverPort: xrayPublicPort(legacy.protocol, legacy.transport, legacy.serverPort),
    protocol: legacy.protocol, transport: legacy.transport, path: '/@abess237',
    sniHost: legacy.sniHost || '', createdAt: now, updatedAt: now
  };
}
function seedDefaultProtocolConfigs(vpnDomain?: string): ProtocolConfig[] {
  const domain = (vpnDomain && isValidPublicHost(vpnDomain)) ? vpnDomain : (process.env.VPN_DOMAIN || 'vpn.example.com');
  const now = new Date().toISOString();
  return [
    {
      id: 'cfg_vless_ws',
      name: 'VLESS WebSocket (Cloudflare CDN)',
      serverHost: domain,
      host: domain,
      serverPort: 443,
      protocol: 'vless',
      transport: 'ws',
      path: '/@abess237',
      sniHost: domain,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'cfg_vmess_ws',
      name: 'VMess WebSocket (Stealth TLS)',
      serverHost: domain,
      host: domain,
      serverPort: 443,
      protocol: 'vmess',
      transport: 'ws',
      path: '/@abess237/vmess/ws',
      sniHost: domain,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'cfg_trojan_ws',
      name: 'Trojan WebSocket (HTTPS Stealth)',
      serverHost: domain,
      host: domain,
      serverPort: 443,
      protocol: 'trojan',
      transport: 'ws',
      path: '/@abess237/trojan/ws',
      sniHost: domain,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'cfg_vless_grpc',
      name: 'VLESS gRPC (High Speed)',
      serverHost: domain,
      host: domain,
      serverPort: 443,
      protocol: 'vless',
      transport: 'grpc',
      path: '/@abess237/vless/grpc',
      sniHost: domain,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'cfg_ss_native',
      name: 'Shadowsocks Direct (Low Latency TCP/UDP)',
      serverHost: domain,
      host: domain,
      serverPort: 10050,
      protocol: 'shadowsocks',
      transport: 'native',
      path: '',
      sniHost: '',
      createdAt: now,
      updatedAt: now
    }
  ];
}

export function buildDirectProtocolUrl(token: ClientToken, profile: ProtocolConfig): string {
  const host = profile.serverHost;
  const port = xrayPublicPort(profile.protocol, profile.transport, profile.serverPort);
  const sni = profile.sniHost || host;
  const wsHost = profile.host || host;
  const path = xrayProfilePath(profile.protocol as XrayProtocol, profile.transport as XrayTransport, profile.path);
  const name = `${profile.name} - ${token.token}`;
  const uuid = token.clientUuid || token.token;

  switch (profile.protocol) {
    case 'vless': {
      const security = ['native', 'raw', 'kcp'].includes(profile.transport) ? 'none' : 'tls';
      const encName = encodeURIComponent(name);
      if (profile.transport === 'grpc') {
        const serviceName = encodeURIComponent(path.replace(/^\/+/, ''));
        return `vless://${uuid}@${host}:${port}?encryption=none&security=${security}&type=grpc&serviceName=${serviceName}&mode=gun&sni=${encodeURIComponent(sni)}#${encName}`;
      }
      return `vless://${uuid}@${host}:${port}?encryption=none&security=${security}&type=${profile.transport}&path=${encodeURIComponent(path)}&host=${encodeURIComponent(wsHost)}&sni=${encodeURIComponent(sni)}#${encName}`;
    }
    case 'vmess': {
      const isTls = !['native', 'raw', 'kcp'].includes(profile.transport);
      const vmessObj: Record<string, unknown> = {
        v: '2',
        ps: name,
        add: host,
        port: String(port),
        id: uuid,
        aid: '0',
        scy: 'auto',
        net: profile.transport === 'raw' ? 'tcp' : profile.transport,
        type: 'none',
        host: wsHost,
        path: profile.transport === 'grpc' ? path.replace(/^\/+/, '') : path,
        tls: isTls ? 'tls' : 'none',
        sni: sni
      };
      return `vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`;
    }
    case 'trojan': {
      const encName = encodeURIComponent(name);
      return `trojan://${uuid}@${host}:${port}?security=tls&type=${profile.transport}&path=${encodeURIComponent(path)}&host=${encodeURIComponent(wsHost)}&sni=${encodeURIComponent(sni)}#${encName}`;
    }
    case 'shadowsocks': {
      const encName = encodeURIComponent(name);
      const creds = `aes-128-gcm:${uuid}@${host}:${port}`;
      if (profile.transport === 'native') {
        return `ss://${Buffer.from(creds).toString('base64url')}#${encName}`;
      }
      return `ss://${Buffer.from(creds).toString('base64url')}?plugin=${encodeURIComponent(`v2ray-plugin;path=${path};host=${wsHost};tls`)}#${encName}`;
    }
    default:
      return '';
  }
}

// Multi-SNI & Edge Anycast Configuration Targets (Anti-DPI Engine)
export const DEFAULT_SNI_LIST = [
  "crashlyticsreports-pa.googleapis.com",
  "firebaselogging-pa.googleapis.com",
  "clientservices.googleapis.com",
  "play.googleapis.com",
  "m.batch.com"
];

export const DEFAULT_TARGET_IPS = [
  "192.179.18.100:443",
  "142.250.180.14:443",
  "172.217.18.206:443",
  "142.250.74.206:443",
  "216.239.38.120:443",
  "142.250.185.238:443",
  "172.217.170.206:443"
];

export function generateUserVlessVariants(token: ClientToken, profile?: ProtocolConfig): VlessVariant[] {
  const master = loadMasterConfig();
  const host = profile?.serverHost || master.serverHost || 'panel.pagnol.xyz';
  const port = profile?.serverPort || master.serverPort || 443;
  const primarySni = profile?.sniHost || master.sniHost || host;
  const wsHost = profile?.host || master.host || host;
  const rawPath = profile?.path || master.path || '/@abess237';
  const cleanPath = rawPath.split('?')[0] || '/@abess237';
  const uuid = token.clientUuid || token.token;
  const baseName = `${profile?.name || 'AbessVpn'} - ${token.token}`;

  const variants: VlessVariant[] = [];

  // 1. Fast (0-RTT Early Data)
  const fastTag = `${baseName} ⚡ Fast (0-RTT)`;
  const fastUri = `vless://${uuid}@${host}:${port}?encryption=none&security=tls&sni=${encodeURIComponent(primarySni)}&fp=chrome&alpn=http%2F1.1&type=ws&host=${encodeURIComponent(wsHost)}&path=${encodeURIComponent(cleanPath + '?ed=2048')}#${encodeURIComponent(fastTag)}`;
  variants.push({
    id: 'fast',
    label: '⚡ Nexus / Abess Fast (0-RTT Early Data)',
    badge: '0-RTT • RECOMMANDÉ',
    protocol: 'vless',
    uri: fastUri,
    sni: primarySni,
    target: `${host}:${port}`
  });

  // 2. Stable (Standard Compatible)
  const stableTag = `${baseName} 🛡️ Stable`;
  const stableUri = `vless://${uuid}@${host}:${port}?encryption=none&security=tls&sni=${encodeURIComponent(primarySni)}&fp=chrome&alpn=http%2F1.1&type=ws&host=${encodeURIComponent(wsHost)}&path=${encodeURIComponent(cleanPath)}#${encodeURIComponent(stableTag)}`;
  variants.push({
    id: 'stable',
    label: '🛡️ Nexus / Abess Stable (Compatibilité Standard)',
    badge: 'COMPATIBILITÉ MAX',
    protocol: 'vless',
    uri: stableUri,
    sni: primarySni,
    target: `${host}:${port}`
  });

  // 3. Multi-SNI Bug Hosts
  let addedSni = 0;
  for (const altSni of DEFAULT_SNI_LIST) {
    if (altSni === primarySni) continue;
    addedSni++;
    const shortSni = altSni.split('.')[0];
    const sniTag = `${baseName} [BugHost: ${shortSni}]`;
    const sniUri = `vless://${uuid}@${host}:${port}?encryption=none&security=tls&sni=${encodeURIComponent(altSni)}&fp=chrome&alpn=http%2F1.1&type=ws&host=${encodeURIComponent(wsHost)}&path=${encodeURIComponent(cleanPath)}#${encodeURIComponent(sniTag)}`;
    variants.push({
      id: `sni_${addedSni}`,
      label: `🌐 Bug Host Anti-DPI • ${altSni}`,
      badge: 'MULTI-SNI',
      protocol: 'vless',
      uri: sniUri,
      sni: altSni,
      target: `${host}:${port}`
    });
  }

  // 4. Anycast Edge Targets
  let addedTarget = 0;
  for (const altTarget of DEFAULT_TARGET_IPS) {
    addedTarget++;
    const parts = altTarget.split(':');
    const ip = parts[0];
    const targetPort = parts[1] || '443';
    const edgeTag = `${baseName} [Edge: ${ip}]`;
    const edgeUri = `vless://${uuid}@${ip}:${targetPort}?encryption=none&security=tls&sni=${encodeURIComponent(primarySni)}&fp=chrome&alpn=http%2F1.1&type=ws&host=${encodeURIComponent(wsHost)}&path=${encodeURIComponent(cleanPath)}#${encodeURIComponent(edgeTag)}`;
    variants.push({
      id: `edge_${addedTarget}`,
      label: `🚀 Anycast Google Edge • ${altTarget}`,
      badge: 'ANYCAST EDGE',
      protocol: 'vless',
      uri: edgeUri,
      sni: primarySni,
      target: altTarget
    });
  }

  // 5. Alternate Protocols (VMess, Trojan, Shadowsocks)
  const vmessObj = {
    v: '2',
    ps: `${baseName} ⚡ VMess CDN`,
    add: host,
    port: String(port),
    id: uuid,
    aid: '0',
    scy: 'auto',
    net: 'ws',
    type: 'none',
    host: wsHost,
    path: cleanPath,
    tls: 'tls',
    sni: primarySni
  };
  variants.push({
    id: 'vmess_ws',
    label: '⚡ VMess WebSocket TLS',
    badge: 'VMESS CDN',
    protocol: 'vmess',
    uri: `vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`,
    sni: primarySni,
    target: `${host}:${port}`
  });

  variants.push({
    id: 'trojan_ws',
    label: '🔒 Trojan WebSocket TLS',
    badge: 'TROJAN SECURE',
    protocol: 'trojan',
    uri: `trojan://${uuid}@${host}:${port}?security=tls&type=ws&path=${encodeURIComponent(cleanPath)}&host=${encodeURIComponent(wsHost)}&sni=${encodeURIComponent(primarySni)}#${encodeURIComponent(baseName + ' 🔒 Trojan')}`,
    sni: primarySni,
    target: `${host}:${port}`
  });

  const ssCreds = `aes-128-gcm:${uuid}@${host}:${port}`;
  variants.push({
    id: 'shadowsocks_ws',
    label: '🛡️ Shadowsocks v2ray-plugin',
    badge: 'SHADOWSOCKS',
    protocol: 'shadowsocks',
    uri: `ss://${Buffer.from(ssCreds).toString('base64url')}?plugin=${encodeURIComponent(`v2ray-plugin;path=${cleanPath};host=${wsHost};tls`)}#${encodeURIComponent(baseName + ' 🛡️ SS')}`,
    sni: primarySni,
    target: `${host}:${port}`
  });

  return variants;
}

export function generateXrayClientJson(token: ClientToken, profile?: ProtocolConfig): Record<string, unknown> {
  const master = loadMasterConfig();
  const host = profile?.serverHost || master.serverHost || 'panel.pagnol.xyz';
  const port = Number(profile?.serverPort || master.serverPort || 443);
  const primarySni = profile?.sniHost || master.sniHost || host;
  const wsHost = profile?.host || master.host || host;
  const rawPath = profile?.path || master.path || '/@abess237';
  const cleanPath = rawPath.split('?')[0] || '/@abess237';
  const uuid = token.clientUuid || token.token;

  return {
    remarks: `${token.token} ⚡ AbessVpn Pro`,
    log: { loglevel: 'warning' },
    policy: {
      levels: {
        '0': {
          handshake: 6,
          connIdle: 600,
          uplinkOnly: 2,
          downlinkOnly: 5,
          bufferSize: 2048
        }
      },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true
      }
    },
    dns: {
      servers: [
        'https+local://1.1.1.1/dns-query',
        'https+local://8.8.8.8/dns-query',
        '1.1.1.1',
        '8.8.8.8'
      ],
      queryStrategy: 'UseIPv4',
      disableCache: false,
      disableFallback: false
    },
    inbounds: [
      {
        tag: 'socks-in',
        port: 10808,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true }
      },
      {
        tag: 'http-in',
        port: 10809,
        listen: '127.0.0.1',
        protocol: 'http',
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true }
      }
    ],
    outbounds: [
      {
        tag: 'proxy',
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: host,
              port,
              users: [
                {
                  id: uuid,
                  encryption: 'none',
                  level: 0
                }
              ]
            }
          ]
        },
        streamSettings: {
          network: 'ws',
          security: 'tls',
          tlsSettings: {
            serverName: primarySni,
            allowInsecure: false,
            fingerprint: 'chrome',
            alpn: ['http/1.1']
          },
          wsSettings: {
            path: cleanPath,
            headers: { Host: wsHost }
          },
          sockopt: {
            tcpFastOpen: true,
            tcpNoDelay: true,
            tcpKeepAliveIdle: 30,
            tcpKeepAliveInterval: 15
          }
        },
        mux: { enabled: false }
      },
      { tag: 'dns-out', protocol: 'dns', settings: { network: 'tcp', nonIPQuery: 'skip' } },
      { tag: 'direct', protocol: 'freedom', settings: { domainStrategy: 'UseIPv4' } },
      { tag: 'block', protocol: 'blackhole', settings: { response: { type: 'none' } } }
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        { type: 'field', inboundTag: ['socks-in', 'http-in'], outboundTag: 'proxy' }
      ]
    }
  };
}

export function probeEndpoint(targetServer: string, sni: string, timeoutMs = 3000): Promise<{ tcp_latency_ms: number; tls_latency_ms: number; latency_ms: number; status: string; error?: string }> {
  return new Promise((resolve) => {
    let host = targetServer.trim();
    let port = 443;
    if (host.includes(':')) {
      const parts = host.split(':');
      host = parts[0];
      port = Number(parts[1]) || 443;
    }
    const t0 = Date.now();
    let tcpConnectedAt = 0;

    const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
      tcpConnectedAt = Date.now();
      const tcpLatency = tcpConnectedAt - t0;

      const tlsSocket = tls.connect({
        socket,
        servername: sni || host,
        rejectUnauthorized: false,
        timeout: timeoutMs
      }, () => {
        const tlsDoneAt = Date.now();
        const tlsLatency = tlsDoneAt - tcpConnectedAt;
        const totalLatency = tlsDoneAt - t0;
        tlsSocket.destroy();
        resolve({
          tcp_latency_ms: tcpLatency,
          tls_latency_ms: tlsLatency,
          latency_ms: totalLatency,
          status: 'ok'
        });
      });

      tlsSocket.on('error', (err) => {
        socket.destroy();
        resolve({
          tcp_latency_ms: tcpLatency,
          tls_latency_ms: 0,
          latency_ms: Date.now() - t0,
          status: 'tls_error',
          error: err.message
        });
      });
      tlsSocket.on('timeout', () => {
        tlsSocket.destroy();
        resolve({
          tcp_latency_ms: tcpLatency,
          tls_latency_ms: 0,
          latency_ms: timeoutMs,
          status: 'timeout',
          error: 'TLS handshake timeout'
        });
      });
    });

    socket.on('error', (err) => {
      resolve({
        tcp_latency_ms: 0,
        tls_latency_ms: 0,
        latency_ms: Date.now() - t0,
        status: 'tcp_error',
        error: err.message
      });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        tcp_latency_ms: timeoutMs,
        tls_latency_ms: 0,
        latency_ms: timeoutMs,
        status: 'timeout',
        error: 'TCP connection timeout'
      });
    });
  });
}

export function getSystemDiagnostics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const tokens = loadTokens();
  const users = loadUsers();
  const plans = loadPlans();
  const requests = loadRequests();
  const master = loadMasterConfig();
  const version = loadAppVersionConfig();

  const totalBandwidthUsedGb = tokens.reduce((acc, t) => acc + (Number(t.bandwidthUsedGb) || 0), 0);
  const activeTokens = tokens.filter(t => t.status === 'active' && new Date(t.expiresAt).getTime() > Date.now());

  return {
    ok: true,
    server: {
      uptimeSeconds: Math.floor(process.uptime()),
      systemUptimeSeconds: Math.floor(os.uptime()),
      nodeVersion: process.version,
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg(),
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usedBytes: usedMem,
        usedPercent: Math.round((usedMem / totalMem) * 100)
      }
    },
    vpn: {
      activeTokensCount: activeTokens.length,
      totalTokensCount: tokens.length,
      resellersCount: users.filter(u => u.role === 'RESELLER').length,
      totalBandwidthUsedGb: Number(totalBandwidthUsedGb.toFixed(2)),
      plansCount: plans.length,
      pendingRequestsCount: requests.filter(r => r.status === 'PENDING').length,
      xrayStatus: fs.existsSync(xrayStatusFile) ? 'ready' : 'not-ready',
      vpnDomain: master.serverHost || 'panel.pagnol.xyz',
      appVersion: version.latestVersion
    },
    timestamp: new Date().toISOString()
  };
}

function loadProtocolConfigs(): ProtocolConfig[] {
  if (fs.existsSync(protocolConfigsFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(protocolConfigsFile, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter((item: any) =>
          item && typeof item.id === 'string' && typeof item.name === 'string' &&
          isValidPublicHost(item.serverHost) && isXrayProtocol(item.protocol) && isXrayTransport(item.transport)
        ).map((item: any) => publicProtocolConfig({
          ...item,
          host: typeof item.host === 'string' ? item.host : '',
          sniHost: typeof item.sniHost === 'string' ? item.sniHost : '',
          serverPort: xrayPublicPort(item.protocol, item.transport, Number(item.serverPort) || 443),
          path: xrayProfilePath(item.protocol, item.transport, item.path || '/@abess237'),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString()
        } as ProtocolConfig));
        if (valid.length > 0) return valid;
      }
    } catch {
      throw new Error('Le fichier data/protocol-configs.json est illisible. Restaurez une sauvegarde avant de continuer.');
    }
  }
  const legacy = legacyProtocolConfig();
  return legacy ? [legacy] : [];
}
function saveProtocolConfigs(configs: ProtocolConfig[]): void {
  writeJsonAtomically(protocolConfigsFile, configs.map(publicProtocolConfig));
}
function normalizeProtocolConfig(input: any, existing?: ProtocolConfig): ProtocolConfig | null {
  const name = String(input?.name ?? existing?.name ?? '').trim();
  const serverHost = String(input?.serverHost ?? existing?.serverHost ?? '').trim();
  const host = String(input?.host ?? existing?.host ?? '').trim();
  const protocol = String(input?.protocol ?? existing?.protocol ?? 'vless').toLowerCase();
  const transport = String(input?.transport ?? existing?.transport ?? 'ws').toLowerCase();
  const sniHost = String(input?.sniHost ?? existing?.sniHost ?? '').trim();
  if (name.length < 2 || name.length > 80) return null;
  if (!isValidPublicHost(serverHost) || (host !== '' && !isValidPublicHost(host))) return null;
  if (!isXrayProtocol(protocol) || !isXrayTransport(transport)) return null;
  if (transport === 'native' && protocol !== 'shadowsocks') return null;
  if (['raw', 'kcp'].includes(transport) && protocol !== 'vmess') return null;
  if (['raw', 'kcp', 'native'].includes(transport) && (protocol === 'vless' || protocol === 'trojan')) return null;
  if (tlsSniValidationError(transport, sniHost)) return null;
  if (sniHost && !isValidPublicHost(sniHost)) return null;
  const now = new Date().toISOString();
  return {
    id: existing?.id || 'cfg_' + crypto.randomUUID(), name, serverHost, host,
    serverPort: xrayPublicPort(protocol, transport, Number(input?.serverPort) || 443),
    protocol, transport, path: xrayProfilePath(protocol as XrayProtocol, transport as XrayTransport, input?.path || '/@abess237'), sniHost,
    createdAt: existing?.createdAt || now, updatedAt: now
  };
}
function protocolConfigForToken(token: ClientToken, configs = loadProtocolConfigs()): ProtocolConfig | null {
  if (token.configurationSnapshot && isValidPublicHost(token.configurationSnapshot.serverHost)) {
    return publicProtocolConfig(token.configurationSnapshot);
  }
  if (token.configurationId) {
    const found = configs.find(config => config.id === token.configurationId);
    if (found) return found;
  }
  if (!token.configurationId && !token.configurationSnapshot) {
    const legacy = legacyProtocolConfig();
    if (legacy) return legacy;
  }
  return configs[0] || null;
}
function safeClientToken(token: ClientToken): Omit<ClientToken, 'configurationSnapshot'> {
  const { configurationSnapshot: _configurationSnapshot, ...safe } = token;
  return safe;
}

function syncXrayConfig(tokens: ClientToken[] = loadTokens()): boolean {
  const masterConfig = loadMasterConfig();
  const now = Date.now();
  const activeTokens = tokens.filter(token => token.status === 'active' &&
    Number.isFinite(new Date(token.expiresAt).getTime()) && new Date(token.expiresAt).getTime() > now &&
    Number(token.bandwidthUsedGb) < Number(token.bandwidthGb) &&
    typeof token.clientUuid === 'string' && token.clientUuid.length > 0);
  const profiles = loadProtocolConfigs();
  const inbounds: Array<Record<string, unknown>> = [];
  for (const protocol of XRAY_PROTOCOLS) {
    const transports = protocol === 'vmess' ? XRAY_TRANSPORTS : XRAY_WEB_TRANSPORTS;
    for (const transport of transports) {
      const profilePath = xrayProfilePath(protocol, transport, masterConfig.path);
      const profileTokens = activeTokens.filter(token => {
        const profile = protocolConfigForToken(token, profiles);
        return !!profile && profile.protocol === protocol && profile.transport === transport;
      });
      const users = profileTokens.map(token => ({ id: token.clientUuid as string, email: xrayUserEmail(token), level: 0 }));
      let settings: Record<string, unknown>;
      switch (protocol) {
        case 'vless': settings = { users, decryption: 'none' }; break;
        case 'vmess': settings = { users: users.map(user => ({ id: user.id, email: user.email, level: 0, alterId: 0, security: 'auto' })) }; break;
        case 'trojan': settings = { users: profileTokens.map(token => ({ password: token.clientUuid as string, email: xrayUserEmail(token), level: 0 })) }; break;
        case 'shadowsocks':
          settings = {
            network: 'tcp',
            method: 'aes-128-gcm',
            password: crypto.createHmac('sha256', masterConfig.secretPassphrase || 'abessvpn').update('abessvpn-shadowsocks-inbound').digest('hex'),
            users: profileTokens.map(token => ({ method: 'aes-128-gcm', password: token.clientUuid as string, email: xrayUserEmail(token), level: 0 }))
          };
          break;
      }
      inbounds.push({ tag: protocol + '-' + transport + '-in', listen: '0.0.0.0', port: xrayProfilePort(protocol, transport), protocol, settings, streamSettings: xrayStreamSettings(transport, profilePath) });
    }
  }
  // Native Shadowsocks uses an exposed TCP/UDP socket; Caddy handles only HTTP-based transports.
  inbounds.push({
    tag: 'shadowsocks-native-in', listen: '0.0.0.0', port: 10050, protocol: 'shadowsocks',
    settings: {
      network: 'tcp,udp', method: 'aes-128-gcm',
      password: crypto.createHmac('sha256', masterConfig.secretPassphrase || 'abessvpn').update('abessvpn-shadowsocks-native').digest('hex'),
      users: activeTokens.filter(token => { const profile = protocolConfigForToken(token, profiles); return !!profile && profile.protocol === 'shadowsocks' && profile.transport === 'native'; }).map(token => ({ method: 'aes-128-gcm', password: token.clientUuid as string, email: xrayUserEmail(token), level: 0 }))
    }
  });
  inbounds.push({ tag: 'api', listen: '127.0.0.1', port: 10085, protocol: 'dokodemo-door', settings: { address: '127.0.0.1' } });
  const config = {
    log: { loglevel: 'warning', access: 'none', error: '/dev/stderr' },
    api: { tag: 'api', services: ['HandlerService', 'StatsService', 'LoggerService'] },
    stats: {},
    policy: { levels: { '0': { statsUserUplink: true, statsUserDownlink: true, statsUserOnline: true } } },
    inbounds,
    outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }, { tag: 'api', protocol: 'freedom', settings: {} }, { tag: 'block', protocol: 'blackhole', settings: {} }],
    routing: { rules: [{ type: 'field', inboundTag: ['api'], outboundTag: 'api' }] }
  };
  return writeJsonAtomically(xrayConfigFile, config);
}
interface XrayUsageState {
  generation: string;
  lastCounters: Record<string, { uplink: number; downlink: number }>;
}

function readXrayUsageState(): XrayUsageState {
  try {
    const state = JSON.parse(fs.readFileSync(xrayUsageStateFile, 'utf8')) as XrayUsageState;
    if (typeof state.generation === 'string' && state.lastCounters && typeof state.lastCounters === 'object') return state;
  } catch {
    // First run or invalid state; start a clean baseline.
  }
  return { generation: '', lastCounters: {} };
}

function reconcileXrayUsage(): boolean {
  if (!fs.existsSync(xrayStatusFile) || !fs.existsSync(xrayStatsFile)) return false;

  try {
    const snapshot = JSON.parse(fs.readFileSync(xrayStatsFile, 'utf8')) as {
      generation?: string;
      stat?: Array<{ name?: string; value?: string | number }>;
    };
    if (!snapshot.generation || !Array.isArray(snapshot.stat)) return false;

    const state = readXrayUsageState();
    const newGeneration = state.generation !== snapshot.generation;
    const counters = new Map<string, number>();
    for (const stat of snapshot.stat) {
      if (typeof stat.name !== 'string') continue;
      const value = Number(stat.value ?? 0);
      if (Number.isFinite(value) && value >= 0) counters.set(stat.name, value);
    }

    const tokens = loadTokens();
    let tokensChanged = false;
    let currentTotalBytes = 0;

    for (const token of tokens) {
      const prefix = `user>>>${xrayUserEmail(token)}>>>traffic>>>`;
      const uplink = counters.get(prefix + 'uplink') ?? 0;
      const downlink = counters.get(prefix + 'downlink') ?? 0;
      currentTotalBytes += uplink + downlink;

      const previous = state.lastCounters[token.id] || { uplink: 0, downlink: 0 };
      const uplinkDelta = newGeneration || uplink < previous.uplink ? uplink : uplink - previous.uplink;
      const downlinkDelta = newGeneration || downlink < previous.downlink ? downlink : downlink - previous.downlink;
      state.lastCounters[token.id] = { uplink, downlink };

      if (token.status === 'active' && (uplinkDelta + downlinkDelta) > 0) {
        const used = Number(token.bandwidthUsedGb) + (uplinkDelta + downlinkDelta) / (1024 ** 3);
        token.bandwidthUsedGb = Math.min(Number(token.bandwidthGb), used);
        if (token.bandwidthUsedGb >= Number(token.bandwidthGb)) token.status = 'quota_exceeded';
        tokensChanged = true;
      }
    }

    state.generation = snapshot.generation;
    writeJsonAtomically(xrayUsageStateFile, state);
    totalBytesTransferred = currentTotalBytes;
    activeTunnelConnections = snapshot.stat.filter(stat =>
      typeof stat.name === 'string' &&
      stat.name.startsWith('user>>>') &&
      stat.name.endsWith('>>>online') &&
      Number(stat.value ?? 0) > 0
    ).length;

    if (tokensChanged) saveTokens(tokens);
    return true;
  } catch (error) {
    console.error('[XRAY STATS] Could not reconcile Xray usage:', error);
    return false;
  }
}

function saveTokens(tokens: ClientToken[]) {
  writeJsonAtomically(tokensFile, tokens);
  syncXrayConfig(tokens);
}

// Versioned authenticated encryption. The master key never leaves the server.
// AES-256-GCM detects both disclosure attempts and any modification of the payload.
function encryptConfig(plainJson: object, secret: string): string {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(plainJson), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return `abess://v2.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

// Telemetry & metrics
let activeTunnelConnections = 0;
let totalBytesTransferred = 0;
const startTime = Date.now();

// Sessions in memory for token authentication with TTL (24h)
export interface SessionData {
  userId: string;
  role: string;
  email: string;
  createdAt: number;
}
const activeSessions = new Map<string, SessionData>();

// Anti-Brute-Force Rate Limiting for Authentication
const loginAttempts = new Map<string, { count: number; blockedUntil: number }>();

function checkLoginRateLimit(ip: string): { allowed: boolean; remainingSec?: number } {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (record) {
    if (record.blockedUntil > now) {
      return { allowed: false, remainingSec: Math.ceil((record.blockedUntil - now) / 1000) };
    }
    if (record.blockedUntil > 0 && now >= record.blockedUntil) {
      loginAttempts.delete(ip);
    }
  }
  return { allowed: true };
}

function recordLoginAttempt(ip: string, success: boolean): void {
  const now = Date.now();
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  const record = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  record.count += 1;
  if (record.count >= 5) {
    record.blockedUntil = now + 15 * 60 * 1000; // 15 minutes ban
  }
  loginAttempts.set(ip, record);
}

// Periodic TTL session and rate limiter cleanup
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (now - session.createdAt > 24 * 3600 * 1000) {
      activeSessions.delete(token);
    }
  }
  for (const [ip, record] of loginAttempts.entries()) {
    if (record.blockedUntil > 0 && now >= record.blockedUntil) {
      loginAttempts.delete(ip);
    }
  }
}, 60 * 60 * 1000);

async function startServer() {
  const vpnDomain = process.env.VPN_DOMAIN?.trim();
  const initialAdminEmail = process.env.ADMIN_EMAIL?.trim();
  const initialAdminPassword = process.env.ADMIN_INITIAL_PASSWORD;
  const masterSecret = process.env.MASTER_SECRET;

  if (!vpnDomain || /[/:\s]/.test(vpnDomain)) throw new Error('VPN_DOMAIN doit être un nom de domaine, sans protocole ni chemin.');
  if (!initialAdminEmail || !initialAdminPassword || initialAdminPassword.length < 16) {
    throw new Error('Définissez ADMIN_EMAIL et un ADMIN_INITIAL_PASSWORD d’au moins 16 caractères.');
  }
  if (!masterSecret || masterSecret.length < 32) {
    throw new Error('MASTER_SECRET doit contenir au moins 32 caractères aléatoires.');
  }

  loadUsers();
  const startupTokens = loadTokens();
  syncXrayConfig(startupTokens);

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

  // Public App Version endpoint for Android app auto-update and mandatory update enforcement
  app.get('/api/v1/app/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const versionConfig = loadAppVersionConfig();
    res.json({
      ok: true,
      ...versionConfig
    });
  });

  // Public Announcements endpoint for Mobile App and Desktop Software
  app.get(['/api/v1/announcements/active', '/api/v1/app/announcements'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const platform = String(req.query.platform || 'all').toLowerCase();
    const all = loadAnnouncements();
    const now = new Date();

    const active = all.filter(a => {
      if (!a.isActive) return false;
      if (a.expiresAt && new Date(a.expiresAt) < now) return false;
      if (platform !== 'all' && a.targetPlatform !== 'ALL') {
        if (a.targetPlatform.toLowerCase() !== platform) return false;
      }
      return true;
    }).sort((a, b) => (b.priority || 0) - (a.priority || 0) || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    res.json({
      ok: true,
      count: active.length,
      announcements: active
    });
  });

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
      dataPlane: fs.existsSync(xrayStatusFile) ? 'ready' : 'not-ready'
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
    const rawToken = req.body?.token == null ? '' : String(req.body.token).trim();
    if (!rawToken) {
      res.status(400).json({ ok: false, error: 'Token manquant' });
      return;
    }

    let tokens = loadTokens();
    let found = tokens.find(t => t.token.toUpperCase() === rawToken.toUpperCase());
    if (!found) {
      res.status(401).json({ ok: false, error: 'Token client non reconnu ou révoqué.' });
      return;
    }

    reconcileXrayUsage();
    // Re-read after reconciliation: it may have advanced the real Xray counters or disabled an exhausted licence.
    tokens = loadTokens();
    found = tokens.find(t => t.token.toUpperCase() === rawToken.toUpperCase());
    if (!found) {
      res.status(401).json({ ok: false, error: 'Token client non reconnu ou révoqué.' });
      return;
    }

    const now = Date.now();
    const expiry = new Date(found.expiresAt).getTime();
    const isExpired = !Number.isFinite(expiry) || now >= expiry || found.status === 'expired';
    const isQuotaExceeded = found.status === 'quota_exceeded' || found.bandwidthUsedGb >= found.bandwidthGb;

    if (isExpired && found.status !== 'expired') {
      found.status = 'expired';
      saveTokens(tokens);
    } else if (isQuotaExceeded && found.status !== 'quota_exceeded') {
      found.status = 'quota_exceeded';
      saveTokens(tokens);
    }

    if (!fs.existsSync(xrayStatusFile)) {
      res.status(503).json({
        ok: false,
        error: 'Le moteur Xray-core n’est pas prêt.',
        dataPlane: 'not-ready'
      });
      return;
    }

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
      quotaSource: 'xray-core-user-stats'
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

    if (Date.now() - session.createdAt > 24 * 3600 * 1000) {
      activeSessions.delete(token);
      res.status(401).json({ error: 'Session expirée (délai de 24h dépassé). Veuillez vous reconnecter.' });
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
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';

    const rateCheck = checkLoginRateLimit(clientIp);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: `Trop de tentatives échouées. Veuillez patienter ${rateCheck.remainingSec}s avant de réessayer.`
      });
      return;
    }

    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email et mot de passe requis' });
      return;
    }

    const users = loadUsers();
    const user = users.find(u => u.email.toLowerCase().trim() === String(email).toLowerCase().trim());
    if (!user || !verifyPassword(String(password), user.passwordHash)) {
      recordLoginAttempt(clientIp, false);
      res.status(401).json({ error: 'Identifiants incorrects (Email ou mot de passe invalide)' });
      return;
    }
    if (user.status !== 'active') {
      res.status(403).json({ error: 'Ce compte a été suspendu par l\'administrateur principal.' });
      return;
    }

    recordLoginAttempt(clientIp, true);

    // Upgrade credentials created by older releases after the first successful login.
    if (!user.passwordHash.startsWith('scrypt' + String.fromCharCode(36))) {
      user.passwordHash = hashPassword(String(password));
    }
    user.lastLoginAt = new Date().toISOString();
    saveUsers(users);

    const sessionToken = 'sess_' + crypto.randomBytes(32).toString('hex');
    activeSessions.set(sessionToken, {
      userId: user.id,
      role: user.role,
      email: user.email,
      createdAt: Date.now()
    });
    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        credits: user.credits, totalTokensCreated: user.totalTokensCreated,
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

    const prev = reseller.credits;
    reseller.credits = Math.max(0, reseller.credits + amount);
    saveUsers(users);

    logTransaction({
      resellerId: reseller.id,
      resellerName: reseller.name,
      type: 'CREDIT_ADD',
      amountGb: amount,
      balanceBefore: prev,
      balanceAfter: reseller.credits,
      note: req.body?.note || `Recharge de ${amount} Go par ${user.name}`
    });

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
      res.json(tokens.map(safeClientToken));
    } else {
      // Reseller sees ONLY his own tokens
      const myTokens = tokens.filter(t => t.resellerId === user.id);
      res.json(myTokens.map(safeClientToken));
    }
  });

  // Create a token against a named configuration owned by the Super Admin.
  app.post('/api/v1/admin/tokens', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const { token, plan, bandwidthGb, expiresAt, days, deviceLimit, configurationId } = req.body || {};
    const rawAllowedDeviceId = req.body?.allowedDeviceId;
    const allowedDeviceId = typeof rawAllowedDeviceId === 'string' ? rawAllowedDeviceId.trim() : '';
    if (allowedDeviceId && (
      allowedDeviceId.length < 8 ||
      allowedDeviceId.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(allowedDeviceId)
    )) {
      res.status(400).json({ error: 'L’ID d’installation doit contenir 8 à 128 caractères alphanumériques, tirets, points ou deux-points, sans espace.' });
      return;
    }
    const requestedGb = Number(bandwidthGb) || 50;
    if (!Number.isFinite(requestedGb) || requestedGb < 1 || requestedGb > 100000) {
      res.status(400).json({ error: 'Le quota doit être compris entre 1 et 100000 Go.' });
      return;
    }
    if (user.role === 'RESELLER' && user.credits < requestedGb) {
      res.status(400).json({
        error: `Crédits insuffisants ! Votre solde actuel est de ${user.credits} Go. Vous avez demandé ${requestedGb} Go. Veuillez contacter le Super Administrateur pour recharger votre compte.`
      });
      return;
    }
    const configs = loadProtocolConfigs();
    const selected = typeof configurationId === 'string' ? configs.find(config => config.id === configurationId) : undefined;
    const profile = selected || (configs.length === 1 && !configurationId ? configs[0] : undefined);
    if (!profile) {
      res.status(409).json({
        error: configs.length === 0
          ? 'Aucune configuration VPN n’est disponible. Le Super Administrateur doit en créer une dans Infrastructure.'
          : 'Sélectionnez la configuration VPN à associer à ce token.'
      });
      return;
    }
    const profileSniError = tlsSniValidationError(profile.transport, profile.sniHost);
    if (!isValidPublicHost(profile.serverHost) || profileSniError) {
      res.status(409).json({
        error: profileSniError || 'Cette configuration ne dispose pas d’une adresse de destination valide.'
      });
      return;
    }
    const finalToken = String(token || 'ABESS-' + crypto.randomBytes(5).toString('hex').toUpperCase()).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{3,63}$/.test(finalToken)) {
      res.status(400).json({ error: 'Le code token doit contenir 4 à 64 caractères parmi A-Z, 0-9, tiret et soulignement.' });
      return;
    }
    if (loadTokens().some(existing => existing.token.toUpperCase() === finalToken)) {
      res.status(409).json({ error: 'Ce code token existe déjà. Générez-en un autre.' });
      return;
    }
    const clientUuid = crypto.randomUUID();
    const calculatedExpiresAt = expiresAt || new Date(Date.now() + (Number(days) || 30) * 24 * 3600 * 1000).toISOString();
    const expiryTimestamp = new Date(calculatedExpiresAt).getTime();
    if (!Number.isFinite(expiryTimestamp) || expiryTimestamp <= Date.now()) {
      res.status(400).json({ error: 'La date d’expiration doit être une date future valide.' });
      return;
    }
    const daysRemaining = Math.max(1, Math.ceil((expiryTimestamp - Date.now()) / (1000 * 3600 * 24)));
    const clientLimit = Math.max(1, Math.min(10, Math.floor(Number(deviceLimit) || 2)));
    const masterSecret = process.env.MASTER_SECRET || loadMasterConfig().secretPassphrase;
    if (!masterSecret || masterSecret.length < 32) {
      res.status(503).json({ error: 'Le secret maître est absent ou invalide; aucune licence n’a été créée.' });
      return;
    }
    const customerNote = req.body?.customerNote?.toString()?.trim() || undefined;
    const customerContact = req.body?.customerContact?.toString()?.trim() || undefined;

    const encryptedPayload = {
      vpnName: 'AbessVpn', token: finalToken, bandwidthGb: requestedGb,
      expiresAt: calculatedExpiresAt, allowedDeviceId: allowedDeviceId || undefined,
      configurationId: profile.id, configurationName: profile.name,
      serverHost: profile.serverHost, host: profile.host || profile.serverHost,
      serverPort: xrayPublicPort(profile.protocol, profile.transport, profile.serverPort),
      path: xrayProfilePath(profile.protocol as XrayProtocol, profile.transport as XrayTransport, profile.path),
      sniHost: profile.sniHost, uuid: clientUuid, protocol: profile.protocol, transport: profile.transport,
      security: ['native', 'raw', 'kcp'].includes(profile.transport) ? 'none' : 'tls'
    };
    const encryptedLink = encryptConfig(encryptedPayload, masterSecret);
    const tokens = loadTokens();
    const newToken: ClientToken = {
      id: 'tok_' + crypto.randomUUID().slice(0, 8), token: finalToken, clientUuid,
      resellerId: user.id, resellerName: user.name,
      plan: String(plan || `${requestedGb} GO CYBER VIP`).trim().slice(0, 80),
      bandwidthGb: requestedGb, bandwidthUsedGb: 0, expiresAt: calculatedExpiresAt, days: daysRemaining,
      deviceLimit: clientLimit, deviceIds: [], allowedDeviceId: allowedDeviceId || undefined,
      customerNote, customerContact,
      connectionCount: 0, lastSeenAt: null, lastSeenIp: null,
      status: 'active', configurationId: profile.id, configurationName: profile.name,
      configurationSnapshot: publicProtocolConfig(profile),
      encryptedLink,
      directLink: buildDirectProtocolUrl({ token: finalToken, clientUuid } as any, profile),
      createdAt: new Date().toISOString()
    };
    tokens.unshift(newToken);
    saveTokens(tokens);
    const users = loadUsers();
    const currentUser = users.find(u => u.id === user.id);
    if (currentUser) {
      const prevCredits = currentUser.credits;
      if (user.role === 'RESELLER') currentUser.credits = Math.max(0, currentUser.credits - requestedGb);
      currentUser.totalTokensCreated = (currentUser.totalTokensCreated || 0) + 1;
      currentUser.totalBandwidthAllocatedGb = (currentUser.totalBandwidthAllocatedGb || 0) + requestedGb;
      saveUsers(users);

      logTransaction({
        resellerId: user.id,
        resellerName: user.name,
        type: 'TOKEN_CREATE',
        amountGb: requestedGb,
        balanceBefore: prevCredits,
        balanceAfter: currentUser.credits,
        note: `Création du token ${finalToken} (${requestedGb} Go)`
      });
    }
    res.status(201).json(safeClientToken(newToken));
  });

  // Batch / Bulk Token Generation for commercial vouchers & scratch cards
  app.post('/api/v1/admin/tokens/batch', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const count = Math.min(200, Math.max(1, Number(req.body?.count) || 5));
    const requestedGb = Math.max(1, Number(req.body?.bandwidthGb) || 50);
    const days = Math.max(1, Number(req.body?.days) || 30);
    const clientLimit = Math.max(1, Math.min(10, Math.floor(Number(req.body?.deviceLimit) || 2)));
    const voucherPrefix = (req.body?.voucherPrefix?.toString()?.trim() || 'VIP').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const plan = req.body?.plan?.toString()?.trim() || `${requestedGb} GO CYBER VIP`;
    const customerNotePrefix = req.body?.customerNotePrefix?.toString()?.trim() || '';

    const totalRequiredGb = requestedGb * count;

    if (user.role === 'RESELLER' && user.credits < totalRequiredGb) {
      res.status(400).json({
        error: `Crédits insuffisants pour ce lot ! Requis : ${totalRequiredGb} Go (${count} x ${requestedGb} Go). Votre solde : ${user.credits} Go.`
      });
      return;
    }

    const configs = loadProtocolConfigs();
    const configId = typeof req.body?.configurationId === 'string' ? req.body.configurationId.trim() : '';
    const profile = (configId ? configs.find(c => c.id === configId) : null) || configs[0] || legacyProtocolConfig();
    if (!profile) {
      res.status(400).json({ error: 'Aucun protocole de connexion configuré.' });
      return;
    }

    const masterSecret = process.env.MASTER_SECRET || loadMasterConfig().secretPassphrase;
    if (!masterSecret || masterSecret.length < 32) {
      res.status(503).json({ error: 'Le secret maître est absent ou invalide.' });
      return;
    }

    const calculatedExpiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    const daysRemaining = days;
    const tokens = loadTokens();
    const createdTokens: ClientToken[] = [];

    for (let i = 0; i < count; i++) {
      const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
      const finalToken = `ABESS-${voucherPrefix}-${randomSuffix}`;
      const clientUuid = crypto.randomUUID();

      const encryptedPayload = {
        vpnName: 'AbessVpn', token: finalToken, bandwidthGb: requestedGb,
        expiresAt: calculatedExpiresAt,
        configurationId: profile.id, configurationName: profile.name,
        serverHost: profile.serverHost, host: profile.host || profile.serverHost,
        serverPort: xrayPublicPort(profile.protocol, profile.transport, profile.serverPort),
        path: xrayProfilePath(profile.protocol as XrayProtocol, profile.transport as XrayTransport, profile.path),
        sniHost: profile.sniHost, uuid: clientUuid, protocol: profile.protocol, transport: profile.transport,
        security: ['native', 'raw', 'kcp'].includes(profile.transport) ? 'none' : 'tls'
      };
      const encryptedLink = encryptConfig(encryptedPayload, masterSecret);

      const newToken: ClientToken = {
        id: 'tok_' + crypto.randomUUID().slice(0, 8),
        token: finalToken,
        clientUuid,
        resellerId: user.id,
        resellerName: user.name,
        plan,
        bandwidthGb: requestedGb,
        bandwidthUsedGb: 0,
        expiresAt: calculatedExpiresAt,
        days: daysRemaining,
        deviceLimit: clientLimit,
        deviceIds: [],
        customerNote: customerNotePrefix ? `${customerNotePrefix} #${i + 1}` : undefined,
        connectionCount: 0,
        lastSeenAt: null,
        lastSeenIp: null,
        status: 'active',
        configurationId: profile.id,
        configurationName: profile.name,
        configurationSnapshot: publicProtocolConfig(profile),
        encryptedLink,
        directLink: buildDirectProtocolUrl({ token: finalToken, clientUuid } as any, profile),
        createdAt: new Date().toISOString()
      };

      createdTokens.push(newToken);
      tokens.unshift(newToken);
    }

    saveTokens(tokens);

    const users = loadUsers();
    const currentUser = users.find(u => u.id === user.id);
    if (currentUser) {
      const prevCredits = currentUser.credits;
      if (user.role === 'RESELLER') {
        currentUser.credits = Math.max(0, currentUser.credits - totalRequiredGb);
      }
      currentUser.totalTokensCreated = (currentUser.totalTokensCreated || 0) + count;
      currentUser.totalBandwidthAllocatedGb = (currentUser.totalBandwidthAllocatedGb || 0) + totalRequiredGb;
      saveUsers(users);

      logTransaction({
        resellerId: user.id,
        resellerName: user.name,
        type: 'BATCH_CREATE',
        amountGb: totalRequiredGb,
        balanceBefore: prevCredits,
        balanceAfter: currentUser.credits,
        note: `Création de lot de ${count} vouchers (${requestedGb} Go chacun)`
      });
    }

    res.status(201).json({
      success: true,
      count,
      totalBandwidthGb: totalRequiredGb,
      tokens: createdTokens.map(safeClientToken)
    });
  });

  // 1-Click Device Slot Reset for customers who replaced or wiped their phone
  app.post('/api/v1/admin/tokens/:id/reset-devices', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const tokens = loadTokens();
    const target = tokens.find(item => item.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Token introuvable.' });
      return;
    }
    if (user.role !== 'SUPER_ADMIN' && target.resellerId !== user.id) {
      res.status(403).json({ error: 'Vous ne pouvez réinitialiser que vos propres licences.' });
      return;
    }

    const previousCount = target.deviceIds ? target.deviceIds.length : 0;
    target.deviceIds = [];
    target.allowedDeviceId = undefined;
    saveTokens(tokens);

    logTransaction({
      resellerId: user.id,
      resellerName: user.name,
      type: 'RESET_DEVICES',
      amountGb: 0,
      balanceBefore: user.credits,
      balanceAfter: user.credits,
      note: `Réinitialisation des appareils pour le token ${target.token} (${previousCount} appareil(s) libéré(s))`
    });

    res.json({
      success: true,
      token: target.token,
      message: `Tous les appareils liés à la licence ${target.token} ont été réinitialisés avec succès.`
    });
  });

  // Transaction Ledger (Audit trail for recharges & token creation)
  app.get('/api/v1/admin/transactions', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const all = loadTransactions();
    if (user.role === 'SUPER_ADMIN') {
      res.json(all);
    } else {
      res.json(all.filter(t => t.resellerId === user.id));
    }
  });

  // 1-Click System Backup Export (Super Admin only)
  app.get('/api/v1/admin/backup', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }

    const backupData = {
      timestamp: new Date().toISOString(),
      version: '2.5.0-commercial',
      masterConfig: loadMasterConfig(),
      protocolConfigs: loadProtocolConfigs(),
      users: loadUsers().map(u => ({ ...u, passwordHash: u.passwordHash })),
      tokens: loadTokens(),
      transactions: loadTransactions()
    };

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="abessvpn-backup-${dateStr}.json"`);
    res.send(JSON.stringify(backupData, null, 2));
  });

  // System Backup Restore (Super Admin only)
  app.post('/api/v1/admin/backup/restore', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }

    const payload = req.body;
    if (!payload || !Array.isArray(payload.users) || !Array.isArray(payload.tokens)) {
      res.status(400).json({ error: 'Fichier de sauvegarde invalide (structure users/tokens manquante).' });
      return;
    }

    // Safety snapshot before restoring
    const safetyBackupPath = path.resolve(backupsDir, `pre-restore-${Date.now()}.json`);
    const currentSnapshot = {
      timestamp: new Date().toISOString(),
      masterConfig: loadMasterConfig(),
      protocolConfigs: loadProtocolConfigs(),
      users: loadUsers(),
      tokens: loadTokens(),
      transactions: loadTransactions()
    };
    writeJsonAtomically(safetyBackupPath, currentSnapshot);

    // Apply restore
    if (payload.masterConfig) saveMasterConfig(payload.masterConfig);
    if (Array.isArray(payload.protocolConfigs)) saveProtocolConfigs(payload.protocolConfigs);
    saveUsers(payload.users);
    saveTokens(payload.tokens);
    if (Array.isArray(payload.transactions)) writeJsonAtomically(transactionsFile, payload.transactions);

    res.json({
      success: true,
      message: 'Sauvegarde restaurée avec succès. Un instantané de sécurité a été créé.',
      usersCount: payload.users.length,
      tokensCount: payload.tokens.length
    });
  });

  // Suspend/reactivate a licence without deleting its audit history.
  app.put('/api/v1/admin/tokens/:id/status', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const requestedStatus = req.body?.status;
    if (requestedStatus !== 'active' && requestedStatus !== 'revoked') {
      res.status(400).json({ error: 'Le statut doit être active ou revoked.' });
      return;
    }
    const tokens = loadTokens();
    const target = tokens.find(item => item.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Token introuvable.' });
      return;
    }
    if (user.role !== 'SUPER_ADMIN' && target.resellerId !== user.id) {
      res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres licences.' });
      return;
    }
    if (requestedStatus === 'active') {
      const expiry = new Date(target.expiresAt).getTime();
      if (!Number.isFinite(expiry) || expiry <= Date.now()) {
        res.status(409).json({ error: 'Cette licence est expirée et ne peut pas être réactivée.' });
        return;
      }
      if (Number(target.bandwidthUsedGb) >= Number(target.bandwidthGb)) {
        res.status(409).json({ error: 'Le quota de cette licence est épuisé et ne peut pas être réactivé.' });
        return;
      }
    }
    target.status = requestedStatus;
    saveTokens(tokens);
    res.json({ success: true, token: safeClientToken(target) });
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

  // Named protocol configurations: only the Super Administrator can create, edit or delete them.
  // The selector endpoint exposes labels only; reseller accounts never receive Host/IP/SNI values.
  app.get('/api/v1/admin/available-configs', authenticate, (_req, res) => {
    res.json(loadProtocolConfigs().map(({ id, name, protocol, transport, serverPort }) => ({ id, name, protocol, transport, serverPort })));
  });
  app.get('/api/v1/admin/protocol-configs', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Seul le Super Administrateur peut consulter les paramètres Host/SNI/IP.' });
      return;
    }
    res.json(loadProtocolConfigs().map(publicProtocolConfig));
  });
  app.post('/api/v1/admin/protocol-configs', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Seul le Super Administrateur peut créer une configuration.' });
      return;
    }
    const configs = loadProtocolConfigs();
    const sniError = tlsSniValidationError(
      String(req.body?.transport ?? 'ws').toLowerCase(),
      req.body?.sniHost
    );
    if (sniError) {
      res.status(400).json({ error: sniError });
      return;
    }
    const created = normalizeProtocolConfig(req.body);
    if (!created) {
      res.status(400).json({ error: 'Configuration invalide : nom (2–80 caractères), destination, Host facultatif et combinaison protocole/transport compatibles requis.' });
      return;
    }
    if (configs.some(config => config.name.toLowerCase() === created.name.toLowerCase())) {
      res.status(409).json({ error: 'Une configuration porte déjà ce nom.' });
      return;
    }
    configs.push(created);
    saveProtocolConfigs(configs);
    syncXrayConfig();
    res.status(201).json({ success: true, config: publicProtocolConfig(created), configs: configs.map(publicProtocolConfig) });
  });
  app.put('/api/v1/admin/protocol-configs/:id', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Seul le Super Administrateur peut modifier une configuration.' });
      return;
    }
    const configs = loadProtocolConfigs();
    const index = configs.findIndex(config => config.id === req.params.id);
    if (index < 0) {
      res.status(404).json({ error: 'Configuration introuvable.' });
      return;
    }
    const sniError = tlsSniValidationError(
      String(req.body?.transport ?? configs[index].transport).toLowerCase(),
      req.body?.sniHost ?? configs[index].sniHost
    );
    if (sniError) {
      res.status(400).json({ error: sniError });
      return;
    }
    const updated = normalizeProtocolConfig(req.body, configs[index]);
    if (!updated) {
      res.status(400).json({ error: 'Configuration invalide : vérifiez le nom, la destination, le Host, le protocole et le transport.' });
      return;
    }
    if (configs.some((config, idx) => idx !== index && config.name.toLowerCase() === updated.name.toLowerCase())) {
      res.status(409).json({ error: 'Une autre configuration porte déjà ce nom.' });
      return;
    }
    configs[index] = updated;
    saveProtocolConfigs(configs);
    syncXrayConfig();
    res.json({ success: true, config: publicProtocolConfig(updated), configs: configs.map(publicProtocolConfig) });
  });
  app.delete('/api/v1/admin/protocol-configs/:id', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Seul le Super Administrateur peut supprimer une configuration.' });
      return;
    }
    const configs = loadProtocolConfigs();
    if (!configs.some(config => config.id === req.params.id)) {
      res.status(404).json({ error: 'Configuration introuvable.' });
      return;
    }
    const tokens = loadTokens();
    const assigned = tokens.some(token =>
      token.configurationId === req.params.id || token.configurationSnapshot?.id === req.params.id ||
      (!token.configurationId && !token.configurationSnapshot && req.params.id === 'cfg_legacy')
    );
    if (assigned) {
      res.status(409).json({ error: 'Cette configuration est encore associée à des licences. Révoquez ou supprimez ces licences avant de supprimer la configuration.' });
      return;
    }
    const remaining = configs.filter(config => config.id !== req.params.id);
    saveProtocolConfigs(remaining);
    syncXrayConfig(tokens);
    res.json({ success: true, configs: remaining.map(publicProtocolConfig) });
  });

  app.put('/api/v1/admin/server-config', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'ACCÈS REFUSÉ : Seul le Super Administrateur peut modifier l\'infrastructure.' });
      return;
    }

    const current = loadMasterConfig();
    const requestedProtocol = req.body?.protocol ?? current.protocol;
    const requestedTransport = req.body?.transport ?? current.transport;
    if (
      !isXrayProtocol(requestedProtocol) ||
      !isXrayTransport(requestedTransport) ||
      (requestedTransport === 'native' && requestedProtocol !== 'shadowsocks') ||
      (requestedProtocol === 'shadowsocks' && requestedTransport !== 'native') ||
      ((requestedTransport === 'raw' || requestedTransport === 'kcp') && requestedProtocol !== 'vmess')
    ) {
      res.status(400).json({
        success: false,
        error: 'VLESS, VMess et Trojan sont disponibles en WS/gRPC/HTTPUpgrade/XHTTP. VMess prend aussi en charge RAW/TCP et mKCP/UDP ; Shadowsocks doit utiliser le transport natif TCP + UDP.'
      });
      return;
    }
    const requestedHost = typeof req.body?.serverHost === 'string' ? req.body.serverHost.trim() : current.serverHost;
    const requestedHeaderHost = typeof req.body?.host === 'string' ? req.body.host.trim() : current.host;
    const requestedSni = typeof req.body?.sniHost === 'string' ? req.body.sniHost.trim() : current.sniHost;
    const sniError = tlsSniValidationError(String(requestedTransport), requestedSni);
    const invalidNonTlsSni = !isTlsWebTransport(String(requestedTransport)) &&
      requestedSni !== '' && !isValidPublicHost(requestedSni);
    if (
      !isValidPublicHost(requestedHost) ||
      (requestedHeaderHost !== '' && !isValidPublicHost(requestedHeaderHost)) ||
      sniError !== null ||
      invalidNonTlsSni
    ) {
      res.status(400).json({
        success: false,
        error: sniError || 'Renseignez une adresse de serveur valide. Le Host HTTP est facultatif et reste distinct du SNI; si vous le renseignez, indiquez un nom DNS ou une IPv4 sans protocole, port ni chemin.'
      });
      return;
    }
    const effectivePort = requestedTransport === 'native' ? 10050
      : requestedTransport === 'raw' ? 10060
      : requestedTransport === 'kcp' ? 10061
      : 443;
    const updated: MasterServerConfig = {
      ...current,
      ...req.body,
      serverHost: requestedHost,
      host: requestedHeaderHost,
      sniHost: requestedSni,
      serverPort: effectivePort,
      protocol: requestedProtocol,
      transport: requestedTransport,
      path: '/@abess237',
      secretPassphrase: process.env.MASTER_SECRET || current.secretPassphrase
    };
    saveMasterConfig(updated);
    syncXrayConfig();
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
  // APP VERSION & MANDATORY UPDATE MANAGEMENT
  // ==========================================
  app.get('/api/v1/admin/app-version', authenticate, (_req, res) => {
    res.json(loadAppVersionConfig());
  });

  app.post('/api/v1/admin/app-version', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }
    const latestVersion = String(req.body?.latestVersion || '').trim();
    if (!latestVersion) {
      res.status(400).json({ error: 'latestVersion requis (ex: 2.1.0).' });
      return;
    }
    const minRequiredVersion = String(req.body?.minRequiredVersion || latestVersion).trim();
    const isMandatory = Boolean(req.body?.isMandatory);
    const downloadUrl = String(req.body?.downloadUrl || 'https://t.me/Abess_Vpn').trim();
    const releaseNotes = String(req.body?.releaseNotes || '').trim();

    const config: AppVersionConfig = {
      latestVersion,
      minRequiredVersion,
      isMandatory,
      downloadUrl,
      releaseNotes,
      publishedAt: new Date().toISOString()
    };
    saveAppVersionConfig(config);

    logTransaction({
      resellerId: user.id,
      resellerName: user.name,
      type: 'APP_VERSION_UPDATE',
      amountGb: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      note: `Publication version ${latestVersion} (Obligatoire: ${isMandatory ? 'OUI' : 'NON'})`
    });

    res.json({ ok: true, config });
  });

  // ==========================================
  // ANNOUNCEMENTS MANAGEMENT (ADMIN)
  // ==========================================
  app.get('/api/v1/admin/announcements', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }
    const announcements = loadAnnouncements();
    res.json({ ok: true, announcements });
  });

  app.post('/api/v1/admin/announcements', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }

    const title = String(req.body?.title || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!title || !message) {
      res.status(400).json({ error: 'Titre et message requis pour publier une annonce.' });
      return;
    }

    const type = ['INFO', 'WARNING', 'CRITICAL', 'PROMO', 'UPDATE'].includes(req.body?.type)
      ? req.body.type
      : 'INFO';

    const targetPlatform = ['ALL', 'ANDROID', 'WINDOWS'].includes(req.body?.targetPlatform)
      ? req.body.targetPlatform
      : 'ALL';

    const isMandatory = Boolean(req.body?.isMandatory);
    const dismissible = req.body?.dismissible !== undefined ? Boolean(req.body?.dismissible) : !isMandatory;
    const actionButtonText = req.body?.actionButtonText ? String(req.body.actionButtonText).trim() : undefined;
    const actionButtonUrl = req.body?.actionButtonUrl ? String(req.body.actionButtonUrl).trim() : undefined;
    const bannerImageUrl = req.body?.bannerImageUrl ? String(req.body.bannerImageUrl).trim() : undefined;
    const expiresAt = req.body?.expiresAt ? String(req.body.expiresAt).trim() : undefined;
    const priority = Number(req.body?.priority || 0);
    const showMode = req.body?.showMode === 'EVERY_LAUNCH' ? 'EVERY_LAUNCH' : 'ONCE_PER_USER';

    const newAnnouncement: Announcement = {
      id: `ann-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title,
      message,
      type,
      targetPlatform,
      isMandatory,
      dismissible,
      actionButtonText,
      actionButtonUrl,
      bannerImageUrl,
      publishedAt: new Date().toISOString(),
      expiresAt,
      isActive: true,
      priority,
      showMode,
      createdBy: user.name || user.id
    };

    const announcements = loadAnnouncements();
    announcements.unshift(newAnnouncement);
    saveAnnouncements(announcements);

    logTransaction({
      resellerId: user.id,
      resellerName: user.name,
      type: 'ANNOUNCEMENT_PUBLISH',
      amountGb: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      note: `Publication annonce "${title}" [${type}] pour ${targetPlatform}`
    });

    res.json({ ok: true, announcement: newAnnouncement });
  });

  app.put('/api/v1/admin/announcements/:id', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }

    const { id } = req.params;
    const announcements = loadAnnouncements();
    const idx = announcements.findIndex(a => a.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Annonce introuvable.' });
      return;
    }

    const existing = announcements[idx];
    announcements[idx] = {
      ...existing,
      title: req.body?.title !== undefined ? String(req.body.title).trim() : existing.title,
      message: req.body?.message !== undefined ? String(req.body.message).trim() : existing.message,
      type: req.body?.type || existing.type,
      targetPlatform: req.body?.targetPlatform || existing.targetPlatform,
      isMandatory: req.body?.isMandatory !== undefined ? Boolean(req.body.isMandatory) : existing.isMandatory,
      dismissible: req.body?.dismissible !== undefined ? Boolean(req.body.dismissible) : existing.dismissible,
      actionButtonText: req.body?.actionButtonText !== undefined ? String(req.body.actionButtonText).trim() : existing.actionButtonText,
      actionButtonUrl: req.body?.actionButtonUrl !== undefined ? String(req.body.actionButtonUrl).trim() : existing.actionButtonUrl,
      bannerImageUrl: req.body?.bannerImageUrl !== undefined ? String(req.body.bannerImageUrl).trim() : existing.bannerImageUrl,
      isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : existing.isActive,
      priority: req.body?.priority !== undefined ? Number(req.body.priority) : existing.priority,
      showMode: req.body?.showMode || existing.showMode,
      expiresAt: req.body?.expiresAt !== undefined ? String(req.body.expiresAt).trim() : existing.expiresAt
    };

    saveAnnouncements(announcements);
    res.json({ ok: true, announcement: announcements[idx] });
  });

  app.delete('/api/v1/admin/announcements/:id', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }

    const { id } = req.params;
    let announcements = loadAnnouncements();
    announcements = announcements.filter(a => a.id !== id);
    saveAnnouncements(announcements);

    res.json({ ok: true });
  });

  // ==========================================
  // SERVER AUTOMATED UPDATE & HEALTH
  // ==========================================
  app.get('/api/v1/admin/system/update-status', authenticate, async (_req, res) => {
    const status = await getServerUpdateStatus();
    res.json(status);
  });

  app.post('/api/v1/admin/system/update', authenticate, async (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }
    const result = await executeServerUpdate();
    res.json(result);
  });

  // ==========================================
  // 6. CLIENT MOBILE APPLICATION AUTHENTICATION
  // (Called by flutter_v2ray on Android/iOS)
  // ==========================================
  const validateMobileToken = (
    req: express.Request,
    res: express.Response,
    rawTokenInput: unknown,
    deviceIdInput: unknown
  ) => {
    const rawToken = rawTokenInput == null ? '' : String(rawTokenInput).trim();
    const deviceId = deviceIdInput == null ? '' : String(deviceIdInput).trim();

    if (!rawToken) {
      res.status(400).json({ valid: false, error: 'Token manquant' });
      return;
    }
    if (!deviceId || deviceId.length > 128 || deviceId.includes('\r') || deviceId.includes('\n') || deviceId.includes('\0')) {
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

    const pinnedDeviceId = typeof found.allowedDeviceId === 'string' ? found.allowedDeviceId.trim() : '';
    if (pinnedDeviceId && pinnedDeviceId !== deviceId) {
      res.status(403).json({
        valid: false,
        error: 'Cette licence est liée à une autre installation ABESS. Demandez une licence associée à l’ID de ce téléphone.',
        status: 'device_id_mismatch'
      });
      return;
    }

    const now = Date.now();
    const profile = protocolConfigForToken(found, loadProtocolConfigs());
    const profileSniError = profile
      ? tlsSniValidationError(profile.transport, profile.sniHost)
      : null;
    if (!profile || !isValidPublicHost(profile.serverHost) || profileSniError) {
      res.status(503).json({
        valid: false,
        error: profileSniError || 'La configuration VPN associée à cette licence est indisponible. Contactez le Super Administrateur.'
      });
      return;
    }
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
      configurationId: profile.id,
      configurationName: profile.name,
      serverConfig: {
        address: profile.serverHost,
        port: xrayPublicPort(profile.protocol, profile.transport, profile.serverPort),
        path: xrayProfilePath(profile.protocol as XrayProtocol, profile.transport as XrayTransport, profile.path),
        uuid: found.clientUuid || crypto.randomUUID(),
        sni: profile.sniHost,
        host: profile.host || profile.serverHost,
        wsHost: profile.host || profile.serverHost,
        method: profile.protocol === 'shadowsocks' ? 'aes-128-gcm' : undefined,
        protocol: profile.protocol,
        transport: profile.transport,
        security: ['native', 'raw', 'kcp'].includes(profile.transport) ? 'none' : 'tls',
        allowedDeviceId: found.allowedDeviceId || undefined
      }
    });
  };

  app.post('/api/v1/auth/token', (req, res) => {
    validateMobileToken(req, res, req.body?.token, req.body?.deviceId);
  });

  // Decrypt panel-issued links on the server; the master secret never enters the mobile app.
  // Continue through the same expiry, quota, status, and device-limit validation as a typed token.
  app.post('/api/v1/auth/import-link', (req, res) => {
    const link = req.body?.link?.toString()?.trim();
    if (!link || !link.startsWith('abess://')) {
      res.status(400).json({ valid: false, error: 'Lien ABESS chiffré manquant ou invalide.' });
      return;
    }

    try {
      const linkPayload = link.slice('abess://'.length);
      const masterConfig = loadMasterConfig();
      const key = crypto.createHash('sha256').update(masterConfig.secretPassphrase).digest();
      let plaintext: string;

      if (linkPayload.startsWith('v2.')) {
        // New links use AES-256-GCM with authentication; altered links fail closed.
        const parts = linkPayload.split('.');
        if (parts.length !== 4) throw new Error('Invalid v2 payload');
        const iv = Buffer.from(parts[1], 'base64url');
        const tag = Buffer.from(parts[2], 'base64url');
        const ciphertext = Buffer.from(parts[3], 'base64url');
        if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error('Invalid v2 fields');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } else {
        // Backward compatibility: existing AES-CBC links continue to import.
        const separator = linkPayload.indexOf('.');
        if (separator <= 0 || separator === linkPayload.length - 1) throw new Error('Invalid legacy payload');
        const iv = Buffer.from(linkPayload.slice(0, separator), 'base64');
        const ciphertext = linkPayload.slice(separator + 1);
        if (iv.length !== 16 || !ciphertext) throw new Error('Invalid legacy IV or ciphertext');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        plaintext = decipher.update(ciphertext, 'base64', 'utf8') + decipher.final('utf8');
      }

      const decoded = JSON.parse(plaintext) as { token?: unknown };
      if (typeof decoded.token !== 'string' || !decoded.token.trim()) throw new Error('Missing token in encrypted payload');
      validateMobileToken(req, res, decoded.token, req.body?.deviceId);
    } catch {
      res.status(400).json({ valid: false, error: 'Lien ABESS invalide ou impossible à déchiffrer.' });
    }
  });

  // ==========================================
  // 6. UNIVERSAL SUBSCRIPTION PORTAL (/sub/:token)
  // Dual-mode: Interactive HTML for browsers & Base64 for VPN clients
  // ==========================================
  app.get(['/sub/:token', '/nexus/sub/:token', '/api/v1/sub/:token'], async (req, res) => {
    const rawToken = String(req.params.token || '').trim();
    if (!rawToken) {
      res.status(400).send('Jeton requis.');
      return;
    }
    const tokens = loadTokens();
    const matched = tokens.find(t =>
      t.token.toUpperCase() === rawToken.toUpperCase() ||
      (t.clientUuid && t.clientUuid.toLowerCase() === rawToken.toLowerCase()) ||
      t.id === rawToken
    );
    if (!matched) {
      res.status(404).send('Abonnement introuvable.');
      return;
    }

    const acceptHdr = String(req.headers['accept'] || '').toLowerCase();
    const uaHdr = String(req.headers['user-agent'] || '').toLowerCase();
    const vpnKeywords = [
      'v2ray', 'xray', 'clash', 'hiddify', 'sing-box', 'singbox',
      'streisand', 'shadowrocket', 'v2box', 'nekobox', 'nekoray',
      'darktunnel', 'httpcustom', 'matsuri', 'karing', 'flclash',
      'curl', 'wget', 'python', 'okhttp', 'go-http-client'
    ];
    const isBrowser =
      acceptHdr.includes('text/html') &&
      uaHdr.includes('mozilla') &&
      !vpnKeywords.some(k => uaHdr.includes(k)) &&
      req.query.raw !== '1';

    const protocolConfigs = loadProtocolConfigs();
    const profile = protocolConfigForToken(matched, protocolConfigs);
    const variants = generateUserVlessVariants(matched, profile || undefined);

    if (isBrowser) {
      const subTemplatePath = path.resolve(templatesDir, 'sub.html');
      if (fs.existsSync(subTemplatePath)) {
        let html = fs.readFileSync(subTemplatePath, 'utf8');
        const browserVariants: VlessVariant[] = [];
        for (const v of variants) {
          let qr = '';
          try {
            qr = await QRCode.toDataURL(v.uri, { margin: 1, width: 280 });
          } catch {}
          browserVariants.push({ ...v, qrCode: qr });
        }

        const primaryUri = browserVariants[0]?.uri || '';
        const primaryQr = browserVariants[0]?.qrCode || '';
        const master = loadMasterConfig();
        const panelTitle = master.systemName || 'AbessVpn Cyber Commercial';
        const userName = matched.customerNote || matched.token;
        const subData = {
          user: {
            id: matched.id,
            token: matched.token,
            uuid: matched.clientUuid || matched.token,
            name: userName,
            plan: matched.plan,
            quota_bytes: Math.round(matched.bandwidthGb * 1024 * 1024 * 1024),
            used_bytes_up: Math.round(matched.bandwidthUsedGb * 0.25 * 1024 * 1024 * 1024),
            used_bytes_down: Math.round(matched.bandwidthUsedGb * 0.75 * 1024 * 1024 * 1024),
            expires_at: matched.expiresAt,
            status: matched.status,
            is_valid: matched.status === 'active' && new Date(matched.expiresAt).getTime() > Date.now() && matched.bandwidthUsedGb < matched.bandwidthGb
          },
          variants: browserVariants,
          sub_path: `/sub/${matched.token}`,
          support_phone: matched.customerContact || '+237690123456'
        };

        html = html.replace(/\{\{USER_NAME\}\}/g, userName);
        html = html.replace(/\{\{USER_TOKEN\}\}/g, matched.token);
        html = html.replace(/\{\{PANEL_TITLE\}\}/g, panelTitle);
        html = html.replace(/\{\{VLESS_URI\}\}/g, primaryUri);
        html = html.replace(/\{\{QR_CODE\}\}/g, primaryQr);
        html = html.replace(/\{\{SUB_DATA_JSON\}\}/g, JSON.stringify(subData));

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
        return;
      }
    }

    // Raw VPN Subscription Response
    const isExpired = Number.isFinite(new Date(matched.expiresAt).getTime()) && new Date(matched.expiresAt).getTime() <= Date.now();
    const isExceeded = Number(matched.bandwidthUsedGb) >= Number(matched.bandwidthGb);
    if (matched.status !== 'active' || isExpired || isExceeded) {
      res.status(403).send('Compte inactif, expiré ou quota dépassé.');
      return;
    }

    const rawUris = variants.map(v => v.uri).join('\n');
    const b64Sub = Buffer.from(rawUris, 'utf8').toString('base64');

    const totalQuotaBytes = Math.round(matched.bandwidthGb * 1024 * 1024 * 1024);
    const usedUpBytes = Math.round(matched.bandwidthUsedGb * 0.25 * 1024 * 1024 * 1024);
    const usedDownBytes = Math.round(matched.bandwidthUsedGb * 0.75 * 1024 * 1024 * 1024);
    const expTs = Math.floor(new Date(matched.expiresAt).getTime() / 1000) || 0;
    const titleB64 = Buffer.from(`AbessVpn - ${matched.token}`).toString('base64');

    res.setHeader('Subscription-Userinfo', `upload=${usedUpBytes}; download=${usedDownBytes}; total=${totalQuotaBytes}; expire=${expTs}`);
    res.setHeader('Profile-Update-Interval', '12');
    res.setHeader('Profile-Title', `base64:${titleB64}`);
    res.setHeader('Content-Disposition', `inline; filename="${matched.token}.txt"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(b64Sub);
  });

  // ==========================================
  // 7. APP DOWNLOAD & WEB PORTAL
  // ==========================================
  app.get(['/app', '/nexus/app', '/nexus/app/'], (_req, res) => {
    const appHtmlPath = path.resolve(templatesDir, 'app.html');
    if (fs.existsSync(appHtmlPath)) {
      let html = fs.readFileSync(appHtmlPath, 'utf8');
      const version = loadAppVersionConfig();
      html = html.replace(/\{\{PANEL_TITLE\}\}/g, 'AbessVpn Cyber Commercial');
      html = html.replace(/\{\{LATEST_VERSION\}\}/g, version.latestVersion);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } else {
      res.send('Page de téléchargement de l\'application.');
    }
  });

  app.get(['/download/:filename', '/nexus/download/:filename'], (req, res) => {
    const requested = path.basename(req.params.filename);
    const filePath = path.resolve(staticDir, requested);
    if (fs.existsSync(filePath)) {
      res.download(filePath, requested);
    } else {
      res.status(404).send('Fichier introuvable.');
    }
  });

  app.get(['/api/download/info', '/api/v1/download/info'], (_req, res) => {
    const version = loadAppVersionConfig();
    const apkPath = path.resolve(staticDir, 'AbessVpn.apk');
    let sizeBytes = 0;
    if (fs.existsSync(apkPath)) {
      try { sizeBytes = fs.statSync(apkPath).size; } catch {}
    }
    res.json({
      ok: true,
      filename: 'AbessVpn.apk',
      version: version.latestVersion,
      sizeBytes,
      sizeFormatted: sizeBytes > 0 ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} Mo` : '20 Mo',
      downloadUrl: '/download/AbessVpn.apk',
      checksum: 'sha256-verified-release',
      publishedAt: version.publishedAt
    });
  });

  app.get(['/api/time', '/api/v1/time'], (_req, res) => {
    res.json({
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      server_time: new Date().toLocaleString()
    });
  });

  app.get(['/api/countries', '/api/v1/countries'], (_req, res) => {
    res.json(loadAfricanCountries());
  });

  // ==========================================
  // 8. PRICING PLANS CRUD
  // ==========================================
  app.get(['/api/plans', '/api/v1/plans'], (_req, res) => {
    const plans = loadPlans();
    const tokens = loadTokens();
    const enriched = plans.map(p => ({
      ...p,
      activeUsersCount: tokens.filter(t => t.plan === p.name && t.status === 'active').length
    }));
    res.json(enriched);
  });

  app.post(['/api/plans', '/api/v1/admin/plans'], authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Seul le Super Administrateur peut créer des forfaits.' });
      return;
    }
    const { name, quotaGb, durationDays, priceCfa, badge, description } = req.body;
    if (!name || Number(quotaGb) < 0 || Number(durationDays) <= 0) {
      res.status(400).json({ error: 'Nom, quota en Go et durée en jours requis.' });
      return;
    }
    const plans = loadPlans();
    const newPlan: PricingPlan = {
      id: `plan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: String(name).trim(),
      quotaGb: Number(quotaGb),
      durationDays: Number(durationDays),
      priceCfa: Number(priceCfa || 0),
      badge: badge ? String(badge).trim() : undefined,
      description: description ? String(description).trim() : undefined
    };
    plans.push(newPlan);
    savePlans(plans);
    logAudit({
      actor: user.name,
      role: user.role,
      action: 'PLAN_CREATE',
      details: `Création du forfait ${newPlan.name} (${newPlan.quotaGb} Go / ${newPlan.durationDays}j)`
    });
    res.json({ ok: true, plan: newPlan });
  });

  app.put(['/api/plans/:id', '/api/v1/admin/plans/:id'], authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Seul le Super Administrateur peut modifier des forfaits.' });
      return;
    }
    const plans = loadPlans();
    const plan = plans.find(p => p.id === req.params.id);
    if (!plan) {
      res.status(404).json({ error: 'Forfait introuvable.' });
      return;
    }
    const { name, quotaGb, durationDays, priceCfa, badge, description } = req.body;
    if (name) plan.name = String(name).trim();
    if (quotaGb !== undefined) plan.quotaGb = Number(quotaGb);
    if (durationDays !== undefined) plan.durationDays = Number(durationDays);
    if (priceCfa !== undefined) plan.priceCfa = Number(priceCfa);
    if (badge !== undefined) plan.badge = String(badge).trim();
    if (description !== undefined) plan.description = String(description).trim();
    savePlans(plans);
    logAudit({
      actor: user.name,
      role: user.role,
      action: 'PLAN_UPDATE',
      details: `Mise à jour du forfait ${plan.name}`
    });
    res.json({ ok: true, plan });
  });

  app.delete(['/api/plans/:id', '/api/v1/admin/plans/:id'], authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Seul le Super Administrateur peut supprimer des forfaits.' });
      return;
    }
    const plans = loadPlans();
    const updated = plans.filter(p => p.id !== req.params.id);
    savePlans(updated);
    logAudit({
      actor: user.name,
      role: user.role,
      action: 'PLAN_DELETE',
      details: `Suppression du forfait ${req.params.id}`
    });
    res.json({ ok: true });
  });

  // ==========================================
  // 9. ONBOARDING & MEMBERSHIP REQUESTS
  // ==========================================
  app.post(['/api/membership/request', '/api/v1/membership/request'], (req, res) => {
    const { firstName, lastName, countryCode, channel, contactDetail, deviceId, deviceModel, deviceOs, planId, paymentMethod, paymentRef } = req.body;
    if (!firstName || !lastName || !contactDetail) {
      res.status(400).json({ error: 'Prénom, nom et contact requis.' });
      return;
    }
    const countries = loadAfricanCountries();
    const cCode = String(countryCode || 'CM').toUpperCase();
    const country = countries.find((c: any) => c.code === cCode) || countries[0];
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';

    const plans = loadPlans();
    const plan = plans.find(p => p.id === planId) || plans[0];

    const requests = loadRequests();
    const existing = requests.find(r => r.deviceId && r.deviceId === deviceId && r.status === 'PENDING');
    if (existing) {
      existing.firstName = String(firstName).trim();
      existing.lastName = String(lastName).trim();
      existing.fullName = `${existing.firstName} ${existing.lastName}`;
      existing.channel = channel === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP';
      existing.contactDetail = String(contactDetail).trim();
      existing.planId = plan?.id;
      existing.planName = plan?.name;
      existing.paymentMethod = paymentMethod;
      existing.paymentRef = paymentRef;
      existing.submittedAt = new Date().toISOString();
      saveRequests(requests);
      res.json({ status: 'pending', request: existing, message: 'Demande mise à jour et en attente d\'approbation.' });
      return;
    }

    const newReq: MembershipRequest = {
      id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      fullName: `${String(firstName).trim()} ${String(lastName).trim()}`,
      countryCode: country.code,
      countryName: country.name,
      flag: country.flag,
      dialPrefix: country.dial,
      channel: channel === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP',
      contactDetail: String(contactDetail).trim(),
      deviceId: deviceId ? String(deviceId).trim() : undefined,
      deviceModel: deviceModel ? String(deviceModel).trim() : undefined,
      deviceOs: deviceOs ? String(deviceOs).trim() : undefined,
      ipAddress: clientIp,
      planId: plan?.id,
      planName: plan?.name,
      paymentMethod: paymentMethod || 'ORANGE_MONEY',
      paymentRef: paymentRef ? String(paymentRef).trim() : undefined,
      status: 'PENDING',
      submittedAt: new Date().toISOString()
    };
    requests.push(newReq);
    saveRequests(requests);
    res.json({ status: 'pending', request: newReq, message: 'Demande enregistrée avec succès. Vous recevrez un accès dès validation.' });
  });

  app.get(['/api/membership/status', '/api/v1/membership/status'], (req, res) => {
    const deviceId = req.query.device_id ? String(req.query.device_id).trim() : '';
    const requestId = req.query.request_id ? String(req.query.request_id).trim() : '';
    const requests = loadRequests();
    const reqFound = requests.find(r => (requestId && r.id === requestId) || (deviceId && r.deviceId === deviceId));
    if (!reqFound) {
      res.status(404).json({ status: 'not_found', message: 'Aucune demande trouvée pour cet appareil.' });
      return;
    }
    if (reqFound.status === 'APPROVED' && reqFound.assignedToken) {
      const tokens = loadTokens();
      const token = tokens.find(t => t.token === reqFound.assignedToken);
      res.json({
        status: 'approved',
        token: reqFound.assignedToken,
        clientUuid: token?.clientUuid,
        expiresAt: token?.expiresAt,
        bandwidthGb: token?.bandwidthGb,
        downloadUrl: '/download/AbessVpn.apk',
        subUrl: `/sub/${reqFound.assignedToken}`
      });
      return;
    }
    res.json({
      status: reqFound.status.toLowerCase(),
      request: reqFound,
      message: reqFound.status === 'PENDING' ? 'Demande en cours d\'examen par un administrateur.' : 'Demande rejetée.'
    });
  });

  function generateTokenCode(): string {
    const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ABESS-${p1}-${p2}`;
  }

  app.get(['/api/admin/requests', '/api/v1/admin/requests'], authenticate, (_req, res) => {
    res.json(loadRequests());
  });

  app.post(['/api/admin/requests/:id/approve', '/api/v1/admin/requests/:id/approve'], authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const requests = loadRequests();
    const reqItem = requests.find(r => r.id === req.params.id);
    if (!reqItem) {
      res.status(404).json({ error: 'Demande introuvable.' });
      return;
    }
    const plans = loadPlans();
    const selectedPlan = plans.find(p => p.id === (req.body?.planId || reqItem.planId)) || plans[1] || plans[0];

    const tokens = loadTokens();
    const tokenStr = generateTokenCode();
    const uuid = crypto.randomUUID();
    const days = selectedPlan.durationDays;
    const bandwidthGb = selectedPlan.quotaGb;
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

    const masterConfig = loadMasterConfig();
    const protocolConfigs = loadProtocolConfigs();
    const profile = protocolConfigs[0];

    const dummyToken: ClientToken = {
      id: 'tok_' + crypto.randomUUID(),
      token: tokenStr,
      clientUuid: uuid,
      resellerId: user.id,
      resellerName: user.name,
      plan: selectedPlan.name,
      bandwidthGb,
      bandwidthUsedGb: 0,
      expiresAt,
      days,
      deviceLimit: 1,
      deviceIds: reqItem.deviceId ? [reqItem.deviceId] : [],
      allowedDeviceId: reqItem.deviceId,
      connectionCount: 0,
      lastSeenAt: null,
      lastSeenIp: null,
      status: 'active',
      configurationId: profile?.id,
      configurationName: profile?.name,
      configurationSnapshot: profile,
      customerNote: reqItem.fullName,
      customerContact: reqItem.contactDetail,
      encryptedLink: '',
      createdAt: new Date().toISOString()
    };
    dummyToken.encryptedLink = encryptConfig({ token: tokenStr, v: 2 }, masterConfig.secretPassphrase);
    dummyToken.directLink = profile ? buildDirectProtocolUrl(dummyToken, profile) : undefined;

    tokens.push(dummyToken);
    saveTokens(tokens);

    reqItem.status = 'APPROVED';
    reqItem.assignedTokenId = dummyToken.id;
    reqItem.assignedToken = tokenStr;
    reqItem.processedAt = new Date().toISOString();
    saveRequests(requests);

    logAudit({
      actor: user.name,
      role: user.role,
      action: 'REQUEST_APPROVE',
      details: `Approbation de la demande de ${reqItem.fullName} -> Token ${tokenStr} (${selectedPlan.name})`
    });

    res.json({ ok: true, status: 'approved', token: dummyToken });
  });

  app.post(['/api/admin/requests/:id/reject', '/api/v1/admin/requests/:id/reject'], authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const requests = loadRequests();
    const reqItem = requests.find(r => r.id === req.params.id);
    if (!reqItem) {
      res.status(404).json({ error: 'Demande introuvable.' });
      return;
    }
    reqItem.status = 'REJECTED';
    reqItem.rejectionReason = String(req.body?.reason || 'Demande non validée').trim();
    reqItem.processedAt = new Date().toISOString();
    saveRequests(requests);

    logAudit({
      actor: user.name,
      role: user.role,
      action: 'REQUEST_REJECT',
      details: `Rejet de la demande de ${reqItem.fullName} : ${reqItem.rejectionReason}`
    });

    res.json({ ok: true, status: 'rejected' });
  });

  app.delete(['/api/admin/requests/:id', '/api/v1/admin/requests/:id'], authenticate, (req, res) => {
    const requests = loadRequests();
    const updated = requests.filter(r => r.id !== req.params.id);
    saveRequests(updated);
    res.json({ ok: true });
  });

  // ==========================================
  // 10. VPN TELEMETRY & HEARTBEAT ENGINE
  // ==========================================
  app.post(['/api/vpn/heartbeat', '/api/traffic/heartbeat', '/api/v1/vpn/heartbeat'], (req, res) => {
    const { token: reqToken, uuid: reqUuid, device_id: deviceId, bytes_up = 0, bytes_down = 0, bytes_delta = 0, client_ip, device_model, os_version } = req.body || {};
    const tokens = loadTokens();
    const cleanTok = String(reqToken || '').trim().toUpperCase();
    const cleanUuid = String(reqUuid || '').trim().toLowerCase();
    const cleanDev = String(deviceId || '').trim();

    let matched = tokens.find(t =>
      (cleanTok && t.token.toUpperCase() === cleanTok) ||
      (cleanUuid && (t.clientUuid || '').toLowerCase() === cleanUuid) ||
      (cleanDev && Array.isArray(t.deviceIds) && t.deviceIds.includes(cleanDev))
    );

    if (!matched) {
      res.json({
        status: 'revoked',
        should_disconnect: true,
        disconnect_reason: 'Identifiants ou token non reconnus.'
      });
      return;
    }

    // Auto-activation on first use
    if (matched.on_hold) {
      matched.on_hold = false;
      matched.firstConnectedAt = new Date().toISOString();
      matched.expiresAt = new Date(Date.now() + matched.days * 86400000).toISOString();
    }

    // Device binding
    if (cleanDev) {
      if (!Array.isArray(matched.deviceIds)) matched.deviceIds = [];
      if (!matched.deviceIds.includes(cleanDev)) {
        if (matched.deviceIds.length >= matched.deviceLimit) {
          res.json({
            status: 'device_limit_reached',
            should_disconnect: true,
            disconnect_reason: `Limite d'appareils atteinte (${matched.deviceLimit}).`
          });
          return;
        }
        matched.deviceIds.push(cleanDev);
      }
    }

    // Traffic delta accounting
    let deltaBytes = Number(bytes_delta) || 0;
    if (deltaBytes === 0 && (bytes_up > 0 || bytes_down > 0)) {
      deltaBytes = Number(bytes_up) + Number(bytes_down);
    }
    if (deltaBytes > 0) {
      const deltaGb = deltaBytes / (1024 ** 3);
      matched.bandwidthUsedGb = Math.min(matched.bandwidthGb, matched.bandwidthUsedGb + deltaGb);
    }

    matched.lastSeenAt = new Date().toISOString();
    if (client_ip) matched.lastSeenIp = String(client_ip);
    matched.connectionCount = (matched.connectionCount || 0) + 1;

    const isExpired = Number.isFinite(new Date(matched.expiresAt).getTime()) && new Date(matched.expiresAt).getTime() <= Date.now();
    const isQuotaExceeded = matched.bandwidthUsedGb >= matched.bandwidthGb;

    if (isExpired) matched.status = 'expired';
    else if (isQuotaExceeded) matched.status = 'quota_exceeded';

    saveTokens(tokens);

    if (matched.status !== 'active') {
      res.json({
        status: matched.status,
        should_disconnect: true,
        disconnect_reason: matched.status === 'expired' ? 'Forfait arrivé à expiration.' : 'Quota de données épuisé.'
      });
      return;
    }

    const master = loadMasterConfig();
    res.json({
      status: 'ok',
      should_disconnect: false,
      user: {
        token: matched.token,
        uuid: matched.clientUuid || matched.token,
        plan: matched.plan,
        bandwidthGb: matched.bandwidthGb,
        bandwidthUsedGb: Number(matched.bandwidthUsedGb.toFixed(3)),
        expiresAt: matched.expiresAt
      },
      config: {
        host: master.serverHost || 'panel.pagnol.xyz',
        target_server: `${master.serverHost || 'panel.pagnol.xyz'}:${master.serverPort || 443}`,
        sni: master.sniHost || master.serverHost,
        path: master.path || '/@abess237'
      }
    });
  });

  app.post(['/api/token/verify', '/api/v1/token/verify'], (req, res) => {
    const rawCode = String(req.body?.token || req.body?.code || '').trim().toUpperCase();
    const deviceId = req.body?.deviceId ? String(req.body.deviceId).trim() : undefined;
    if (!rawCode) {
      res.status(400).json({ error: 'Code ou token requis.' });
      return;
    }
    const tokens = loadTokens();
    const found = tokens.find(t => t.token.toUpperCase() === rawCode || (t.clientUuid && t.clientUuid.toUpperCase() === rawCode));
    if (!found) {
      res.status(404).json({ error: 'Code voucher ou token introuvable.' });
      return;
    }
    if (deviceId) {
      if (!Array.isArray(found.deviceIds)) found.deviceIds = [];
      if (!found.deviceIds.includes(deviceId) && found.deviceIds.length < found.deviceLimit) {
        found.deviceIds.push(deviceId);
        saveTokens(tokens);
      }
    }
    const variants = generateUserVlessVariants(found);
    res.json({
      status: found.status,
      token: found.token,
      uuid: found.clientUuid,
      plan: found.plan,
      bandwidthGb: found.bandwidthGb,
      bandwidthUsedGb: found.bandwidthUsedGb,
      expiresAt: found.expiresAt,
      variants,
      subUrl: `/sub/${found.token}`
    });
  });

  app.post(['/api/users/quick-trial', '/api/v1/users/quick-trial'], (req, res) => {
    const tokens = loadTokens();
    const tokenStr = generateTokenCode();
    const uuid = crypto.randomUUID();
    const days = 1;
    const bandwidthGb = 2.0;
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

    const masterConfig = loadMasterConfig();
    const protocolConfigs = loadProtocolConfigs();
    const profile = protocolConfigs[0];

    const trialToken: ClientToken = {
      id: 'tok_' + crypto.randomUUID(),
      token: tokenStr,
      clientUuid: uuid,
      resellerId: 'trial_system',
      resellerName: 'Essai Automatique',
      plan: 'Essai Gratuit 24h',
      bandwidthGb,
      bandwidthUsedGb: 0,
      expiresAt,
      days,
      deviceLimit: 1,
      deviceIds: req.body?.deviceId ? [String(req.body.deviceId).trim()] : [],
      connectionCount: 0,
      lastSeenAt: null,
      lastSeenIp: null,
      status: 'active',
      configurationId: profile?.id,
      configurationName: profile?.name,
      configurationSnapshot: profile,
      customerNote: req.body?.name || 'Essai Client',
      encryptedLink: '',
      createdAt: new Date().toISOString()
    };
    trialToken.encryptedLink = encryptConfig({ token: tokenStr, v: 2 }, masterConfig.secretPassphrase);
    trialToken.directLink = profile ? buildDirectProtocolUrl(trialToken, profile) : undefined;

    tokens.push(trialToken);
    saveTokens(tokens);

    res.json({
      ok: true,
      token: trialToken.token,
      uuid: trialToken.clientUuid,
      expiresAt: trialToken.expiresAt,
      bandwidthGb: trialToken.bandwidthGb,
      subUrl: `/sub/${trialToken.token}`,
      variants: generateUserVlessVariants(trialToken)
    });
  });

  // ==========================================
  // 11. NETWORK PROBE & SYSTEM DIAGNOSTICS & AUDIT LOGS
  // ==========================================
  app.post(['/api/probe', '/api/v1/probe'], async (req, res) => {
    const target = String(req.body?.target_server || req.body?.target || '192.179.18.100:443').trim();
    const sni = String(req.body?.sni || 'crashlyticsreports-pa.googleapis.com').trim();
    const result = await probeEndpoint(target, sni);
    res.json(result);
  });

  app.get(['/api/system/diagnostics', '/api/v1/system/diagnostics'], authenticate, (_req, res) => {
    res.json(getSystemDiagnostics());
  });

  app.get(['/api/system/audit-logs', '/api/v1/admin/audit-logs'], authenticate, (_req, res) => {
    res.json(loadAuditLogs());
  });

  app.get(['/api/system/backup', '/api/v1/admin/system/backup'], authenticate, (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="abessvpn-full-backup-${Date.now()}.json"`);
    res.json({
      users: loadUsers(),
      tokens: loadTokens(),
      config: loadMasterConfig(),
      protocolConfigs: loadProtocolConfigs(),
      transactions: loadTransactions(),
      plans: loadPlans(),
      requests: loadRequests(),
      auditLogs: loadAuditLogs(),
      appVersion: loadAppVersionConfig(),
      timestamp: new Date().toISOString()
    });
  });

  app.post(['/api/system/restore', '/api/v1/admin/system/restore'], authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return;
    }
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ error: 'Fichier de sauvegarde invalide.' });
      return;
    }
    if (Array.isArray(payload.plans)) savePlans(payload.plans);
    if (Array.isArray(payload.requests)) saveRequests(payload.requests);
    if (Array.isArray(payload.auditLogs)) writeJsonAtomically(auditLogsFile, payload.auditLogs);
    if (Array.isArray(payload.users)) saveUsers(payload.users);
    if (Array.isArray(payload.tokens)) saveTokens(payload.tokens);
    if (payload.config) saveMasterConfig(payload.config);
    if (Array.isArray(payload.protocolConfigs)) saveProtocolConfigs(payload.protocolConfigs);
    logAudit({
      actor: user.name,
      role: user.role,
      action: 'SYSTEM_RESTORE',
      details: 'Restauration complète de la base de données.'
    });
    res.json({ ok: true, message: 'Base de données restaurée avec succès.' });
  });

  app.get('/api/v1/admin/tokens/:id/variants', authenticate, (req, res) => {
    const tokens = loadTokens();
    const token = tokens.find(t => t.id === req.params.id);
    if (!token) {
      res.status(404).json({ error: 'Token introuvable.' });
      return;
    }
    const protocolConfigs = loadProtocolConfigs();
    const profile = protocolConfigForToken(token, protocolConfigs);
    const variants = generateUserVlessVariants(token, profile || undefined);
    const xrayClient = generateXrayClientJson(token, profile || undefined);
    res.json({
      ok: true,
      token: token.token,
      subscriptionUrl: `/sub/${token.token}`,
      variants,
      xrayClient
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

  const xrayReconcileTimer = setInterval(() => {
    const tokens = loadTokens();
    let expired = false;
    const now = Date.now();
    for (const token of tokens) {
      const expiry = new Date(token.expiresAt).getTime();
      if (token.status === 'active' && (!Number.isFinite(expiry) || now >= expiry)) {
        token.status = 'expired';
        expired = true;
      }
    }
    if (expired) saveTokens(tokens);
    else syncXrayConfig(tokens);
    reconcileXrayUsage();
  }, 5000);
  xrayReconcileTimer.unref();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ABESSVPN MASTER SERVER] Running on port ${PORT}`);
    console.log(`[ABESSVPN MASTER SERVER] Control plane listening on ${PORT}; VPN domain: ${process.env.VPN_DOMAIN}`);
  });

  // Automated background server updater: checks every 6 hours if git remote has updates
  const autoUpdateTimer = setInterval(async () => {
    try {
      const status = await getServerUpdateStatus();
      if (status.hasUpdate && status.isGitRepo) {
        console.log(`[AUTO-UPDATE] Mise à jour distante détectée (${status.currentCommit} -> ${status.remoteCommit}). Application automatique...`);
        const updateResult = await executeServerUpdate();
        if (updateResult.success) {
          console.log(`[AUTO-UPDATE] ✅ Serveur mis à jour avec succès vers ${updateResult.currentCommit}`);
        } else {
          console.error(`[AUTO-UPDATE] ❌ Échec mise à jour automatique:`, updateResult.output);
        }
      }
    } catch {
      // background silent error
    }
  }, 6 * 3600 * 1000);
  autoUpdateTimer.unref();

  // Start Integrated Telegram Management Bot (if configured in .env)
  const tgBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const tgAdminIds = process.env.TELEGRAM_ADMIN_IDS?.split(',').map(s => s.trim()).filter(Boolean);
  startTelegramBot({
    botToken: tgBotToken,
    adminIds: tgAdminIds,
    vpnDomain,
    masterSecret,
    loadTokens,
    saveTokens,
    loadProtocolConfigs,
    saveProtocolConfigs,
    loadMasterConfig,
    loadUsers,
    saveUsers,
    loadTransactions,
    logTransaction,
    loadPlans,
    savePlans,
    loadRequests,
    saveRequests,
    getSystemDiagnostics,
    syncXrayConfig,
    encryptConfig,
    buildDirectProtocolUrl,
    safeClientToken,
    loadAppVersionConfig,
    saveAppVersionConfig,
    loadAnnouncements,
    saveAnnouncements,
    getServerUpdateStatus,
    executeServerUpdate,
    xrayStatusFile,
    xrayConfigFile,
    dataDir,
    backupsDir,
    startTime
  });
}

startServer().catch(console.error);
