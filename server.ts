import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import { lookup as dnsLookup } from 'node:dns/promises';
import tls from 'tls';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import QRCode from 'qrcode';
import { Operations, registerOperations, encryptedBackup, uploadBackup, type VpnNode } from './modules/operations.js';
import { registerCommerce } from './modules/commerce.js';
import { registerSsh, type SshState } from './modules/ssh.js';
import { SecurityService, registerSecurityRoutes } from './modules/security.js';
import { DocumentStore } from './modules/store.js';
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


const storage = new DocumentStore(dataDir, process.env.DATABASE_URL);
const hasDocument = (file: string) => storage.exists(file);
const readDocument = (file: string): any => storage.read(file);

// Atomic File Persistence Helper
function writeJsonAtomically(filePath: string, value: unknown): boolean {
  if (storage.handles(filePath)) return storage.write(filePath, value);
  if (storage.pool) { storage.afterCommit(() => writePhysicalJson(filePath, value)); return true; }
  return writePhysicalJson(filePath, value);
}

function writePhysicalJson(filePath: string, value: unknown): boolean {
  const contents = JSON.stringify(value, null, 2) + '\n';
  if (fs.existsSync(filePath)) {
    try {
      if (fs.readFileSync(filePath, 'utf8') === contents) return false;
    } catch {
      // Rewrite an unreadable or incomplete file atomically.
    }
  }
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, contents, { encoding: 'utf8', mode: 0o640 });
  fs.renameSync(tempPath, filePath);
  return true;
}

// Commercial Transaction & Audit Log
export interface TransactionLog {
  id: string;
  resellerId: string;
  resellerName: string;
  type: 'CREDIT_ADD' | 'TOKEN_CREATE' | 'BATCH_CREATE' | 'TOKEN_REVOKE' | 'RESET_DEVICES' | 'SERVER_UPDATE' | 'APP_VERSION_UPDATE' | 'ANNOUNCEMENT_PUBLISH' | 'SUB_RESELLER_CREATE' | 'CREDIT_TRANSFER' | 'RESELLER_DELETE_REFUND' | 'TOKEN_RENEW' | 'SSH_SALE' | 'SSH_RENEW';
  amountGb: number;
  balanceBefore: number;
  balanceAfter: number;
  note: string;
  timestamp: string;
}

function loadTransactions(): TransactionLog[] {
  if (!hasDocument(transactionsFile)) return [];
  try {
    const parsed = readDocument(transactionsFile);
    if (!Array.isArray(parsed)) throw new Error('invalid transaction array');
    return parsed as TransactionLog[];
  } catch {
    throw new Error('Le fichier data/transactions.json est illisible. Restaurez une sauvegarde avant de continuer.');
  }
}

function logTransaction(tx: Omit<TransactionLog, 'id' | 'timestamp'>): void {
  const list = loadTransactions();
  list.unshift({
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    ...tx,
    timestamp: new Date().toISOString()
  });
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
  parentId?: string;
  parentName?: string;
}

export interface ClientToken {
  id: string;
  token: string;
  /** Per-licence VLESS identity; legacy records are migrated on load. */
  clientUuid?: string;
  trafficId?: string;
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
  renewalIds?: string[];
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
  protocolType?: 'vless' | 'ssh';
  sshConfig?: {
    sshConfigType: string;
    remarks: string;
    sshHost: string;
    sshPort: number;
    sshUsername: string;
    sshPassword: string;
    payload: string;
  };
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
  payload?: string;
  remarks?: string;
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
  if (hasDocument(appVersionFile)) {
    try {
      const data = readDocument(appVersionFile);
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
      throw new Error('Format de data/app-version.json invalide.');
    } catch {
      throw new Error('Le fichier data/app-version.json est illisible. Restaurez une sauvegarde avant de continuer.');
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
  if (hasDocument(announcementsFile)) {
    try {
      const data = readDocument(announcementsFile);
      if (!Array.isArray(data)) throw new Error('invalid announcement array');
      return data;
    } catch {
      throw new Error('Le fichier data/announcements.json est illisible. Restaurez une sauvegarde avant de continuer.');
    }
  }
  const defaultAnnouncements: Announcement[] = [
    {
      id: 'ann-welcome-01',
      title: '🛡️ Bienvenue sur AbessVpn v2.1.0',
      message: 'Bienvenue sur ABESS VPN. Les licences VLESS sont disponibles sur les profils réellement activés par votre administrateur. Rejoignez le canal officiel pour les dernières actualités !',
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
  /** SHA-256 of an unguessable claim secret returned once to the applicant. */
  claimSecretHash?: string;
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
  if (hasDocument(plansFile)) {
    try {
      const parsed = readDocument(plansFile);
      if (!Array.isArray(parsed)) throw new Error('invalid plan array');
      return parsed;
    } catch {
      throw new Error('Le fichier data/plans.json est illisible. Restaurez une sauvegarde avant de continuer.');
    }
  }
  writeJsonAtomically(plansFile, DEFAULT_PLANS);
  return DEFAULT_PLANS;
}

export function savePlans(plans: PricingPlan[]): void {
  writeJsonAtomically(plansFile, plans);
}

export function loadRequests(): MembershipRequest[] {
  if (!hasDocument(requestsFile)) return [];
  try {
    const parsed = readDocument(requestsFile);
    if (!Array.isArray(parsed)) throw new Error('invalid request array');
    return parsed;
  } catch {
    throw new Error('Le fichier data/requests.json est illisible. Restaurez une sauvegarde avant de continuer.');
  }
}

export function saveRequests(reqs: MembershipRequest[]): void {
  writeJsonAtomically(requestsFile, reqs);
}

export function loadAuditLogs(): AuditLog[] {
  if (!hasDocument(auditLogsFile)) return [];
  try {
    const parsed = readDocument(auditLogsFile);
    if (!Array.isArray(parsed)) throw new Error('invalid audit log array');
    return parsed;
  } catch {
    throw new Error('Le fichier data/audit-logs.json est illisible. Restaurez une sauvegarde avant de continuer.');
  }
}

export function logAudit(entry: Omit<AuditLog, 'id' | 'timestamp'>): void {
  storage.appendAudit(entry);
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
  if(isProduction)return {success:false,output:'Utilisez le workflow de déploiement vérifié avec sauvegarde et contrôle de santé.',currentCommit:'managed-deployment'};
  if (!fs.existsSync(path.resolve(__dirname, '.git'))) {
    return { success: false, output: 'Dépôt git absent', currentCommit: 'unknown' };
  }

  let previousCommit = 'unknown';
  try {
    const { stdout: workingTree } = await execAsync('git status --porcelain', { cwd: __dirname, timeout: 10000 });
    if (workingTree.trim()) {
      return {
        success: false,
        output: 'Mise à jour annulée : des modifications locales existent dans le dépôt. Sauvegardez-les ou nettoyez le dépôt avant de continuer.',
        currentCommit: (await execAsync('git rev-parse --short HEAD', { cwd: __dirname })).stdout.trim()
      };
    }

    previousCommit = (await execAsync('git rev-parse HEAD', { cwd: __dirname })).stdout.trim();
    await execAsync('git fetch --quiet origin main', { cwd: __dirname, timeout: 30000 });
    const targetCommit = (await execAsync('git rev-parse origin/main', { cwd: __dirname, timeout: 10000 })).stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(targetCommit)) {
      throw new Error('Commit distant invalide.');
    }
    if (targetCommit === previousCommit) {
      return { success: true, output: 'Le serveur est déjà à jour.', currentCommit: targetCommit.slice(0, 7) };
    }

    await execAsync(`git merge --ff-only ${targetCommit}`, { cwd: __dirname, timeout: 30000 });

    try {
      await execAsync('npm run build', { cwd: __dirname, timeout: 120000 });
      refreshTrafficTotals();
    } catch (buildOrConfigError) {
      const reason = buildOrConfigError instanceof Error ? buildOrConfigError.message : String(buildOrConfigError);
      await execAsync(`git reset --hard ${previousCommit}`, { cwd: __dirname, timeout: 30000 });
      await execAsync('npm run build', { cwd: __dirname, timeout: 120000 });
      refreshTrafficTotals();
      return {
        success: false,
        output: `Mise à jour annulée et commit précédent restauré après échec du build/configuration : ${reason}`,
        currentCommit: previousCommit.slice(0, 7)
      };
    }

    logTransaction({
      resellerId: 'system',
      resellerName: 'Système Auto-Update',
      type: 'SERVER_UPDATE',
      amountGb: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      note: `Mise à jour serveur validée de ${previousCommit.slice(0, 7)} vers ${targetCommit.slice(0, 7)}`
    });

    return {
      success: true,
      output: `Mise à jour et build validés : ${targetCommit.slice(0, 7)}`,
      currentCommit: targetCommit.slice(0, 7)
    };
  } catch (err: unknown) {
    return {
      success: false,
      output: err instanceof Error ? err.message : String(err),
      currentCommit: previousCommit === 'unknown' ? 'error' : previousCommit.slice(0, 7)
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

  if (hasDocument(configFile)) {
    try {
      const stored = readDocument(configFile) as Partial<MasterServerConfig>;
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
        path: typeof stored.path === 'string' ? stored.path : '/@abess237',
        sniHost: normalizedStoredHost(stored.sniHost),
        secretPassphrase: process.env.MASTER_SECRET || ''
      };
      // Persist normalized fields when whitespace or letter case changed.
      if (
        merged.serverHost !== rawStoredHost ||
        merged.host !== rawStoredHeaderHost ||
        merged.sniHost !== rawStoredSni ||
        Object.prototype.hasOwnProperty.call(stored, 'secretPassphrase')
      ) {
        saveMasterConfig(merged);
      }
      // Exclusive pure TCP architecture: VLESS only
      merged.protocol = 'vless';
      if (!['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'].includes(merged.transport)) {
        merged.transport = 'tcp';
      }
      merged.serverPort = xrayPublicPort(merged.protocol, merged.transport, 443);
      return merged;
    } catch {
      throw new Error('Le fichier data/config.json est illisible. Restaurez une sauvegarde avant de continuer.');
    }
  }

  saveMasterConfig(defaults);
  return defaults;
}
function saveMasterConfig(cfg: MasterServerConfig) {
  // MASTER_SECRET must live only in the process environment, never in JSON files.
  const { secretPassphrase: _secretPassphrase, ...safeConfig } = cfg;
  writeJsonAtomically(configFile, safeConfig);
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
  if (hasDocument(usersFile)) {
    try {
      return readDocument(usersFile) as AppUser[];
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
  writeJsonAtomically(usersFile, initial);
  return initial;
}
function saveUsers(users: AppUser[]) {
  writeJsonAtomically(usersFile, users);
}

// Reject corrupt reseller graphs before a restore can lock administrators out
// or make hierarchy traversals loop indefinitely.
function validRestoredUsers(value: unknown): value is AppUser[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const byId = new Map<string, AppUser>();
  const emails = new Set<string>();
  for (const user of value) {
    if (!user || typeof user.id !== 'string' || !user.id.trim() || byId.has(user.id) ||
        typeof user.email !== 'string' || !user.email.trim() ||
        typeof user.passwordHash !== 'string' || !user.passwordHash ||
        typeof user.name !== 'string' ||
        !['SUPER_ADMIN', 'RESELLER'].includes(user.role) ||
        !['active', 'suspended'].includes(user.status) ||
        !Number.isFinite(user.credits) || user.credits < 0) return false;
    const email = user.email.trim().toLowerCase();
    if (emails.has(email)) return false;
    emails.add(email);
    byId.set(user.id, user);
  }
  if (!value.some(user => user.role === 'SUPER_ADMIN' && user.status === 'active')) return false;
  for (const user of value) {
    if (user.role === 'SUPER_ADMIN' && user.parentId) return false;
    const visited = new Set<string>([user.id]);
    let parentId = user.parentId;
    while (parentId) {
      if (typeof parentId !== 'string' || visited.has(parentId)) return false;
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return false;
      parentId = parent.parentId;
    }
  }
  return true;
}

// Tokens Storage
function loadTokens(): ClientToken[] {
  if (hasDocument(tokensFile)) {
    try {
      const loaded = readDocument(tokensFile) as ClientToken[];
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
      if (changed) writeJsonAtomically(tokensFile, loaded);
      return loaded;
    } catch {
      throw new Error('Le fichier data/tokens.json est illisible. Restaurez une sauvegarde avant de redémarrer.');
    }
  }

  const initial: ClientToken[] = [];
  writeJsonAtomically(tokensFile, initial);
  return initial;
}


function xrayUserEmail(token: ClientToken): string {
  return token.trafficId || 'abess-' + token.id.replace(/[^a-zA-Z0-9_.@-]/g, '_');
}

const XRAY_PROTOCOLS = ['vless'] as const;
const XRAY_WEB_TRANSPORTS = ['ws', 'grpc', 'httpupgrade', 'xhttp'] as const;
const XRAY_DIRECT_TRANSPORTS = ['tcp'] as const;
const XRAY_TRANSPORTS: readonly (typeof XRAY_WEB_TRANSPORTS[number] | typeof XRAY_DIRECT_TRANSPORTS[number])[] = [
  ...XRAY_WEB_TRANSPORTS, ...XRAY_DIRECT_TRANSPORTS
];
type XrayProtocol = typeof XRAY_PROTOCOLS[number];
type XrayWebTransport = typeof XRAY_WEB_TRANSPORTS[number];
type XrayTransport = XrayWebTransport | typeof XRAY_DIRECT_TRANSPORTS[number];

function isXrayProtocol(value: unknown): value is XrayProtocol {
  return value === 'vless';
}
function isXrayTransport(value: unknown): value is XrayTransport {
  return typeof value === 'string' && (XRAY_TRANSPORTS as readonly string[]).includes(value);
}
function xrayProfilePath(_protocol: XrayProtocol, transport: XrayTransport, customPath = '/@abess237'): string {
  return transport === 'tcp' ? '' : customPath;
}
function xrayPublicPort(_protocol: string, _transport: string, port: number): number {
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 443;
}

function isTlsWebTransport(transport: string): boolean {
  return ['ws', 'grpc', 'httpupgrade', 'xhttp'].includes(transport);
}

function tlsSniValidationError(transport: string, sniHost: unknown, _serverHost?: string): string | null {
  if (transport === 'tcp' && process.env.ALLOW_INSECURE_TCP !== 'true') return 'VLESS TCP sans TLS est désactivé.';
  if (!isTlsWebTransport(transport)) return null;
  return typeof sniHost === 'string' && isValidPublicHost(sniHost.trim()) ? null : 'SNI TLS invalide.';
}
function publicProtocolConfig(config: ProtocolConfig): ProtocolConfig {
  return {
    id: config.id, name: config.name, serverHost: config.serverHost, host: config.host || '',
    serverPort: config.serverPort, protocol: config.protocol, transport: config.transport,
    path: config.path || '/@abess237', sniHost: config.sniHost || '',
    payload: config.payload || '', remarks: config.remarks || '',
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
    protocol: legacy.protocol, transport: legacy.transport, path: legacy.path,
    sniHost: legacy.sniHost || '', createdAt: now, updatedAt: now
  };
}
export function buildDirectProtocolUrl(token: ClientToken, profile: ProtocolConfig): string {
  const host = profile.serverHost;
  const port = xrayPublicPort(profile.protocol, profile.transport, profile.serverPort);
  const sni = profile.sniHost || host;
  const wsHost = profile.host || host;
  const path = xrayProfilePath('vless', profile.transport as XrayTransport, profile.path);
  const name = `${profile.name} - ${token.token}`;
  const uuid = token.clientUuid || token.token;
  const encName = encodeURIComponent(name);

  if (profile.transport === 'tcp') {
    return `vless://${uuid}@${host}:${port}?encryption=none&security=none&type=tcp&headerType=none#${encName}`;
  }
  if (profile.transport === 'grpc') {
    const serviceName = encodeURIComponent(path.replace(/^\/+/, ''));
    return `vless://${uuid}@${host}:${port}?encryption=none&security=tls&type=grpc&serviceName=${serviceName}&mode=gun&sni=${encodeURIComponent(sni)}#${encName}`;
  }
  return `vless://${uuid}@${host}:${port}?encryption=none&security=tls&type=${profile.transport}&path=${encodeURIComponent(path)}&host=${encodeURIComponent(wsHost)}&sni=${encodeURIComponent(sni)}#${encName}`;
}

export function generateUserVlessVariants(token: ClientToken, profile?: ProtocolConfig): VlessVariant[] {
  const selected = profile || legacyProtocolConfig();
  if (!selected) return [];
  return [{ id: 'configured', label: selected.name, badge: selected.transport.toUpperCase(), protocol: selected.protocol,
    uri: buildDirectProtocolUrl(token, selected), sni: selected.sniHost, target: `${selected.serverHost}:${selected.serverPort}` }];
}

export function generateXrayClientJson(token: ClientToken, profile?: ProtocolConfig): Record<string, unknown> {
  const master = loadMasterConfig();
  const host = profile?.serverHost || master.serverHost || 'panel.pagnol.xyz';
  const transport = profile?.transport || master.transport || 'ws';
  if (!isXrayTransport(transport)) throw new Error('Transport client Xray non pris en charge.');
  const port = xrayPublicPort('vless', transport, Number(profile?.serverPort || master.serverPort || 443));
  const primarySni = profile?.sniHost || master.sniHost || host;
  const wsHost = profile?.host || master.host || host;
  const rawPath = profile?.path || master.path || '/@abess237';
  const cleanPath = xrayProfilePath('vless', transport, rawPath);
  const uuid = token.clientUuid || token.token;

  const tlsSettings = {
    serverName: primarySni,
    allowInsecure: false,
    fingerprint: 'chrome',
    ...(transport === 'grpc' ? { alpn: ['h2'] } : {})
  };
  const streamSettings: Record<string, unknown> = {
    network: transport,
    security: transport === 'tcp' ? 'none' : 'tls',
    sockopt: {
      tcpFastOpen: true,
      tcpNoDelay: true,
      tcpKeepAliveIdle: 30,
      tcpKeepAliveInterval: 15
    }
  };

  if (transport === 'tcp') {
    streamSettings.tcpSettings = { header: { type: 'none' } };
  } else {
    streamSettings.tlsSettings = tlsSettings;
    switch (transport) {
      case 'ws':
        streamSettings.wsSettings = {
          path: cleanPath,
          headers: { Host: wsHost }
        };
        break;
      case 'grpc':
        streamSettings.grpcSettings = {
          serviceName: cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath,
          multiMode: false
        };
        break;
      case 'httpupgrade':
        streamSettings.httpupgradeSettings = {
          path: cleanPath,
          host: wsHost
        };
        break;
      case 'xhttp':
        streamSettings.xhttpSettings = {
          path: cleanPath,
          mode: 'auto'
        };
        break;
    }
  }

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
        streamSettings,
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

export function generateUnifiedToken(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 11; i++) {
    rand += chars[crypto.randomInt(chars.length)];
  }
  return `ABESS-${rand}`;
}

export const DEFAULT_SSH_PAYLOAD = "GET / HTTP/1.1[crlf]FoxNews.com;www.epicgames.com;us.shop.battle.net;unity3d.com;www.icloud.com;www.bing.com;www.samsung.com;store.nintendo.com.br;www.garena.com;n41-06-05.opera-mini.net[crlf]Host: m.batch.com[crlf][crlf]X / HTTP/1.1[crlf]FoxNews.com;www.epicgames.com;us.shop.battle.net;unity3d.com;www.icloud.com;www.bing.com;www.samsung.com;store.nintendo.com.br;www.garena.com;n41-06-05.opera-mini.net[crlf]Host: [host][crlf][crlf]GET /loic HTTP/1.1[crlf]Host: dbl5i9lrmmeui.cloudfront.net[crlf]Backend: crashlyticsreports-pa.googleapis.com[crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf]User-agent:[ua][crlf][crlf]";

/**
 * Host-level SSH account management is unavailable in the containerized
 * control plane. A dedicated host-side provisioner with a narrow authenticated
 * interface is required. This process must never run sudo useradd/chpasswd or
 * persist plaintext SSH passwords on the host.
 */
export function createLinuxSshAccount(_username: string, _password: string, _days = 30): boolean {
  return false;
}

export function deleteLinuxSshAccount(_username: string): boolean {
  return false;
}

export function generateSshConfigJson(token: ClientToken): Record<string, unknown> {
  const ssh = token.sshConfig;
  if (!ssh || !ssh.sshHost || !ssh.sshUsername || !ssh.sshPassword) {
    return {
      configs: [],
      error: 'Cette ancienne licence SSH ne contient pas de paramètres provisionnés valides.'
    };
  }
  return {
    configs: [
      {
        name: ssh.remarks || token.plan || '𖤍 ORANGE🍊〆DANNY 𖤍',
        address: `${ssh.sshHost}:${Number(ssh.sshPort) || 80}`,
        type: 'SSH',
        sshConfig: {
          sshConfigType: ssh.sshConfigType || 'SSH-Payload',
          remarks: ssh.remarks || token.plan || 'Configuration SSH historique',
          sshHost: ssh.sshHost,
          sshPort: Number(ssh.sshPort) || 80,
          sshUsername: ssh.sshUsername,
          sshPassword: ssh.sshPassword,
          payload: ssh.payload || DEFAULT_SSH_PAYLOAD
        }
      }
    ]
  };
}

/**
 * Disabled: this Node container is not the Linux SSH host and must not attempt
 * to inspect or kill host processes with sudo. A dedicated SSH provisioner is
 * required before SSH account management can be re-enabled.
 */
export function enforceSshDeviceLimits(): void {
  return;
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
        rejectUnauthorized: true,
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

  const dropbearStatus = 'external';
  const wsDropbearStatus = 'external';
  const activeSshConnections = readExternalNodes().filter(nodeReady).reduce((n, node) => n + (node.online || 0), 0);

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
      xrayStatus: isXrayReady() ? 'ready' : 'not-ready',
      dropbearStatus,
      wsDropbearStatus,
      activeSshConnections,
      vpnDomain: master.serverHost || 'panel.pagnol.xyz',
      appVersion: version.latestVersion
    },
    timestamp: new Date().toISOString()
  };
}

function loadProtocolConfigs(): ProtocolConfig[] {
  if (hasDocument(protocolConfigsFile)) {
    try {
      const parsed = readDocument(protocolConfigsFile);
      if (!Array.isArray(parsed)) {
        throw new Error('Format de tableau invalide.');
      }
      if (parsed.length === 0) return [];

      // SSH profiles are intentionally retired; do not revive them as usable profiles.
      const nonRetired = parsed.filter((item: any) => item && item.protocol !== 'ssh');
      const valid = nonRetired.filter((item: any) =>
        typeof item.id === 'string' && typeof item.name === 'string' &&
        isValidPublicHost(item.serverHost) && isXrayProtocol(item.protocol) &&
        isXrayTransport(item.transport)
      ).map((item: any) => publicProtocolConfig({
        ...item,
        host: typeof item.host === 'string' ? item.host : '',
        sniHost: typeof item.sniHost === 'string' ? item.sniHost : '',
        serverPort: xrayPublicPort(item.protocol, item.transport, Number(item.serverPort) || 443),
        path: xrayProfilePath(item.protocol, item.transport, item.path || '/@abess237'),
        payload: '',
        remarks: typeof item.remarks === 'string' ? item.remarks : item.name,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString()
      } as ProtocolConfig));

      if (nonRetired.length > 0 && valid.length === 0) {
        throw new Error('Aucun profil VLESS valide ne reste après validation.');
      }
      return valid;
    } catch {
      throw new Error('Le fichier data/protocol-configs.json est invalide ou illisible. Restaurez une sauvegarde avant de continuer.');
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
  const serverHost = String(input?.serverHost ?? existing?.serverHost ?? '').trim().toLowerCase();
  const host = String(input?.host ?? existing?.host ?? '').trim();
  const protocol = String(input?.protocol ?? existing?.protocol ?? 'vless').toLowerCase();
  const transport = String(input?.transport ?? existing?.transport ?? (protocol === 'ssh' ? 'ws' : 'tcp')).toLowerCase();
  const sniHost = String(input?.sniHost ?? existing?.sniHost ?? '').trim();
  const payload = String(input?.payload ?? existing?.payload ?? DEFAULT_SSH_PAYLOAD).trim();
  const remarks = String(input?.remarks ?? existing?.remarks ?? name).trim();

  if (name.length < 2 || name.length > 80) return null;
  if (!isValidPublicHost(serverHost) || (host !== '' && !isValidPublicHost(host))) return null;

  const port = Number(input?.serverPort ?? existing?.serverPort ?? 443);
  const profilePath = String(input?.path ?? existing?.path ?? '/@abess237');
  if (!Number.isInteger(port) || port < 1 || port > 65535 || profilePath.length > 2048 || /[\r\n\x00]/.test(profilePath)) return null;
  const now = new Date().toISOString();
  // SSH provisioning is retired until a dedicated host-side agent replaces the
  // unsafe legacy root/password-file integration.
  if (protocol === 'ssh') return null;
  if (!isXrayProtocol(protocol)) return null;
  if (!isXrayTransport(transport)) return null;
  if (tlsSniValidationError(transport, sniHost,serverHost)) return null;
  if (sniHost && !isValidPublicHost(sniHost)) return null;
  return {
    id: existing?.id || 'cfg_' + crypto.randomUUID(), name, serverHost, host,
    serverPort: port,
    protocol, transport, path: xrayProfilePath(protocol as XrayProtocol, transport as XrayTransport, profilePath), sniHost,
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
type SafeClientToken = Omit<ClientToken, 'configurationSnapshot' | 'sshConfig'> & {
  sshConfig?: Omit<NonNullable<ClientToken['sshConfig']>, 'sshPassword'>;
};

function safeClientToken(token: ClientToken): SafeClientToken {
  const { configurationSnapshot: _configurationSnapshot, sshConfig, ...safe } = token;
  if (!sshConfig) return safe;
  const { sshPassword: _sshPassword, ...safeSshConfig } = sshConfig;
  return { ...safe, sshConfig: safeSshConfig };
}

// Backups are Super Admin-only recovery artifacts: retain each token's immutable
// protocol snapshot, but never serialize a historical clear-text SSH password.
type BackupClientToken = Omit<ClientToken, 'sshConfig'> & {
  sshConfig?: Omit<NonNullable<ClientToken['sshConfig']>, 'sshPassword'>;
};

function backupClientToken(token: ClientToken): BackupClientToken {
  const { sshConfig, ...fullToken } = token;
  if (!sshConfig) return fullToken;
  const { sshPassword: _sshPassword, ...safeSshConfig } = sshConfig;
  return { ...fullToken, sshConfig: safeSshConfig };
}

function readExternalNodes(): VpnNode[] {
  const file = path.resolve(dataDir, 'nodes.json');
  return hasDocument(file) ? readDocument(file) : [];
}
function nodeReady(node: VpnNode): boolean {
  const age = Date.now() - Date.parse(node.observedAt || '');
  return node.enabled && node.ready === true && Number.isFinite(age) && age >= -5000 && age <= 60000;
}
function isXrayReady(): boolean {
  return readExternalNodes().some(nodeReady);
}
function isTokenDataPlaneReady(token: ClientToken): boolean {
  return readExternalNodes().some(node => node.host === protocolConfigForToken(token)?.serverHost && nodeReady(node));
}
function refreshTrafficTotals(_tokens?: ClientToken[]): boolean {
  const nodes = readExternalNodes().filter(node => node.enabled);
  totalBytesTransferred = loadTokens().reduce((total, token) => total + token.bandwidthUsedGb * 1024 ** 3, 0);
  activeTunnelConnections = nodes.filter(nodeReady).reduce((total, node) => total + (node.online || 0), 0);
  return true;
}

function saveTokens(tokens: ClientToken[]) {
  writeJsonAtomically(tokensFile, tokens);
  refreshTrafficTotals(tokens);
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
const securityFile = path.resolve(dataDir, 'security.json');
const security = new SecurityService(
  () => hasDocument(securityFile) ? readDocument(securityFile) : { mfa: {}, sessions: {} },
  state => { writeJsonAtomically(securityFile, state); },
  () => process.env.MASTER_SECRET!
);
const activeSessions = security.sessions;
const operations = new Operations(dataDir,isXrayReady,()=>Boolean(storage.pool),()=>readExternalNodes().some(n=>n.enabled));

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

// Anti-Brute-Force Rate Limiting for Public Endpoints (Tokens, Subs, SSH configs)
interface PublicRateBucket {
  count: number;
  resetAt: number;
  blockedUntil: number;
}
const publicRateLimits = new Map<string, PublicRateBucket>();

function publicApiRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Do not trust caller-supplied X-Forwarded-For for abuse controls.
  const ip = req.ip || 'unknown';
  const now = Date.now();
  let bucket = publicRateLimits.get(ip);
  if (bucket?.blockedUntil && bucket.blockedUntil > now) {
    const retryAfter = Math.ceil((bucket.blockedUntil - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      valid: false,
      error: `Trop de requêtes. Veuillez patienter ${retryAfter} secondes.`,
      status: 'rate_limited'
    });
  }
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 1, resetAt: now + 60000, blockedUntil: 0 };
    publicRateLimits.set(ip, bucket);
    return next();
  }
  bucket.count++;
  if (bucket.count > 60) {
    bucket.blockedUntil = now + 60000;
    const retryAfter = 60;
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      valid: false,
      error: 'Limite de requêtes atteinte (60 req/min). Veuillez patienter 60 secondes.',
      status: 'rate_limited'
    });
  }
  next();
}

// Periodic TTL session and rate limiter cleanup
setInterval(() => {
  void storage.transaction(() => {
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
  for (const [ip, bucket] of publicRateLimits.entries()) {
    if (now >= bucket.resetAt && now >= bucket.blockedUntil) {
      publicRateLimits.delete(ip);
    }
  }
  }).catch(() => console.error('[SECURITY] Session cleanup postponed.'));
}, 60 * 60 * 1000).unref();

function escapeHtmlText(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

// Inline JSON lives inside a script element. Escaping HTML-significant characters
// prevents user-controlled strings such as customerNote from closing that script.
function serializeSafeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

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

  if(isProduction&&!process.env.DATABASE_URL&&process.env.ALLOW_JSON_STORAGE!=='true')throw new Error('PostgreSQL est requis en production. ALLOW_JSON_STORAGE=true est réservé aux tests isolés.');
  await storage.initialize();
  await storage.transaction(() => {
    loadUsers();
    refreshTrafficTotals(loadTokens());
  });

  const app = express();
  // The API is reachable only through the private Docker network in production.
  // Trust private Caddy proxy hops so req.ip resolves the visitor address without
  // trusting X-Forwarded-For from arbitrary public peers.
  app.set('trust proxy', 'uniquelocal');
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.on('finish',()=>{if(res.statusCode>=500)operations.recordError();});
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()'});
    if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');
    next();
  });
  app.use(express.urlencoded({extended:false,limit:'64kb'}));
  app.use(express.json({ limit: '2mb' }));
  app.use(storage.middleware());

  // Same-origin panel access plus explicit local development or configured origins.
  const allowedOrigins = new Set<string>([
    `https://${vpnDomain}`,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...(!isProduction ? [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`] : []),
    ...(process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean)
  ]);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string') {
      if (!allowedOrigins.has(origin)) {
        res.status(403).json({ error: 'Origine non autorisée.' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
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
      // Verify a fresh sidecar heartbeat; stale marker files do not prove readiness.
      dataPlane: isXrayReady() ? 'ready' : 'not-ready'
    });
  });

  // Real HTTP throughput probes. Limit payload size to protect the management API.
  app.get('/api/v1/speedtest/download', publicApiRateLimiter, (req, res) => {
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
    publicApiRateLimiter,
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
  app.post('/api/v1/client/telemetry', publicApiRateLimiter, (req, res) => {
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

    refreshTrafficTotals();
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

    if (!isTokenDataPlaneReady(found)) {
      res.status(503).json({
        ok: false,
        error: 'Le moteur Xray-core n’est pas prêt.',
        dataPlane: 'not-ready'
      });
      return;
    }

    found.lastSeenAt = new Date(now).toISOString();
    found.lastSeenIp = req.ip || 'unknown';
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
      quotaSource: 'external-agent-user-stats'
    });
  });

  app.post('/api/v1/client/availability',publicApiRateLimiter,(req,res)=>{
    const token=loadTokens().find(item=>item.token.toUpperCase()===String(req.body?.token||'').toUpperCase());
    const device=String(req.body?.deviceId||'');
    if(!token||!device||!token.deviceIds?.includes(device)||(token.allowedDeviceId&&token.allowedDeviceId!==device))return res.sendStatus(401);
    const active=token.status==='active'&&Date.parse(token.expiresAt)>Date.now()&&token.bandwidthUsedGb<token.bandwidthGb;
    if(!active)return res.status(403).json({ok:false,error:'Licence inactive, expirée ou quota épuisé.'});
    const ready=isTokenDataPlaneReady(token);
    res.status(ready?200:503).json({ok:ready,dataPlane:ready?'ready':'not-ready'});
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
    const headerToken=req.headers.authorization?.startsWith('Bearer sess_')?req.headers.authorization.slice(7):undefined;
    const cookieToken=req.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith('abess_session='))?.slice('abess_session='.length);
    const token=headerToken||cookieToken||'';
    if(!/^sess_[a-f0-9]{64}$/.test(token)) {
      res.status(401).json({error:'Session non authentifiée. Veuillez vous connecter.'});return;
    }
    (req as any).sessionToken=token;
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
      activeSessions.delete(token);
      res.status(401).json({ error: 'Compte suspendu ou introuvable.' });
      return;
    }

    // Re-check the entire reseller ancestry on every request. Suspending a
    // parent immediately disables already-issued sessions of its descendants.
    const visitedParents = new Set<string>([user.id]);
    let parentId = user.parentId;
    while (parentId) {
      if (visitedParents.has(parentId)) {
        activeSessions.delete(token);
        res.status(403).json({ error: 'Hiérarchie revendeur invalide.' });
        return;
      }
      visitedParents.add(parentId);
      const parent = users.find(candidate => candidate.id === parentId);
      if (!parent || parent.status !== 'active') {
        activeSessions.delete(token);
        res.status(401).json({ error: 'Votre branche revendeur parente est suspendue ou introuvable. Reconnexion refusée.' });
        return;
      }
      parentId = parent.parentId;
    }

    if (process.env.REQUIRE_ADMIN_MFA === 'true' && user.role === 'SUPER_ADMIN' && !security.enabled(user.id) && !req.path.startsWith('/api/v1/auth/')) {
      res.status(403).json({error:'Activez la double authentification dans Sécurité.',mfaRequired:true});return;
    }
    (req as any).user = user;
    next();
  };

  const requireSuperAdmin = (req: express.Request, res: express.Response): boolean => {
    const user = (req as any).user as AppUser | undefined;
    if (user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
      return false;
    }
    return true;
  };

  // ==========================================
  // 1. AUTHENTICATION & LOGIN (Admin & Reseller)
  // ==========================================
  app.post('/api/v1/auth/login', (req, res) => {
    // X-Forwarded-For is untrusted unless a trusted proxy is explicitly configured.
    const clientIp = req.ip || 'unknown';

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
      res.status(403).json({ error: 'Ce compte a été suspendu par l\'administrateur.' });
      return;
    }

    // Verify if any parent reseller in the hierarchy is suspended
    const visitedParents = new Set<string>([user.id]);
    let currentParentId = user.parentId;
    while (currentParentId) {
      if (visitedParents.has(currentParentId)) {
        res.status(403).json({ error: 'Hiérarchie revendeur invalide.' });
        return;
      }
      visitedParents.add(currentParentId);
      const parentUser = users.find(u => u.id === currentParentId);
      if (!parentUser) {
        res.status(403).json({ error: 'Branche revendeur parente introuvable.' });
        return;
      }
      if (parentUser.status !== 'active') {
        res.status(403).json({ error: `La branche revendeur parente (${parentUser.name}) est actuellement suspendue.` });
        return;
      }
      currentParentId = parentUser.parentId;
    }

    if (security.enabled(user.id) && !security.verify(user.id, req.body?.code)) {
      if (req.body?.code) recordLoginAttempt(clientIp, false);
      res.status(401).json({ error: 'Code de double authentification requis ou invalide.', mfaRequired: true });
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
    const existingSessions=activeSessions.entries().filter(([,session])=>session.userId===user.id).sort((a,b)=>a[1].createdAt-b[1].createdAt);
    for(const [id] of existingSessions.slice(0,Math.max(0,existingSessions.length-9)))activeSessions.delete(id);
    activeSessions.set(sessionToken, {
      userId: user.id,
      role: user.role,
      email: user.email,
      createdAt: Date.now(),
      ip: req.ip,
      agent: String(req.headers['user-agent'] || '').slice(0,200)
    });
    res.cookie('abess_session',sessionToken,{httpOnly:true,secure:isProduction&&process.env.COOKIE_SECURE!=='false',sameSite:'strict',path:'/api',maxAge:86400000});
    res.set('Cache-Control','no-store');
    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        credits: user.credits, totalTokensCreated: user.totalTokensCreated,
        totalBandwidthAllocatedGb: user.totalBandwidthAllocatedGb,
        parentId: user.parentId, parentName: user.parentName
      }
    });
  });

  app.post('/api/v1/auth/logout', authenticate, (req, res) => {
    activeSessions.delete((req as any).sessionToken);
    res.clearCookie('abess_session',{httpOnly:true,secure:isProduction&&process.env.COOKIE_SECURE!=='false',sameSite:'strict',path:'/api'});
    res.sendStatus(204);
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
      totalBandwidthAllocatedGb: user.totalBandwidthAllocatedGb,
      parentId: user.parentId,
      parentName: user.parentName
    });
  });

  registerSecurityRoutes(app, {authenticate, security, users:loadUsers, saveUsers, verifyPassword, hashPassword, audit:logAudit, guard:ip=>checkLoginRateLimit(ip).allowed, failure:ip=>recordLoginAttempt(ip,false)});

  const commerceFile=path.resolve(dataDir,'commerce.json');
  registerCommerce(app,{authenticate,limiter:publicApiRateLimiter,read:()=>hasDocument(commerceFile)?readDocument(commerceFile):{orders:[]},write:v=>{writeJsonAtomically(commerceFile,v);},users:loadUsers,saveUsers,plans:loadPlans,audit:logAudit,durable:()=>Boolean(storage.pool)});

  const sshFile = path.resolve(dataDir, 'ssh.json');
  const sshControl = process.env.SSH_CONTROL_DIR || path.resolve(dataDir, 'ssh-control');
  const readSsh = (): SshState => hasDocument(sshFile) ? readDocument(sshFile) : { accounts: [] };
  const sshOwnerActive = (ownerId?: string) => {
    if (!ownerId) return true; // Retain legacy administrator-owned imports.
    const users = loadUsers(); const visited = new Set<string>();
    let id: string | undefined = ownerId;
    while (id) {
      if (visited.has(id)) return false; visited.add(id);
      const user = users.find(u => u.id === id);
      if (!user || user.status !== 'active') return false;
      id = user.parentId;
    }
    return true;
  };
  registerSsh(app, { authenticate, read: readSsh, write: state => { writeJsonAtomically(sshFile, state); },
    key: process.env.MASTER_SECRET!, nodes: readExternalNodes, audit: logAudit, users: loadUsers,
    ownerActive: sshOwnerActive,
    canManage: (actor, ownerId) => canManageToken(actor, ownerId, loadUsers()),
    charge: (payerId, quotaGb, id, renewal) => {
      const users = loadUsers(); const payer = users.find(u => u.id === payerId);
      if (!payer || !sshOwnerActive(payerId) || (payer.role === 'RESELLER' && payer.credits < quotaGb)) return false;
      const balance = payer.credits;
      if (payer.role === 'RESELLER') payer.credits = Math.round((payer.credits - quotaGb) * 1e6) / 1e6;
      payer.totalBandwidthAllocatedGb += quotaGb;
      if (!renewal) payer.totalTokensCreated++;
      saveUsers(users);
      logTransaction({resellerId:payer.id,resellerName:payer.name,type:renewal?'SSH_RENEW':'SSH_SALE',amountGb:quotaGb,
        balanceBefore:balance,balanceAfter:payer.credits,note:`${renewal?'Renouvellement':'Vente'} SSH ${id}`});
      return true;
    } });
  const nodesFile=path.resolve(dataDir,'nodes.json');
  const fullSnapshot=async()=>({version:3,ssh:readSsh(),auditLogs:loadAuditLogs(),auditEvents:await storage.exportAudit(),masterKeyId:crypto.createHash('sha256').update(process.env.MASTER_SECRET!).digest('hex').slice(0,16),users:loadUsers(),tokens:loadTokens().map(backupClientToken),masterConfig:(()=>{const {secretPassphrase,...config}=loadMasterConfig();return config;})(),protocolConfigs:loadProtocolConfigs(),transactions:loadTransactions(),plans:loadPlans(),requests:loadRequests(),appVersion:loadAppVersionConfig(),announcements:loadAnnouncements(),security:{mfa:security.state().mfa,sessions:{}},commerce:hasDocument(commerceFile)?readDocument(commerceFile):{orders:[]},nodes:hasDocument(nodesFile)?readDocument(nodesFile):[]});
  const restoreSnapshot=async(snapshot:any)=>{
    if(!snapshot || snapshot.masterKeyId!==crypto.createHash('sha256').update(process.env.MASTER_SECRET!).digest('hex').slice(0,16) || !validRestoredUsers(snapshot.users)||!Array.isArray(snapshot.tokens)||!Array.isArray(snapshot.plans)||!Array.isArray(snapshot.protocolConfigs))throw new Error('Invalid snapshot');
    // Keep a verified encrypted pre-restore snapshot; PostgreSQL commits all aggregates together.
    writeJsonAtomically(path.resolve(backupsDir,`pre-restore-${Date.now()}.encrypted.json`),encryptedBackup(await fullSnapshot(),process.env.BACKUP_ENCRYPTION_KEY||process.env.MASTER_SECRET!));
    saveMasterConfig(snapshot.masterConfig);saveProtocolConfigs(snapshot.protocolConfigs);saveUsers(snapshot.users);saveTokens(snapshot.tokens);savePlans(snapshot.plans);
    if(Array.isArray(snapshot.requests))saveRequests(snapshot.requests);
    if(Array.isArray(snapshot.transactions))writeJsonAtomically(transactionsFile,snapshot.transactions);
    if(snapshot.appVersion)saveAppVersionConfig(snapshot.appVersion);
    if(Array.isArray(snapshot.announcements))saveAnnouncements(snapshot.announcements);
    if(snapshot.commerce)writeJsonAtomically(commerceFile,snapshot.commerce);
    writeJsonAtomically(sshFile, snapshot.ssh || { accounts: [] });
    if(Array.isArray(snapshot.nodes))writeJsonAtomically(nodesFile,snapshot.nodes);
    writeJsonAtomically(securityFile,{mfa:snapshot.security?.mfa||{},sessions:{}});
    if(Array.isArray(snapshot.auditEvents))storage.importAudit(snapshot.auditEvents);
  };
  registerOperations(app,{authenticate,limiter:publicApiRateLimiter,ops:operations,snapshot:fullSnapshot,restore:restoreSnapshot,readNodes:()=>hasDocument(nodesFile)?readDocument(nodesFile):[],saveNodes:v=>{writeJsonAtomically(nodesFile,v);},audit:logAudit,
    nodeConfig: node => ({ format: 'abess-external-inventory-v1', host: node.host,
      licences: loadTokens().filter(token => protocolConfigForToken(token)?.serverHost === node.host).map(token => ({
        id: token.id, clientUuid: token.clientUuid, trafficId: xrayUserEmail(token), status: token.status,
        expiresAt: token.expiresAt, bandwidthGb: token.bandwidthGb, bandwidthUsedGb: token.bandwidthUsedGb, deviceLimit: token.deviceLimit,
        enabled: token.status === 'active' && Date.parse(token.expiresAt) > Date.now() && token.bandwidthUsedGb < token.bandwidthGb
      })),
      sshAccounts: readSsh().accounts.filter(account => account.nodeId === node.id).map(account => ({
        id: account.id, username: account.username, enabled: account.enabled && sshOwnerActive(account.resellerId) && Date.parse(account.expiresAt) > Date.now() && account.usedBytes < account.quotaBytes,
        expiresAt: account.expiresAt, quotaBytes: account.quotaBytes, usedBytes: account.usedBytes, maxConnections: account.maxConnections
      })) }),
    nodeUsage: (node, snapshot) => {
      const counters = new Map<string, number>(snapshot.stat.map((item: any) => [item.name, Number(item.value)]));
      const tokens = loadTokens();
      const previous = node.counters || {};
      const next = node.generation === snapshot.generation ? {...previous} : {};
      for (const token of tokens.filter(t => protocolConfigForToken(t)?.serverHost === node.host)) {
        let delta = 0;
        for (const direction of ['uplink', 'downlink']) {
          const canonical = `user>>>${xrayUserEmail(token)}>>>traffic>>>${direction}`;
          const key = counters.has(canonical) ? canonical : `user>>>${token.clientUuid}>>>traffic>>>${direction}`;
          if (!counters.has(key)) continue;
          const value = counters.get(key)!;
          const old = next[canonical] || 0;
          // A reset requires a new generation; out-of-order counters never add traffic.
          if (value < old) throw new Error('Counter decreased within one generation');
          delta += value - old;
          next[canonical] = value;
        }
        if (delta > 0) {
          token.bandwidthUsedGb += delta / 1024 ** 3;
          if (token.status === 'active' && token.bandwidthUsedGb >= token.bandwidthGb) token.status = 'quota_exceeded';
        }
      }
      const ssh = readSsh();
      for (const account of ssh.accounts.filter(a => a.nodeId === node.id)) account.online = 0;
      for (const sample of snapshot.accounts || []) {
        const account = ssh.accounts.find(a => a.nodeId === node.id && a.id === sample.id);
        if (!account) continue;
        const counterKey = `ssh:${account.id}`;
        const old = next[counterKey] || 0;
        if (sample.usedBytes < old) throw new Error('SSH counter decreased');
        account.usedBytes += sample.usedBytes - old;
        account.online = sample.online || 0;
        account.usageObservedAt = snapshot.observedAt;
        next[counterKey] = sample.usedBytes;
      }
      node.generation = snapshot.generation;
      node.counters = next;
      node.online = tokens.filter(t => protocolConfigForToken(t)?.serverHost === node.host).reduce((total, token) => {
        const primary = `user>>>${xrayUserEmail(token)}>>>online`;
        return total + (counters.get(primary) ?? counters.get(`user>>>${token.clientUuid}>>>online`) ?? 0);
      }, 0) + ssh.accounts.filter(a => a.nodeId === node.id).reduce((total, a) => total + (a.online || 0), 0);
      writeJsonAtomically(sshFile, ssh);
      saveTokens(tokens);
    }
  });

  // Helper: recursive list of all sub-reseller IDs
  function getSubResellerIdsRecursive(parentId: string, allUsers: AppUser[]): string[] {
    const visited = new Set<string>([parentId]);
    const pending = [parentId];
    const ids: string[] = [];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const child of allUsers) {
        if (child.role !== 'RESELLER' || child.parentId !== current || visited.has(child.id)) continue;
        visited.add(child.id);
        ids.push(child.id);
        pending.push(child.id);
      }
    }
    return ids;
  }

  function canManageToken(user: AppUser, targetResellerId: string, allUsers: AppUser[]): boolean {
    if (user.role === 'SUPER_ADMIN') return true;
    if (targetResellerId === user.id) return true;
    const descendantIds = new Set(getSubResellerIdsRecursive(user.id, allUsers));
    return descendantIds.has(targetResellerId);
  }

  // ==========================================
  // 2. RESELLER & SUB-RESELLER MANAGEMENT
  // (Super Admins manage all; Resellers manage their own sub-resellers)
  // ==========================================
  app.get('/api/v1/admin/resellers', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'RESELLER') {
      res.status(403).json({ error: 'Accès non autorisé.' });
      return;
    }

    const users = loadUsers();
    if (user.role === 'SUPER_ADMIN') {
      const resellers = users
        .filter(u => u.role === 'RESELLER')
        .map(({ passwordHash, ...rest }) => ({
          ...rest,
          subResellersCount: users.filter(sub => sub.role === 'RESELLER' && sub.parentId === rest.id).length
        }));
      res.json(resellers);
    } else {
      // Resellers see their own sub-resellers
      const resellers = users
        .filter(u => u.role === 'RESELLER' && u.parentId === user.id)
        .map(({ passwordHash, ...rest }) => ({
          ...rest,
          subResellersCount: users.filter(sub => sub.role === 'RESELLER' && sub.parentId === rest.id).length
        }));
      res.json(resellers);
    }
  });

  app.post('/api/v1/admin/resellers', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'RESELLER') {
      res.status(403).json({ error: 'Accès non autorisé.' });
      return;
    }

    const { email, password, name, initialCredits } = req.body;
    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, mot de passe et nom requis pour le revendeur.' });
      return;
    }

    const requestedCredits = initialCredits === undefined ? 0 : Number(initialCredits);
    if (!Number.isFinite(requestedCredits) || requestedCredits < 0 || requestedCredits > 1000000) {
      res.status(400).json({ error: 'Le crédit initial doit être un nombre fini compris entre 0 et 1000000 Go.' });
      return;
    }

    const users = loadUsers();
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase().trim())) {
      res.status(400).json({ error: 'Un compte avec cet email existe déjà.' });
      return;
    }

    const dbUser = users.find(u => u.id === user.id);
    if (!dbUser) {
      res.status(401).json({ error: 'Utilisateur introuvable.' });
      return;
    }

    let parentCreditBefore: number | null = null;
    if (user.role === 'RESELLER') {
      if (dbUser.status !== 'active') {
        res.status(403).json({ error: 'Votre compte est suspendu. Impossible de créer un sous-revendeur.' });
        return;
      }
      if (requestedCredits > dbUser.credits) {
        res.status(400).json({
          error: `Solde insuffisant ! Votre solde actuel est de ${dbUser.credits} Go. Impossible d'allouer ${requestedCredits} Go.`
        });
        return;
      }

      // Deduct credits from parent reseller
      parentCreditBefore = dbUser.credits;
      dbUser.credits = Math.max(0, dbUser.credits - requestedCredits);
    }

    const newReseller: AppUser = {
      id: 'usr_reseller_' + crypto.randomUUID(),
      email: email.toLowerCase().trim(),
      passwordHash: hashPassword(password),
      name: name.trim(),
      role: 'RESELLER',
      credits: requestedCredits,
      totalTokensCreated: 0,
      totalBandwidthAllocatedGb: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      parentId: user.id,
      parentName: user.name
    };

    users.push(newReseller);
    saveUsers(users);

    if (parentCreditBefore !== null && requestedCredits > 0) {
      logTransaction({
        resellerId: dbUser.id,
        resellerName: dbUser.name,
        type: 'SUB_RESELLER_CREATE',
        amountGb: requestedCredits,
        balanceBefore: parentCreditBefore,
        balanceAfter: dbUser.credits,
        note: `Création du sous-revendeur ${name.trim()} (${requestedCredits} Go transférés)`
      });
    }

    if (requestedCredits > 0) {
      logTransaction({
        resellerId: newReseller.id,
        resellerName: newReseller.name,
        type: 'CREDIT_ADD',
        amountGb: requestedCredits,
        balanceBefore: 0,
        balanceAfter: requestedCredits,
        note: `Solde d'ouverture alloué par ${user.name}`
      });
    }

    const { passwordHash, ...safeReseller } = newReseller;
    res.status(201).json({
      ...safeReseller,
      subResellersCount: 0
    });
  });

  // Credit / Recharge Reseller
  app.put('/api/v1/admin/resellers/:id/credit', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'RESELLER') {
      res.status(403).json({ error: 'Accès non autorisé.' });
      return;
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      res.status(400).json({ error: 'Montant de crédit numérique non nul requis.' });
      return;
    }

    const users = loadUsers();
    const reseller = users.find(u => u.id === req.params.id && u.role === 'RESELLER');
    if (!reseller) {
      res.status(404).json({ error: 'Revendeur introuvable.' });
      return;
    }

    const dbUser = users.find(u => u.id === user.id);
    if (!dbUser) {
      res.status(401).json({ error: 'Utilisateur introuvable.' });
      return;
    }

    if (user.role === 'RESELLER') {
      if (reseller.parentId !== user.id) {
        res.status(403).json({ error: 'Vous ne pouvez créditer que vos propres sous-revendeurs.' });
        return;
      }

      if (amount > 0) {
        if (dbUser.credits < amount) {
          res.status(400).json({
            error: `Solde insuffisant ! Votre solde est de ${dbUser.credits} Go. Requis : ${amount} Go.`
          });
          return;
        }

        const parentPrev = dbUser.credits;
        dbUser.credits = Math.max(0, dbUser.credits - amount);

        const childPrev = reseller.credits;
        reseller.credits += amount;

        saveUsers(users);

        logTransaction({
          resellerId: dbUser.id,
          resellerName: dbUser.name,
          type: 'CREDIT_TRANSFER',
          amountGb: amount,
          balanceBefore: parentPrev,
          balanceAfter: dbUser.credits,
          note: `Transfert de ${amount} Go vers le sous-revendeur ${reseller.name}`
        });

        logTransaction({
          resellerId: reseller.id,
          resellerName: reseller.name,
          type: 'CREDIT_ADD',
          amountGb: amount,
          balanceBefore: childPrev,
          balanceAfter: reseller.credits,
          note: req.body?.note || `Recharge de ${amount} Go reçue de ${dbUser.name}`
        });

        res.json({
          success: true,
          resellerId: reseller.id,
          name: reseller.name,
          newCredits: reseller.credits,
          parentCredits: dbUser.credits
        });
        return;
      } else {
        const reclaim = Math.abs(amount);
        if (reseller.credits < reclaim) {
          res.status(400).json({
            error: `Le sous-revendeur ne dispose que de ${reseller.credits} Go. Impossible de récupérer ${reclaim} Go.`
          });
          return;
        }

        const childPrev = reseller.credits;
        reseller.credits -= reclaim;

        const parentPrev = dbUser.credits;
        dbUser.credits += reclaim;

        saveUsers(users);

        logTransaction({
          resellerId: dbUser.id,
          resellerName: dbUser.name,
          type: 'CREDIT_ADD',
          amountGb: reclaim,
          balanceBefore: parentPrev,
          balanceAfter: dbUser.credits,
          note: `Récupération de ${reclaim} Go du sous-revendeur ${reseller.name}`
        });

        logTransaction({
          resellerId: reseller.id,
          resellerName: reseller.name,
          type: 'CREDIT_TRANSFER',
          amountGb: -reclaim,
          balanceBefore: childPrev,
          balanceAfter: reseller.credits,
          note: `Déduction de ${reclaim} Go par le revendeur parent ${dbUser.name}`
        });

        res.json({
          success: true,
          resellerId: reseller.id,
          name: reseller.name,
          newCredits: reseller.credits,
          parentCredits: dbUser.credits
        });
        return;
      }
    }

    // SUPER_ADMIN
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
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'RESELLER') {
      res.status(403).json({ error: 'Accès non autorisé.' });
      return;
    }

    const { status } = req.body || {};
    if (status !== 'active' && status !== 'suspended') {
      res.status(400).json({ error: 'Le statut doit être active ou suspended.' });
      return;
    }
    const users = loadUsers();
    const reseller = users.find(u => u.id === req.params.id && u.role === 'RESELLER');
    if (!reseller) {
      res.status(404).json({ error: 'Revendeur introuvable.' });
      return;
    }

    if (user.role === 'RESELLER' && reseller.parentId !== user.id) {
      res.status(403).json({ error: 'Vous ne pouvez modifier le statut que de vos propres sous-revendeurs.' });
      return;
    }

    reseller.status = status === 'suspended' ? 'suspended' : 'active';
    saveUsers(users);

    res.json({ success: true, status: reseller.status });
  });

  // Delete a reseller and its full descendant branch. Outstanding credits are
  // returned to the direct parent; every associated licence and session is revoked.
  app.delete('/api/v1/admin/resellers/:id', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'RESELLER') {
      res.status(403).json({ error: 'Accès non autorisé.' });
      return;
    }

    const users = loadUsers();
    const originalUsersSnapshot = users.map(account => ({ ...account }));
    const target = users.find(u => u.id === req.params.id && u.role === 'RESELLER');
    if (!target) {
      res.status(404).json({ error: 'Revendeur introuvable.' });
      return;
    }

    if (user.role === 'RESELLER' && target.parentId !== user.id) {
      res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres sous-revendeurs.' });
      return;
    }

    const descendantIds = new Set([target.id, ...getSubResellerIdsRecursive(target.id, users)]);
    const branchUsers = users.filter(candidate => descendantIds.has(candidate.id));
    const branchTokens = loadTokens();
    const tokensToRevoke = branchTokens.filter(token =>
      descendantIds.has(token.resellerId) && token.status === 'active'
    );
    const updatedTokens = branchTokens.map(token =>
      descendantIds.has(token.resellerId) && token.status === 'active'
        ? { ...token, status: 'revoked' as const }
        : token
    );

    let refundedCredits = 0;
    if (user.role === 'RESELLER') {
      const dbUser = users.find(candidate => candidate.id === user.id);
      if (!dbUser || dbUser.status !== 'active') {
        res.status(401).json({ error: 'Compte parent introuvable ou suspendu.' });
        return;
      }

      refundedCredits = branchUsers.reduce((total, branchUser) => {
        const credits = Number(branchUser.credits);
        if (!Number.isFinite(credits) || credits < 0) {
          throw new Error(`Solde invalide pour le revendeur ${branchUser.id}; suppression annulée.`);
        }
        return total + credits;
      }, 0);

      if (!Number.isFinite(refundedCredits) || refundedCredits > 1000000000) {
        res.status(409).json({ error: 'Le total des crédits de la branche est invalide; suppression annulée.' });
        return;
      }
      dbUser.credits += refundedCredits;
    }

    // Persist the account and licence changes as one recoverable operation.
    // Each JSON file is written atomically; if the second write fails, restore
    // the original token store and its Xray projection before returning.
    const filteredUsers = users.filter(candidate => !descendantIds.has(candidate.id));
    try {
      saveTokens(updatedTokens);
      saveUsers(filteredUsers);
    } catch {
      try {
        saveTokens(branchTokens);
        saveUsers(originalUsersSnapshot);
      } catch (rollbackError) {
        console.error('[RESELLER DELETE] Rollback failed; restore the latest data backup before further writes.', rollbackError);
      }
      res.status(500).json({ error: 'Suppression interrompue. Les fichiers de données ont été restaurés lorsque possible; vérifiez les sauvegardes avant de réessayer.' });
      return;
    }

    for (const [sessionToken, session] of activeSessions.entries()) {
      if (descendantIds.has(session.userId)) activeSessions.delete(sessionToken);
    }

    for (const token of tokensToRevoke) {
      logTransaction({
        resellerId: token.resellerId,
        resellerName: token.resellerName,
        type: 'TOKEN_REVOKE',
        amountGb: 0,
        balanceBefore: 0,
        balanceAfter: 0,
        note: `Révocation automatique de la licence ${token.token} après suppression de la branche revendeur.`
      });
    }

    if (user.role === 'RESELLER' && refundedCredits > 0) {
      const parent = filteredUsers.find(candidate => candidate.id === user.id);
      logTransaction({
        resellerId: user.id,
        resellerName: user.name,
        type: 'RESELLER_DELETE_REFUND',
        amountGb: refundedCredits,
        balanceBefore: Number(parent?.credits || 0) - refundedCredits,
        balanceAfter: Number(parent?.credits || 0),
        note: `Remboursement de ${refundedCredits} Go pour suppression de la branche ${target.name} (${descendantIds.size} compte(s)).`
      });
    }

    logAudit({
      actor: user.name,
      role: user.role,
      action: 'RESELLER_BRANCH_DELETE',
      details: `Suppression de la branche ${target.name}: ${descendantIds.size} compte(s), ${tokensToRevoke.length} licence(s) révoquée(s), ${refundedCredits} Go remboursés.`
    });

    res.json({
      success: true,
      deletedCount: descendantIds.size,
      revokedTokenCount: tokensToRevoke.length,
      refundedCreditsGb: refundedCredits
    });
  });

  // ==========================================
  // 3. TOKENS CREATION & MANAGEMENT
  // (Resellers see their tokens and sub-resellers' tokens)
  // ==========================================
  app.get('/api/v1/admin/tokens', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const tokens = loadTokens();

    if (user.role === 'SUPER_ADMIN') {
      // Super Admin sees all tokens with full reseller visibility
      res.json(tokens.map(safeClientToken));
    } else {
      // Reseller sees his own tokens AND tokens created by his sub-resellers
      const users = loadUsers();
      const scopeIds = new Set([user.id, ...getSubResellerIdsRecursive(user.id, users)]);
      const myTokens = tokens.filter(t => scopeIds.has(t.resellerId));
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
    const isSsh = String(req.body?.protocolType || req.body?.protocol || req.body?.type || '').toLowerCase() === 'ssh' ||
                  (selected && selected.protocol === 'ssh');
    const profile = selected || (configs.length === 1 && !configurationId ? configs[0] : undefined);
    if (isSsh || profile?.protocol === 'ssh') {
      res.status(503).json({
        error: 'La création de licences SSH est suspendue : aucun provisionneur SSH sécurisé n’est connecté au control plane. Utilisez un profil VLESS opérationnel.'
      });
      return;
    }
    if (profile && !isXrayProtocol(profile.protocol)) {
      res.status(400).json({ error: 'Seul le protocole VLESS est provisionné par ce serveur.' });
      return;
    }
    if (!profile) {
      res.status(409).json({
        error: configs.length === 0
          ? 'Aucune configuration VPN n’est disponible. Le Super Administrateur doit en créer une dans Infrastructure.'
          : 'Sélectionnez la configuration VPN à associer à ce token.'
      });
      return;
    }
    if (profile && profile.protocol !== 'ssh') {
      const profileSniError = tlsSniValidationError(profile.transport, profile.sniHost,profile.serverHost);
      if (!isValidPublicHost(profile.serverHost) || profileSniError) {
        res.status(409).json({
          error: profileSniError || 'Cette configuration ne dispose pas d’une adresse de destination valide.'
        });
        return;
      }
    }
    const finalToken = String(token || generateUnifiedToken()).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{3,63}$/.test(finalToken)) {
      res.status(400).json({ error: 'Le code token doit contenir 4 à 64 caractères parmi A-Z, 0-9, tiret et soulignement.' });
      return;
    }
    if (loadTokens().some(existing => existing.token.toUpperCase() === finalToken)) {
      res.status(409).json({ error: 'Ce code token existe déjà. Générez-en un autre.' });
      return;
    }
    const trafficId = req.body?.trafficId === undefined ? undefined : String(req.body.trafficId).trim();
    if (trafficId !== undefined && !/^[a-zA-Z0-9_.@+\-]{1,128}$/.test(trafficId)) { res.status(400).json({error:'Identifiant trafic invalide.'}); return; }
    const clientUuid = String(req.body?.clientUuid || crypto.randomUUID()).toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(clientUuid)) {
      res.status(400).json({error: 'UUID invalide.'}); return;
    }
    if (loadTokens().some(t => protocolConfigForToken(t)?.serverHost === profile.serverHost &&
      [t.clientUuid, xrayUserEmail(t)].some(id => id === clientUuid || (trafficId !== undefined && id === trafficId)))) {
      res.status(409).json({error: 'UUID déjà associé à une licence sur cet hôte.'}); return;
    }
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
      vpnName: 'AbessVpn',
      token: finalToken,
      bandwidthGb: requestedGb,
      expiresAt: calculatedExpiresAt,
      allowedDeviceId: allowedDeviceId || undefined,
      configurationId: profile!.id,
      configurationName: profile!.name,
      serverHost: profile!.serverHost,
      host: profile!.host || profile!.serverHost,
      serverPort: xrayPublicPort(profile!.protocol, profile!.transport, profile!.serverPort),
      path: xrayProfilePath(profile!.protocol as XrayProtocol, profile!.transport as XrayTransport, profile!.path),
      sniHost: profile!.sniHost,
      uuid: clientUuid,
      protocol: 'vless',
      transport: profile!.transport,
      security: profile!.transport === 'tcp' ? 'none' : 'tls'
    };
    const encryptedLink = encryptConfig(encryptedPayload, masterSecret);
    const directLink = buildDirectProtocolUrl({ token: finalToken, clientUuid } as any, profile!);

    const tokens = loadTokens();
    const newToken: ClientToken = {
      id: 'tok_' + crypto.randomUUID(), token: finalToken, clientUuid, trafficId,
      resellerId: user.id, resellerName: user.name,
      plan: String(plan || `${requestedGb} GO CYBER VIP`).trim().slice(0, 80),
      bandwidthGb: requestedGb, bandwidthUsedGb: 0, expiresAt: calculatedExpiresAt, days: daysRemaining,
      deviceLimit: clientLimit, deviceIds: [], allowedDeviceId: allowedDeviceId || undefined,
      customerNote, customerContact,
      connectionCount: 0, lastSeenAt: null, lastSeenIp: null,
      status: 'active',
      configurationId: profile!.id,
      configurationName: profile!.name,
      configurationSnapshot: publicProtocolConfig(profile!),
      protocolType: 'vless',
      encryptedLink,
      directLink,
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

  app.post('/api/v1/admin/tokens/:id/renew',authenticate,(req,res)=>{
    const actor=(req as any).user as AppUser;
    const idempotency=String(req.headers['idempotency-key']||'');
    const quota=Number(req.body?.additionalGb);const days=Number(req.body?.days);
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(idempotency)||!Number.isFinite(quota)||quota<1||quota>100000||!Number.isInteger(days)||days<1||days>365)return res.status(400).json({error:'Clé de requête, quota (1–100000 Go) et durée (1–365 jours) requis.'});
    const users=loadUsers();const tokens=loadTokens();const target=tokens.find(t=>t.id===req.params.id);
    if(!target)return res.sendStatus(404);
    if(!canManageToken(actor,target.resellerId,users))return res.sendStatus(403);
    const renewalId=crypto.createHash('sha256').update(actor.id+':'+idempotency).digest('hex');
    if(target.renewalIds?.includes(renewalId))return res.json(safeClientToken(target));
    if(target.status==='revoked'||target.protocolType==='ssh'||target.sshConfig)return res.status(409).json({error:'Réactivez la licence autorisée avant de la renouveler.'});
    const account=users.find(u=>u.id===actor.id)!;
    if(actor.role==='RESELLER'&&account.credits<quota)return res.status(409).json({error:'Solde insuffisant.'});
    if(target.bandwidthGb+quota>1000000)return res.status(400).json({error:'Quota total trop élevé.'});
    const balance=account.credits;if(actor.role==='RESELLER')account.credits-=quota;
    account.totalBandwidthAllocatedGb+=quota;target.bandwidthGb+=quota;
    target.expiresAt=new Date(Math.max(Date.now(),Date.parse(target.expiresAt)||0)+days*86400000).toISOString();
    target.days=Math.ceil((Date.parse(target.expiresAt)-Date.now())/86400000);target.status='active';
    target.renewalIds=[...(target.renewalIds||[]),renewalId];
    target.encryptedLink=encryptConfig({v:3,token:target.token},process.env.MASTER_SECRET!);
    saveUsers(users);saveTokens(tokens);
    logTransaction({resellerId:actor.id,resellerName:actor.name,type:'TOKEN_RENEW',amountGb:quota,balanceBefore:balance,balanceAfter:account.credits,note:`Renouvellement de la licence ${target.id} : ${days} jours.`});
    logAudit({actor:actor.id,role:actor.role,action:'TOKEN_RENEW',details:target.id});
    res.json(safeClientToken(target));
  });

  app.post('/api/v1/admin/tokens/:id/migrate-tls',authenticate,(req,res)=>{
    const actor=(req as any).user as AppUser;if(actor.role!=='SUPER_ADMIN')return res.sendStatus(403);
    const tokens=loadTokens();const target=tokens.find(t=>t.id===req.params.id);const profile=loadProtocolConfigs().find(p=>p.id===req.body?.configurationId);
    if(!target)return res.sendStatus(404);
    if(!profile||!isTlsWebTransport(profile.transport)||tlsSniValidationError(profile.transport,profile.sniHost,profile.serverHost))return res.status(400).json({error:'Sélectionnez un profil TLS opérationnel.'});
    target.configurationId=profile.id;target.configurationName=profile.name;target.configurationSnapshot=publicProtocolConfig(profile);
    target.encryptedLink=encryptConfig({v:3,token:target.token},process.env.MASTER_SECRET!);target.directLink=buildDirectProtocolUrl(target,profile);
    saveTokens(tokens);logAudit({actor:actor.id,role:actor.role,action:'TOKEN_TLS_MIGRATION',details:target.id});
    res.json({token:safeClientToken(target),message:'Profil migré. Le client doit réimporter sa licence.'});
  });

  // Batch / Bulk Token Generation for commercial vouchers & scratch cards
  app.post('/api/v1/admin/tokens/batch', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    const count = req.body?.count === undefined ? 5 : Number(req.body.count);
    const requestedGb = req.body?.bandwidthGb === undefined ? 50 : Number(req.body.bandwidthGb);
    const days = req.body?.days === undefined ? 30 : Number(req.body.days);
    const rawDeviceLimit = req.body?.deviceLimit === undefined ? 2 : Number(req.body.deviceLimit);

    if (!Number.isInteger(count) || count < 1 || count > 200) {
      res.status(400).json({ error: 'La quantité du lot doit être un entier compris entre 1 et 200.' });
      return;
    }
    if (!Number.isFinite(requestedGb) || requestedGb < 1 || requestedGb > 100000) {
      res.status(400).json({ error: 'Le quota unitaire doit être compris entre 1 et 100000 Go.' });
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      res.status(400).json({ error: 'La durée du lot doit être un entier compris entre 1 et 3650 jours.' });
      return;
    }
    if (!Number.isInteger(rawDeviceLimit) || rawDeviceLimit < 1 || rawDeviceLimit > 10) {
      res.status(400).json({ error: 'La limite d’appareils doit être un entier compris entre 1 et 10.' });
      return;
    }

    const clientLimit = rawDeviceLimit;
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
    if (String(profile.protocol) !== 'vless') {
      res.status(503).json({
        error: 'La génération de lots SSH/autres protocoles est suspendue : seul VLESS est provisionné par le moteur Xray actuel.'
      });
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
      const finalToken = generateUnifiedToken();
      const clientUuid = crypto.randomUUID();
      const encryptedPayload = {
        vpnName: 'AbessVpn',
        token: finalToken,
        bandwidthGb: requestedGb,
        expiresAt: calculatedExpiresAt,
        configurationId: profile.id,
        configurationName: profile.name,
        serverHost: profile.serverHost,
        host: profile.host || profile.serverHost,
        serverPort: xrayPublicPort(profile.protocol, profile.transport, profile.serverPort),
        path: xrayProfilePath(profile.protocol as XrayProtocol, profile.transport as XrayTransport, profile.path),
        sniHost: profile.sniHost,
        uuid: clientUuid,
        protocol: 'vless',
        transport: profile.transport,
        security: profile.transport === 'tcp' ? 'none' : 'tls'
      };
      const encryptedLink = encryptConfig(encryptedPayload, masterSecret);
      const directLink = buildDirectProtocolUrl({ token: finalToken, clientUuid } as any, profile);

      const newToken: ClientToken = {
        id: 'tok_' + crypto.randomUUID(),
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
        protocolType: 'vless',
        encryptedLink,
        directLink,
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
    const allUsers = loadUsers();
    if (!canManageToken(user, target.resellerId, allUsers)) {
      res.status(403).json({ error: 'Vous ne pouvez réinitialiser que vos propres licences ou celles de vos sous-revendeurs.' });
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

  // Legacy plaintext backups are retired. Use encrypted /api/v1/admin/system/backup
  // and /api/v1/admin/system/restore with the documented authenticated encryption format.
  app.get('/api/v1/admin/backup', authenticate, (_req, res) => {
    res.status(410).json({ error: 'Export JSON non chiffré retiré. Utilisez la sauvegarde système chiffrée.' });
  });
  app.post('/api/v1/admin/backup/restore', authenticate, (_req, res) => {
    res.status(410).json({ error: 'Restauration JSON non chiffrée retirée. Utilisez la restauration système chiffrée.' });
  });

  async function performAutoBackup(): Promise<void> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const backupFile = path.resolve(backupsDir, `abessvpn-auto-${today}.encrypted.json`);
      const backupData=encryptedBackup(await fullSnapshot(),process.env.BACKUP_ENCRYPTION_KEY||process.env.MASTER_SECRET!);
      writeJsonAtomically(backupFile,backupData);
      storage.afterCommit(()=>{
        operations.lastBackup={at:new Date().toISOString(),offsite:false};
        void uploadBackup(path.basename(backupFile),backupData).then(offsite=>{operations.lastBackup={at:new Date().toISOString(),offsite};}).catch(()=>{operations.lastBackup={at:new Date().toISOString(),offsite:false,error:'Upload failed'};});
      });

      const files = fs.readdirSync(backupsDir);
      const autoFiles = files
        .filter(f => f.startsWith('abessvpn-auto-') && f.endsWith('.json'))
        .sort()
        .reverse();
      if (autoFiles.length > 7) {
        for (const oldFile of autoFiles.slice(7)) {
          try {
            fs.unlinkSync(path.resolve(backupsDir, oldFile));
          } catch {}
        }
      }
    } catch (err) {
      console.error('[AutoBackup] Erreur lors de la sauvegarde automatique:', err);
    }
  }

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
    const allUsers = loadUsers();
    if (!canManageToken(user, target.resellerId, allUsers)) {
      res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres licences ou celles de vos sous-revendeurs.' });
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

    const allUsers = loadUsers();
    if (!canManageToken(user, targetToken.resellerId, allUsers)) {
      res.status(403).json({ error: 'Vous ne pouvez révoquer que vos propres tokens clients ou ceux de vos sous-revendeurs.' });
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
    const { secretPassphrase: _secretPassphrase, ...safeConfig } = loadMasterConfig();
    res.json(safeConfig);
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
    const isSsh = String(req.body?.protocol || '').toLowerCase() === 'ssh';
    if (!isSsh) {
      const sniError = tlsSniValidationError(
        String(req.body?.transport ?? 'ws').toLowerCase(),
        req.body?.sniHost,req.body?.serverHost
      );
      if (sniError) {
        res.status(400).json({ error: sniError });
        return;
      }
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
    refreshTrafficTotals();
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
    const isSsh = String(req.body?.protocol ?? configs[index].protocol).toLowerCase() === 'ssh';
    if (!isSsh) {
      const sniError = tlsSniValidationError(
        String(req.body?.transport ?? configs[index].transport).toLowerCase(),
        req.body?.sniHost ?? configs[index].sniHost,req.body?.serverHost ?? configs[index].serverHost
      );
      if (sniError) {
        res.status(400).json({ error: sniError });
        return;
      }
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
    refreshTrafficTotals();
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
    refreshTrafficTotals(tokens);
    res.json({ success: true, configs: remaining.map(publicProtocolConfig) });
  });

  app.put('/api/v1/admin/server-config', authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'ACCÈS REFUSÉ : Seul le Super Administrateur peut modifier l\'infrastructure.' });
      return;
    }

    const current = loadMasterConfig();
    const requestedProtocol = 'vless';
    const requestedTransport = String(req.body?.transport ?? current.transport).toLowerCase();
    if (!isXrayTransport(requestedTransport)) {
      res.status(400).json({
        success: false,
        error: 'Transports supportés pour VLESS TCP : tcp (direct), ws, grpc, httpupgrade, xhttp.'
      });
      return;
    }
    const requestedHost = typeof req.body?.serverHost === 'string' ? req.body.serverHost.trim() : current.serverHost;
    const requestedHeaderHost = typeof req.body?.host === 'string' ? req.body.host.trim() : current.host;
    const requestedSni = typeof req.body?.sniHost === 'string' ? req.body.sniHost.trim() : current.sniHost;
    const sniError = tlsSniValidationError(String(requestedTransport), requestedSni,requestedHost);
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
    const effectivePort = Number(req.body?.serverPort ?? current.serverPort);
    const requestedPath = String(req.body?.path ?? current.path);
    if (!Number.isInteger(effectivePort) || effectivePort < 1 || effectivePort > 65535 || requestedPath.length > 2048 || /[\r\n\x00]/.test(requestedPath)) {
      res.status(400).json({error:'Port ou chemin invalide.'}); return;
    }
    const updated: MasterServerConfig = {
      ...current,
      ...req.body,
      serverHost: requestedHost,
      host: requestedHeaderHost,
      sniHost: requestedTransport === 'tcp' ? '' : requestedSni,
      serverPort: effectivePort,
      protocol: requestedProtocol,
      transport: requestedTransport,
      path: requestedPath,
      secretPassphrase: process.env.MASTER_SECRET || current.secretPassphrase
    };
    saveMasterConfig(updated);
    refreshTrafficTotals();
    const { secretPassphrase: _secretPassphrase, ...safeConfig } = updated;
    res.json({ success: true, config: safeConfig });
  });

  // ==========================================
  // 5. GLOBAL METRICS & STATS
  // ==========================================
  app.get('/api/v1/admin/stats', authenticate, (req, res) => {
    refreshTrafficTotals();
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
      const users = loadUsers();
      const mySubResellers = users.filter(u => u.role === 'RESELLER' && u.parentId === user.id);
      const scopeIds = new Set([user.id, ...getSubResellerIdsRecursive(user.id, users)]);
      const myTokens = tokens.filter(t => scopeIds.has(t.resellerId));
      const myBandwidthAllocated = myTokens.reduce((sum, t) => sum + t.bandwidthGb, 0);
      const myBandwidthConsumed = myTokens.reduce((sum, t) => sum + t.bandwidthUsedGb, 0);

      res.json({
        role: 'RESELLER',
        creditsRemaining: user.credits,
        totalResellers: mySubResellers.length,
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
  app.get('/api/v1/admin/app-version', authenticate, (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
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
  app.get('/api/v1/admin/system/update-status', authenticate, async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
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
    const cleanToken = rawToken.toUpperCase();
    const found = tokens.find(t => t.token.toUpperCase() === cleanToken);
    const clientIp = req.ip || 'unknown';

    if (!found) {
      res.status(401).json({ valid: false, error: 'Token client non reconnu ou révoqué.' });
      return;
    }

    if (found.protocolType === 'ssh' || found.sshConfig) {
      res.status(410).json({
        valid: false,
        status: 'unsupported_protocol',
        error: 'Les anciennes licences SSH sont suspendues. Le provisionneur SSH sécurisé n’est pas disponible sur cette architecture.'
      });
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
      ? tlsSniValidationError(profile.transport, profile.sniHost,profile.serverHost)
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
      configurationId: profile!.id,
      configurationName: profile!.name,
      serverConfig: {
        address: profile!.serverHost,
        port: xrayPublicPort(profile!.protocol, profile!.transport, profile!.serverPort),
        path: xrayProfilePath(profile!.protocol as XrayProtocol, profile!.transport as XrayTransport, profile!.path),
        uuid: found.clientUuid || crypto.randomUUID(),
        sni: profile!.sniHost,
        host: profile!.host || profile!.serverHost,
        wsHost: profile!.host || profile!.serverHost,
        method: undefined,
        protocol: 'vless',
        transport: profile!.transport,
        security: profile!.transport === 'tcp' ? 'none' : 'tls',
        allowedDeviceId: found.allowedDeviceId || undefined
      }
    });
  };

  app.post('/api/v1/auth/token', publicApiRateLimiter, (req, res) => {
    validateMobileToken(req, res, req.body?.token, req.body?.deviceId);
  });

  // Decrypt panel-issued links on the server; the master secret never enters the mobile app.
  // Continue through the same expiry, quota, status, and device-limit validation as a typed token.
  app.post('/api/v1/auth/import-link', publicApiRateLimiter, (req, res) => {
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

  // Legacy SSH config endpoint retired: it could disclose stored plaintext passwords.
  app.get(['/api/v1/ssh/config/:token', '/ssh/config/:token'], publicApiRateLimiter, (_req, res) => {
    res.status(410).json({
      ok: false,
      error: 'La distribution des anciennes configurations SSH est désactivée. Aucun mot de passe SSH ne sera renvoyé par cette API.'
    });
  });

  // Presets of tested SSH HTTP Payloads (Orange Cameroon, MTN, Generic)
  app.get('/api/v1/ssh/payloads', (_req, res) => {
    res.json({
      default: DEFAULT_SSH_PAYLOAD,
      presets: [
        {
          id: 'orange_cm_batch',
          name: 'Orange Cameroun 0F (FoxNews • Batch • CloudFront)',
          carrier: 'Orange Cameroon',
          port: 80,
          payload: DEFAULT_SSH_PAYLOAD
        },
        {
          id: 'orange_cm_direct',
          name: 'Orange Cameroun Direct WS',
          carrier: 'Orange Cameroon',
          port: 80,
          payload: 'GET / HTTP/1.1[crlf]Host: m.batch.com[crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]'
        },
        {
          id: 'generic_dropbear_ws',
          name: 'WebSocket Dropbear Direct (Port 8880)',
          carrier: 'Tous Réseaux / CDN',
          port: 8880,
          payload: 'GET / HTTP/1.1[crlf]Host: [host][crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]'
        }
      ]
    });
  });

  // ==========================================
  // 6. UNIVERSAL SUBSCRIPTION PORTAL (/sub/:token)
  // Dual-mode: Interactive HTML for browsers & Base64 for VPN clients
  // ==========================================
  app.get(['/sub/:token', '/nexus/sub/:token', '/api/v1/sub/:token'], publicApiRateLimiter, async (req, res) => {
    const rawToken = String(req.params.token || '').trim();
    if (!rawToken) {
      res.status(400).send('Jeton requis.');
      return;
    }
    const tokens = loadTokens();
    const cleanToken = rawToken.toUpperCase();
    const matched = tokens.find(t => t.token.toUpperCase() === cleanToken);
    if (!matched) {
      res.status(404).send('Abonnement introuvable.');
      return;
    }
    if (matched.protocolType === 'ssh' || matched.sshConfig) {
      res.status(410).send('Les anciennes licences SSH sont suspendues. Aucun identifiant SSH ne sera distribué.');
      return;
    }

    const subscriptionExpiry = new Date(matched.expiresAt).getTime();
    const subscriptionInvalid = matched.status !== 'active' ||
      !Number.isFinite(subscriptionExpiry) ||
      subscriptionExpiry <= Date.now() ||
      Number(matched.bandwidthUsedGb) >= Number(matched.bandwidthGb);
    if (subscriptionInvalid) {
      res.status(403).send('Compte inactif, expiré ou quota dépassé.');
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

        html = html.replace(/\{\{USER_NAME\}\}/g, escapeHtmlText(userName));
        html = html.replace(/\{\{USER_TOKEN\}\}/g, escapeHtmlText(matched.token));
        html = html.replace(/\{\{PANEL_TITLE\}\}/g, escapeHtmlText(panelTitle));
        html = html.replace(/\{\{VLESS_URI\}\}/g, escapeHtmlText(primaryUri));
        html = html.replace(/\{\{QR_CODE\}\}/g, escapeHtmlText(primaryQr));
        html = html.replace(/\{\{SUB_DATA_JSON\}\}/g, serializeSafeInlineJson(subData));

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
        return;
      }
    }

    // Raw VPN Subscription Response
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

  // The repository contains placeholder APKs. Never claim a stub is a signed release.
  function isInstallableApk(filepath: string): boolean {
    try {
      if (fs.statSync(filepath).size < 100 * 1024) return false;
      const fd = fs.openSync(filepath, 'r');
      try {
        const header = Buffer.alloc(4);
        fs.readSync(fd, header, 0, 4, 0);
        return header[0] === 0x50 && header[1] === 0x4b && (header[2] === 3 || header[2] === 5 || header[2] === 7);
      } finally { fs.closeSync(fd); }
    } catch { return false; }
  }
  app.get(['/download/:filename', '/nexus/download/:filename'], (req, res) => {
    const requested = path.basename(req.params.filename);
    const filePath = path.resolve(staticDir, requested);
    if (!fs.existsSync(filePath) || (requested.toLowerCase().endsWith('.apk') && !isInstallableApk(filePath))) {
      res.status(404).send('Aucune version APK installable publiée à cette adresse.');
      return;
    }
    res.download(filePath, requested);
  });

  app.get(['/api/download/info', '/api/v1/download/info'], (_req, res) => {
    const version = loadAppVersionConfig();
    const apkPath = path.resolve(staticDir, 'AbessVpn.apk');
    const available = isInstallableApk(apkPath);
    const sizeBytes = available ? fs.statSync(apkPath).size : 0;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      available,
      filename: 'AbessVpn.apk',
      version: version.latestVersion,
      sizeBytes,
      sizeFormatted: available ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} Mo` : null,
      downloadUrl: available ? '/download/AbessVpn.apk' : null,
      checksum: available ? crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex') : null,
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
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 ||
        !Number.isFinite(Number(quotaGb)) || Number(quotaGb) <= 0 || Number(quotaGb) > 100000 ||
        !Number.isInteger(Number(durationDays)) || Number(durationDays) < 1 || Number(durationDays) > 3650 ||
        !Number.isSafeInteger(Number(priceCfa ?? 0)) || Number(priceCfa ?? 0) < 0) {
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
    const nextName = name === undefined ? plan.name : name;
    const nextQuota = quotaGb === undefined ? plan.quotaGb : Number(quotaGb);
    const nextDays = durationDays === undefined ? plan.durationDays : Number(durationDays);
    const nextPrice = priceCfa === undefined ? plan.priceCfa : Number(priceCfa);
    if (typeof nextName !== 'string' || !nextName.trim() || nextName.trim().length > 80 ||
        !Number.isFinite(nextQuota) || nextQuota <= 0 || nextQuota > 100000 ||
        !Number.isInteger(nextDays) || nextDays < 1 || nextDays > 3650 ||
        !Number.isSafeInteger(nextPrice) || nextPrice < 0) {
      return res.status(400).json({ error: 'Nom, quota (0–100000 Go), durée (1–3650 jours) ou prix FCFA invalide.' });
    }
    plan.name = nextName.trim();
    plan.quotaGb = nextQuota;
    plan.durationDays = nextDays;
    plan.priceCfa = nextPrice;
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
  app.post(['/api/membership/request', '/api/v1/membership/request'], publicApiRateLimiter, (req, res) => {
    const { firstName, lastName, countryCode, channel, contactDetail, deviceId, deviceModel, deviceOs, planId, paymentMethod, paymentRef } = req.body;
    if (!firstName || !lastName || !contactDetail) {
      res.status(400).json({ error: 'Prénom, nom et contact requis.' });
      return;
    }
    const countries = loadAfricanCountries();
    const cCode = String(countryCode || 'CM').toUpperCase();
    const country = countries.find((c: any) => c.code === cCode) || countries[0];
    const clientIp = req.ip || 'unknown';

    const plans = loadPlans();
    const plan = plans.find(p => p.id === planId) || plans[0];

    const requests = loadRequests();
    const claimSecret = crypto.randomBytes(32).toString('base64url');
    const claimSecretHash = crypto.createHash('sha256').update(claimSecret).digest('hex');
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
      // Rotate the proof on every update so a leaked old claim cannot be reused.
      existing.claimSecretHash = claimSecretHash;
      saveRequests(requests);
      const { claimSecretHash: _privateClaimHash, ...safeRequest } = existing;
      res.json({ status: 'pending', request: safeRequest, claimSecret, message: 'Demande mise à jour et en attente d\'approbation.' });
      return;
    }

    const newReq: MembershipRequest = {
      id: `req_${crypto.randomUUID()}`,
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
      claimSecretHash,
      status: 'PENDING',
      submittedAt: new Date().toISOString()
    };
    requests.push(newReq);
    saveRequests(requests);
    const { claimSecretHash: _privateClaimHash, ...safeRequest } = newReq;
    res.json({ status: 'pending', request: safeRequest, claimSecret, message: 'Demande enregistrée avec succès. Conservez claimSecret pour consulter son statut.' });
  });

  app.get(['/api/membership/status', '/api/v1/membership/status'], publicApiRateLimiter, (req, res) => {
    const deviceId = req.query.device_id ? String(req.query.device_id).trim() : '';
    const requestId = req.query.request_id ? String(req.query.request_id).trim() : '';
    const claimSecret = String(req.get('X-Claim-Secret') || '');
    if (!requestId || !/^[A-Za-z0-9_-]{43}$/.test(claimSecret)) {
      res.status(400).json({ status: 'invalid_request', message: 'request_id et en-tête X-Claim-Secret requis.' });
      return;
    }
    const requests = loadRequests();
    const reqFound = requests.find(r => r.id === requestId && (!deviceId || r.deviceId === deviceId));
    const suppliedHash = crypto.createHash('sha256').update(claimSecret).digest();
    const expectedHash = reqFound?.claimSecretHash && /^[0-9a-f]{64}$/.test(reqFound.claimSecretHash)
      ? Buffer.from(reqFound.claimSecretHash, 'hex') : Buffer.alloc(32);
    if (!reqFound?.claimSecretHash || !crypto.timingSafeEqual(suppliedHash, expectedHash)) {
      res.status(404).json({ status: 'not_found', message: 'Demande ou preuve introuvable.' });
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
      request: {
        id: reqFound.id,
        status: reqFound.status,
        planName: reqFound.planName,
        submittedAt: reqFound.submittedAt,
        processedAt: reqFound.processedAt,
        rejectionReason: reqFound.status === 'REJECTED' ? reqFound.rejectionReason : undefined
      },
      message: reqFound.status === 'PENDING' ? 'Demande en cours d\'examen par un administrateur.' : 'Demande rejetée.'
    });
  });

  function generateTokenCode(): string {
    return generateUnifiedToken();
  }

  app.get(['/api/admin/requests', '/api/v1/admin/requests'], authenticate, (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    res.json(loadRequests());
  });

  app.post(['/api/admin/requests/:id/approve', '/api/v1/admin/requests/:id/approve'], authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (!requireSuperAdmin(req, res)) return;
    const requests = loadRequests();
    const reqItem = requests.find(r => r.id === req.params.id);
    if (!reqItem) {
      res.status(404).json({ error: 'Demande introuvable.' });
      return;
    }
    if (reqItem.status !== 'PENDING') {
      res.status(409).json({ error: 'Cette demande a déjà été traitée.' });
      return;
    }
    const plans = loadPlans();
    const selectedPlan = plans.find(p => p.id === (req.body?.planId || reqItem.planId)) || plans[1] || plans[0];
    if (
      !selectedPlan ||
      !Number.isFinite(Number(selectedPlan.quotaGb)) ||
      Number(selectedPlan.quotaGb) <= 0 ||
      !Number.isFinite(Number(selectedPlan.durationDays)) ||
      Number(selectedPlan.durationDays) <= 0
    ) {
      res.status(409).json({ error: 'Aucun forfait actif et valide ne peut être associé à cette demande.' });
      return;
    }

    const tokens = loadTokens();
    let tokenStr = generateTokenCode();
    while (tokens.some(existing => existing.token.toUpperCase() === tokenStr)) {
      tokenStr = generateTokenCode();
    }
    const uuid = crypto.randomUUID();
    const days = selectedPlan.durationDays;
    const bandwidthGb = selectedPlan.quotaGb;
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

    const protocolConfigs = loadProtocolConfigs();
    const profile = protocolConfigs[0];
    if (!profile || !isXrayProtocol(profile.protocol)) {
      res.status(503).json({
        error: 'Impossible d’approuver cette demande : aucun profil VLESS provisionnable n’est configuré.'
      });
      return;
    }
    const profileSniError = tlsSniValidationError(profile.transport, profile.sniHost,profile.serverHost);
    if (!isValidPublicHost(profile.serverHost) || profileSniError) {
      res.status(503).json({
        error: profileSniError || 'Le profil VLESS ne possède pas une destination publique valide.'
      });
      return;
    }
    const masterSecret = process.env.MASTER_SECRET || loadMasterConfig().secretPassphrase;
    if (!masterSecret || masterSecret.length < 32) {
      res.status(503).json({ error: 'MASTER_SECRET est absent ou invalide. La demande n’a pas été approuvée.' });
      return;
    }

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
      configurationId: profile.id,
      configurationName: profile.name,
      configurationSnapshot: publicProtocolConfig(profile),
      protocolType: 'vless',
      customerNote: reqItem.fullName,
      customerContact: reqItem.contactDetail,
      encryptedLink: '',
      createdAt: new Date().toISOString()
    };
    dummyToken.encryptedLink = encryptConfig({ token: tokenStr, v: 2 }, masterSecret);
    dummyToken.directLink = buildDirectProtocolUrl(dummyToken, profile);

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

    res.json({ ok: true, status: 'approved', token: safeClientToken(dummyToken) });
  });

  app.post(['/api/admin/requests/:id/reject', '/api/v1/admin/requests/:id/reject'], authenticate, (req, res) => {
    const user: AppUser = (req as any).user;
    if (!requireSuperAdmin(req, res)) return;
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
    if (!requireSuperAdmin(req, res)) return;
    const requests = loadRequests();
    const updated = requests.filter(r => r.id !== req.params.id);
    saveRequests(updated);
    res.json({ ok: true });
  });

  // ==========================================
  // 10. VPN TELEMETRY & HEARTBEAT ENGINE
  // ==========================================
  app.post(['/api/vpn/heartbeat', '/api/traffic/heartbeat', '/api/v1/vpn/heartbeat'], (_req, res) => {
    res.status(410).json({
      ok: false,
      error: 'Cette ancienne API de heartbeat est désactivée. Les quotas sont désormais comptabilisés exclusivement par Xray-core.'
    });
  });

  app.post(['/api/token/verify', '/api/v1/token/verify'], (_req, res) => {
    res.status(410).json({
      ok: false,
      error: 'Cette ancienne API de validation est désactivée. Utilisez /api/v1/auth/token.'
    });
  });

  app.post(['/api/users/quick-trial', '/api/v1/users/quick-trial'], (_req, res) => {
    res.status(410).json({
      ok: false,
      error: 'Les essais gratuits via cette ancienne route sont désactivés. Le dispositif anti-fraude doit être activé avant toute émission.'
    });
  });

  // ==========================================
  // 11. NETWORK PROBE & SYSTEM DIAGNOSTICS & AUDIT LOGS
  // ==========================================
  app.post(['/api/probe', '/api/v1/probe'], authenticate, async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const target = String(req.body?.target_server || req.body?.target || '').trim();
    const sni = String(req.body?.sni || '').trim();
    const match = /^([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(target);
    if (!match || !isValidPublicHost(match[1]) || (sni && !isValidPublicHost(sni))) {
      res.status(400).json({ ok: false, error: 'La cible et le SNI doivent être des noms DNS publics valides.' });
      return;
    }
    const port = match[2] ? Number(match[2]) : 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      res.status(400).json({ ok: false, error: 'Port réseau invalide.' });
      return;
    }
    try {
      const addresses = await dnsLookup(match[1], { all: true, verbatim: true });
      const isPublicIpv4 = (address: string): boolean => {
        const parts = address.split('.').map(Number);
        if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
        const [a, b, c] = parts;
        return !(
          a === 0 || a === 10 || a === 127 || a >= 224 ||
          (a === 169 && b === 254) ||
          (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) ||
          (a === 100 && b >= 64 && b <= 127) ||
          (a === 192 && b === 0 && (c === 0 || c === 2)) ||
          (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
          (a === 203 && b === 0 && c === 113)
        );
      };
      if (!addresses.length || addresses.some(item => item.family !== 4 || !isPublicIpv4(item.address))) {
        res.status(400).json({ ok: false, error: 'La cible doit résoudre exclusivement vers des adresses IPv4 publiques.' });
        return;
      }
      // Connect to the exact address that was validated above. Passing the
      // hostname again would trigger a second DNS lookup and permit rebinding.
      const result = await probeEndpoint(`${addresses[0].address}:${port}`, sni || match[1]);
      res.json(result);
    } catch {
      res.status(400).json({ ok: false, error: 'Impossible de résoudre une cible publique valide.' });
    }
  });

  app.get(['/api/system/diagnostics', '/api/v1/system/diagnostics'], authenticate, (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    res.json(getSystemDiagnostics());
  });

  app.get(['/api/system/audit-logs', '/api/v1/admin/audit-logs'], authenticate, (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    res.json(loadAuditLogs());
  });

  app.get(['/api/system/backup', '/api/v1/admin/system/backup'], authenticate, (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const { secretPassphrase: _secretPassphrase, ...safeConfig } = loadMasterConfig();
    res.setHeader('Content-Disposition', `attachment; filename="abessvpn-full-backup-${Date.now()}.json"`);
    res.json({
      users: loadUsers(),
      tokens: loadTokens().map(backupClientToken),
      config: safeConfig,
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
    if (!payload || typeof payload !== 'object' ||
        (payload.users !== undefined && !validRestoredUsers(payload.users))) {
      res.status(400).json({ error: 'Fichier de sauvegarde invalide.' });
      return;
    }
    if (Array.isArray(payload.plans)) savePlans(payload.plans);
    if (Array.isArray(payload.requests)) saveRequests(payload.requests);
    // Audit history is append-only and is never overwritten by a restore.
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
    activeSessions.clear();
    res.json({ ok: true, message: 'Base de données restaurée avec succès.' });
  });

  app.get('/api/v1/admin/tokens/:id/variants', authenticate, (req, res) => {
    const tokens = loadTokens();
    const token = tokens.find(t => t.id === req.params.id);
    if (!token) {
      res.status(404).json({ error: 'Token introuvable.' });
      return;
    }
    if (token.protocolType === 'ssh' || token.sshConfig) {
      res.status(410).json({ ok: false, error: 'Les anciennes licences SSH ne disposent plus de variantes exportables.' });
      return;
    }
    if (!canManageToken((req as any).user as AppUser, token.resellerId, loadUsers())) {
      res.status(403).json({ error: 'Vous ne pouvez consulter que vos propres licences ou celles de vos sous-revendeurs.' });
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

  app.use((error:any,_req:express.Request,res:express.Response,next:express.NextFunction)=>{
    if(res.headersSent)return next(error);
    console.error('[API] Request failed:',error?.code||error?.name||'internal');
    const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<500?error.status:500;
    res.status(status).json({error:status<500?'Requête invalide.':'Opération annulée ; erreur interne.'});
  });

  app.use('/api',(_req,res)=>res.status(404).json({error:'Endpoint inexistant.'}));

  // The built React panel has no inline scripts. Legacy subscription templates
  // are handled above and keep their existing individually escaped content.
  if(isProduction)app.use((_req,res,next)=>{res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");next();});
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
    void storage.transaction(() => {
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
    else refreshTrafficTotals(tokens);
    refreshTrafficTotals();
    }).catch(() => console.error('[DATABASE] Reconciliation postponed.'));
  }, 5000);
  xrayReconcileTimer.unref();

  // Daily automated backup & rolling 7-day retention
  await storage.transaction(performAutoBackup);
  const autoBackupTimer = setInterval(() => { void storage.transaction(performAutoBackup).catch(() => console.error('[BACKUP] Snapshot postponed.')); }, 24 * 3600 * 1000);
  autoBackupTimer.unref();
  const operationsTimer=setInterval(()=>{void storage.transaction(()=>operations.health()).then(health=>operations.notify(health)).catch(()=>console.error('[MONITORING] Alert delivery unavailable.'));},60000);
  operationsTimer.unref();

  // SSH provisioning is retired; do not run a background Dropbear account manager.

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ABESSVPN MASTER SERVER] Running on port ${PORT}`);
    console.log(`[ABESSVPN MASTER SERVER] Control plane listening on ${PORT}; VPN domain: ${process.env.VPN_DOMAIN}`);
  });

  // Production updates are never applied in the background. The Super Admin
  // may inspect update-status and invoke the explicit, build-checked updater.

  // Start Integrated Telegram Management Bot (if configured in .env)
  const tgBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const tgAdminIds = process.env.TELEGRAM_ADMIN_IDS?.split(',').map(s => s.trim()).filter(Boolean);
  const telegramBot=startTelegramBot({
    encryptedBackup:async()=>encryptedBackup(await fullSnapshot(),process.env.BACKUP_ENCRYPTION_KEY||process.env.MASTER_SECRET!),
    runTransaction: work => storage.transaction(work),
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
    refreshTrafficTotals,
    encryptConfig,
    buildDirectProtocolUrl,
    safeClientToken,
    loadAppVersionConfig,
    saveAppVersionConfig,
    loadAnnouncements,
    saveAnnouncements,
    getServerUpdateStatus,
    executeServerUpdate,
    isXrayReady,
    dataDir,
    backupsDir,
    startTime
  });
  let shuttingDown=false;
  const shutdown=()=>{
    if(shuttingDown)return;shuttingDown=true;
    clearInterval(xrayReconcileTimer);clearInterval(autoBackupTimer);clearInterval(operationsTimer);
    telegramBot?.stop();
    server.closeIdleConnections();
    server.close(()=>{void storage.pool?.end().finally(()=>process.exit(0));if(!storage.pool)process.exit(0);});
    setTimeout(()=>process.exit(1),10000).unref();
  };
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);

}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
