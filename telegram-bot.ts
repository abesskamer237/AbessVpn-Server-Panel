/**
 * ABESS VPN — TELEGRAM COMMERCIAL MANAGEMENT BOT
 * Fully integrated Telegram Bot for remote server management, voucher creation,
 * multi-protocol monitoring, client control, 1-click device reset, and automated alerts.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import QRCode from 'qrcode';
import type {
  AppUser,
  ClientToken,
  MasterServerConfig,
  ProtocolConfig,
  TransactionLog,
  AppVersionConfig,
  ServerUpdateStatus
} from './server.js';

export interface TelegramBotContext {
  botToken?: string;
  adminIds?: string[];
  vpnDomain: string;
  masterSecret: string;
  loadTokens: () => ClientToken[];
  saveTokens: (tokens: ClientToken[]) => void;
  loadProtocolConfigs: () => ProtocolConfig[];
  saveProtocolConfigs: (configs: ProtocolConfig[]) => void;
  loadMasterConfig: () => MasterServerConfig;
  loadUsers: () => AppUser[];
  saveUsers: (users: AppUser[]) => void;
  loadTransactions: () => TransactionLog[];
  logTransaction: (tx: Omit<TransactionLog, 'id' | 'timestamp'>) => void;
  syncXrayConfig: (tokens?: ClientToken[]) => boolean;
  encryptConfig: (plainJson: object, secret: string) => string;
  buildDirectProtocolUrl: (token: ClientToken, profile: ProtocolConfig) => string;
  safeClientToken: (token: ClientToken) => any;
  loadAppVersionConfig: () => AppVersionConfig;
  saveAppVersionConfig: (config: AppVersionConfig) => void;
  getServerUpdateStatus: () => Promise<ServerUpdateStatus>;
  executeServerUpdate: () => Promise<{ success: boolean; output: string; currentCommit: string }>;
  xrayStatusFile: string;
  xrayConfigFile: string;
  dataDir: string;
  backupsDir: string;
  startTime: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string; first_name?: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

interface InlineBtn {
  text: string;
  callback_data?: string;
  url?: string;
}

export function startTelegramBot(ctx: TelegramBotContext): { stop: () => void } | null {
  const token = ctx.botToken?.trim();
  if (!token) {
    console.log('[TelegramBot] TELEGRAM_BOT_TOKEN non configuré dans .env. Le bot Telegram de gestion reste inactif.');
    return null;
  }

  const adminsFile = path.resolve(ctx.dataDir, 'telegram-admins.json');
  let isRunning = true;
  let pollAbortController: AbortController | null = null;
  let botUsername = 'AbessVpnBot';
  const notifiedQuotas = new Set<string>();

  // Load and save admin IDs
  function loadAdmins(): Set<number> {
    const set = new Set<number>();
    if (Array.isArray(ctx.adminIds)) {
      for (const idStr of ctx.adminIds) {
        const num = Number(idStr.trim());
        if (Number.isFinite(num) && num > 0) set.add(num);
      }
    }
    if (fs.existsSync(adminsFile)) {
      try {
        const list = JSON.parse(fs.readFileSync(adminsFile, 'utf8'));
        if (Array.isArray(list)) {
          for (const item of list) {
            const num = Number(item);
            if (Number.isFinite(num) && num > 0) set.add(num);
          }
        }
      } catch {
        // Ignore file read error
      }
    }
    return set;
  }

  function saveAdmins(admins: Set<number>) {
    try {
      const arr = Array.from(admins);
      fs.writeFileSync(adminsFile, JSON.stringify(arr, null, 2), 'utf8');
    } catch (err) {
      console.error('[TelegramBot] Impossible de sauvegarder telegram-admins.json:', err);
    }
  }

  const authorizedAdmins = loadAdmins();

  function isAdmin(userId: number): boolean {
    return authorizedAdmins.has(userId);
  }

  // Telegram HTTP Call Helper
  async function callApi(method: string, body?: Record<string, unknown> | FormData): Promise<any> {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const options: RequestInit = { method: 'POST' };

    if (body instanceof FormData) {
      options.body = body;
    } else if (body) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }

    try {
      const res = await fetch(url, options);
      const json = await res.json() as any;
      if (!json.ok) {
        console.error(`[TelegramBot] API Error on ${method}:`, json.description);
      }
      return json;
    } catch (err: unknown) {
      console.error(`[TelegramBot] Network error on ${method}:`, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async function sendMessage(
    chatId: number,
    text: string,
    options: { reply_markup?: { inline_keyboard: InlineBtn[][] }; parse_mode?: string } = {}
  ): Promise<any> {
    return callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode ?? 'Markdown',
      disable_web_page_preview: true,
      reply_markup: options.reply_markup
    });
  }

  async function editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options: { reply_markup?: { inline_keyboard: InlineBtn[][] }; parse_mode?: string } = {}
  ): Promise<any> {
    return callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options.parse_mode ?? 'Markdown',
      disable_web_page_preview: true,
      reply_markup: options.reply_markup
    });
  }

  async function answerCallbackQuery(id: string, text?: string, showAlert = false): Promise<any> {
    return callApi('answerCallbackQuery', {
      callback_query_id: id,
      text,
      show_alert: showAlert
    });
  }

  async function sendPhoto(
    chatId: number,
    buffer: Buffer,
    caption: string,
    options: { reply_markup?: { inline_keyboard: InlineBtn[][] } } = {}
  ): Promise<any> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption);
    form.append('parse_mode', 'Markdown');
    if (options.reply_markup) {
      form.append('reply_markup', JSON.stringify(options.reply_markup));
    }
    form.append('photo', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), 'abess_qrcode.png');
    return callApi('sendPhoto', form);
  }

  async function sendDocument(
    chatId: number,
    buffer: Buffer,
    filename: string,
    caption = '',
    options: { reply_markup?: { inline_keyboard: InlineBtn[][] } } = {}
  ): Promise<any> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'Markdown');
    }
    if (options.reply_markup) {
      form.append('reply_markup', JSON.stringify(options.reply_markup));
    }
    form.append('document', new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' }), filename);
    return callApi('sendDocument', form);
  }

  // Formatting Utilities
  function formatBytes(gb: number): string {
    return `${gb.toFixed(2)} Go`;
  }

  function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}j ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function renderProgressBar(used: number, total: number, slots = 10): string {
    const pct = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
    const filled = Math.round(pct * slots);
    const empty = slots - filled;
    return '▰'.repeat(filled) + '▱'.repeat(empty) + ` ${Math.round(pct * 100)}%`;
  }

  // Menu Builders
  function getMainMenuKeyboard(): { inline_keyboard: InlineBtn[][] } {
    return {
      inline_keyboard: [
        [
          { text: '📊 Statistiques & Santé', callback_data: 'menu_stats' },
          { text: '🎟️ Nouveau Voucher', callback_data: 'menu_create' }
        ],
        [
          { text: '📦 Lots de Vouchers', callback_data: 'menu_batch' },
          { text: '👥 Gestion Clients', callback_data: 'menu_clients_p0' }
        ],
        [
          { text: '⚙️ Protocoles & Xray', callback_data: 'menu_xray' },
          { text: '🔄 Recharger Xray', callback_data: 'action_reload_xray' }
        ],
        [
          { text: '💰 Journal d\'Audit', callback_data: 'menu_ledger' },
          { text: '💾 Sauvegarde (Backup)', callback_data: 'action_backup' }
        ],
        [
          { text: '📲 Version App & MAJ', callback_data: 'menu_version' },
          { text: '🚀 MAJ Serveur Auto', callback_data: 'action_server_update' }
        ],
        [
          { text: '❓ Aide & Commandes', callback_data: 'menu_help' }
        ]
      ]
    };
  }

  function getMainMenuText(userName = 'Administrateur'): string {
    const tokens = ctx.loadTokens();
    const active = tokens.filter(t => t.status === 'active').length;
    const isXrayReady = fs.existsSync(ctx.xrayStatusFile);
    const totalAllocated = tokens.reduce((acc, t) => acc + (t.bandwidthGb || 0), 0);
    const totalUsed = tokens.reduce((acc, t) => acc + (t.bandwidthUsedGb || 0), 0);

    return `🚀 *ABESS VPN — PANEL DE CONTRÔLE COMMERCIAL*\n` +
      `────────────────────────\n` +
      `👤 *Admin :* ${userName}\n` +
      `🌐 *Domaine :* \`${ctx.vpnDomain}\`\n` +
      `🟢 *Moteur Xray :* ${isXrayReady ? '✅ Opérationnel' : '⚠️ Non prêt'}\n` +
      `👥 *Clients Actifs :* *${active}* / ${tokens.length}\n` +
      `📊 *Bande Passante :* ${formatBytes(totalUsed)} / ${formatBytes(totalAllocated)}\n` +
      `────────────────────────\n` +
      `Choisissez une action ci-dessous :`;
  }

  function getStatsText(): string {
    const tokens = ctx.loadTokens();
    const active = tokens.filter(t => t.status === 'active').length;
    const expired = tokens.filter(t => t.status === 'expired').length;
    const quotaExceeded = tokens.filter(t => t.status === 'quota_exceeded').length;
    const revoked = tokens.filter(t => t.status === 'revoked').length;
    const totalAllocated = tokens.reduce((acc, t) => acc + (t.bandwidthGb || 0), 0);
    const totalUsed = tokens.reduce((acc, t) => acc + (t.bandwidthUsedGb || 0), 0);

    const memUsage = process.memoryUsage();
    const totalMemGb = os.totalmem() / 1e9;
    const freeMemGb = os.freemem() / 1e9;
    const usedMemGb = totalMemGb - freeMemGb;
    const sysUptime = formatUptime(os.uptime());
    const srvUptime = formatUptime((Date.now() - ctx.startTime) / 1000);
    const loadAvg = os.loadavg().map(v => v.toFixed(2)).join(', ');
    const isXrayReady = fs.existsSync(ctx.xrayStatusFile);
    const profiles = ctx.loadProtocolConfigs();

    return `📊 *MÉTRIQUES SYSTÈME & SANTÉ DU SERVEUR*\n` +
      `────────────────────────\n` +
      `⏱️ *Uptime Serveur :* ${srvUptime} (OS: ${sysUptime})\n` +
      `💻 *Charge CPU (1/5/15m) :* \`${loadAvg}\`\n` +
      `🧠 *Mémoire Vive (RAM) :*\n` +
      `   ${renderProgressBar(usedMemGb, totalMemGb, 10)} (${usedMemGb.toFixed(1)} / ${totalMemGb.toFixed(1)} Go)\n` +
      `📦 *Node.js RSS :* ${(memUsage.rss / 1e6).toFixed(1)} Mo\n` +
      `────────────────────────\n` +
      `🛡️ *SERVICES & PROTOCOLES :*\n` +
      `   • API Master : 🟢 Écoute sur port 3000\n` +
      `   • Moteur Xray : ${isXrayReady ? '🟢 Prêt (Ready)' : '🔴 En attente'}\n` +
      `   • Profils Protocoles configurés : *${profiles.length}*\n` +
      `────────────────────────\n` +
      `🎟️ *COMMERCIAL & UTILISATEURS :*\n` +
      `   • Total Tokens émis : *${tokens.length}*\n` +
      `   • 🟢 Actifs : *${active}*\n` +
      `   • 🟡 Expirés : *${expired}*\n` +
      `   • 🔴 Quota Dépassé : *${quotaExceeded}*\n` +
      `   • ⛔ Révoqués : *${revoked}*\n` +
      `   • Consommation globale : ${formatBytes(totalUsed)} / ${formatBytes(totalAllocated)}\n` +
      `   • Progression : ${renderProgressBar(totalUsed, Math.max(1, totalAllocated), 8)}`;
  }

  function getCreateMenuKeyboard(): { inline_keyboard: InlineBtn[][] } {
    return {
      inline_keyboard: [
        [
          { text: '⚡ 24H Test (1 Go - 1 App)', callback_data: 'create_quick_test' },
          { text: '🥉 Semaine (10 Go - 7 Jours)', callback_data: 'create_quick_week' }
        ],
        [
          { text: '🥈 VIP Mensuel (50 Go - 30 J)', callback_data: 'create_quick_month' },
          { text: '🥇 Illimité Mensuel (150 Go)', callback_data: 'create_quick_pro' }
        ],
        [
          { text: '📦 Générer un Lot de Vouchers', callback_data: 'menu_batch' }
        ],
        [
          { text: '⬅️ Retour Menu', callback_data: 'menu_main' }
        ]
      ]
    };
  }

  function getBatchMenuKeyboard(): { inline_keyboard: InlineBtn[][] } {
    return {
      inline_keyboard: [
        [
          { text: '📦 Lot de 5 (50 Go - 30 Jours)', callback_data: 'batch_run_5' },
          { text: '📦 Lot de 10 (50 Go - 30 Jours)', callback_data: 'batch_run_10' }
        ],
        [
          { text: '📦 Lot de 20 (50 Go - 30 Jours)', callback_data: 'batch_run_20' },
          { text: '📦 Lot de 50 (50 Go - 30 Jours)', callback_data: 'batch_run_50' }
        ],
        [
          { text: '⬅️ Retour Menu', callback_data: 'menu_main' }
        ]
      ]
    };
  }

  // Token Generation Logic
  async function createVoucher(
    chatId: number,
    requestedGb: number,
    days: number,
    deviceLimit: number,
    planName: string,
    customerNote?: string,
    profileId?: string
  ) {
    const profiles = ctx.loadProtocolConfigs();
    const profile = profiles.find(p => p.id === profileId) || profiles[0];
    if (!profile) {
      await sendMessage(chatId, '❌ Aucune configuration de protocole active sur le serveur.');
      return;
    }

    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase() +
      '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const tokenCode = `ABESS-${randomSuffix}`;
    const clientUuid = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

    const encryptedPayload = {
      vpnName: 'AbessVpn',
      token: tokenCode,
      bandwidthGb: requestedGb,
      expiresAt,
      configurationId: profile.id,
      configurationName: profile.name,
      serverHost: profile.serverHost,
      host: profile.host || profile.serverHost,
      serverPort: profile.serverPort,
      path: profile.path,
      sniHost: profile.sniHost,
      uuid: clientUuid,
      protocol: profile.protocol,
      transport: profile.transport,
      security: ['native', 'raw', 'kcp'].includes(profile.transport) ? 'none' : 'tls'
    };

    const encryptedLink = ctx.encryptConfig(encryptedPayload, ctx.masterSecret);

    const newToken: ClientToken = {
      id: 'tok_' + crypto.randomUUID().slice(0, 8),
      token: tokenCode,
      clientUuid,
      resellerId: 'admin_telegram',
      resellerName: 'Super Admin Telegram',
      plan: planName,
      bandwidthGb: requestedGb,
      bandwidthUsedGb: 0,
      expiresAt,
      days,
      deviceLimit,
      deviceIds: [],
      connectionCount: 0,
      lastSeenAt: null,
      lastSeenIp: null,
      status: 'active',
      configurationId: profile.id,
      configurationName: profile.name,
      configurationSnapshot: profile,
      customerNote: customerNote || undefined,
      encryptedLink,
      createdAt: new Date().toISOString()
    };

    const directLink = ctx.buildDirectProtocolUrl(newToken, profile);
    (newToken as any).directLink = directLink;

    const tokens = ctx.loadTokens();
    tokens.unshift(newToken);
    ctx.saveTokens(tokens);

    ctx.logTransaction({
      resellerId: 'admin_telegram',
      resellerName: 'Super Admin Telegram',
      type: 'TOKEN_CREATE',
      amountGb: requestedGb,
      balanceBefore: 0,
      balanceAfter: 0,
      note: `Création Voucher ${tokenCode} (${requestedGb} Go, ${days}j, Telegram)`
    });

    // Generate QR Code Buffer
    let qrBuffer: Buffer | null = null;
    try {
      qrBuffer = await QRCode.toBuffer(encryptedLink, { width: 400, margin: 2 });
    } catch {
      // Fallback without QR
    }

    const caption = `🎟️ *VOUCHER ABESS VPN GÉNÉRÉ !*\n` +
      `────────────────────────\n` +
      `🔑 *Code Voucher :* \`${tokenCode}\`\n` +
      `📦 *Plan :* ${planName}\n` +
      `📊 *Quota :* ${requestedGb} Go\n` +
      `⏳ *Validité :* ${days} jours (Expire le ${expiresAt.split('T')[0]})\n` +
      `📱 *Appareils autorisés :* ${deviceLimit}\n` +
      `🌐 *Protocole :* ${profile.name} (${profile.protocol.toUpperCase()}/${profile.transport.toUpperCase()})\n` +
      (customerNote ? `📝 *Note client :* ${customerNote}\n` : '') +
      `────────────────────────\n` +
      `📱 *Lien Application Mobile Abess :*\n\`${encryptedLink}\`\n\n` +
      `🌐 *Lien Universel (V2RayNG / Shadowrocket) :*\n\`${directLink}\`\n` +
      `────────────────────────\n` +
      `_💡 Touchez un code ou un lien pour le copier en 1 clic._`;

    const keyboard: { inline_keyboard: InlineBtn[][] } = {
      inline_keyboard: [
        [
          { text: '🔄 Reset Appareils', callback_data: `action_reset_${newToken.id}` },
          { text: '➕ +10 Go', callback_data: `action_addgb_${newToken.id}_10` }
        ],
        [
          { text: '👥 Fiche Client', callback_data: `client_view_${newToken.id}` },
          { text: '⬅️ Menu Principal', callback_data: 'menu_main' }
        ]
      ]
    };

    if (qrBuffer) {
      await sendPhoto(chatId, qrBuffer, caption, { reply_markup: keyboard });
    } else {
      await sendMessage(chatId, caption, { reply_markup: keyboard });
    }
  }

  // Batch Generation Logic
  async function createBatchVouchers(
    chatId: number,
    count: number,
    requestedGb: number,
    days: number,
    prefix = 'VIP'
  ) {
    const profiles = ctx.loadProtocolConfigs();
    const profile = profiles[0];
    if (!profile) {
      await sendMessage(chatId, '❌ Aucune configuration de protocole disponible.');
      return;
    }

    const tokens = ctx.loadTokens();
    const createdTokens: ClientToken[] = [];
    const csvRows: string[] = ['Code,Plan,Quota_GB,Days,Expires_At,Abess_Link,Direct_Link'];

    for (let i = 0; i < count; i++) {
      const codeSuffix = Math.random().toString(36).substring(2, 6).toUpperCase() +
        '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const tokenCode = `ABESS-${prefix}-${codeSuffix}`;
      const clientUuid = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

      const encryptedPayload = {
        vpnName: 'AbessVpn',
        token: tokenCode,
        bandwidthGb: requestedGb,
        expiresAt,
        configurationId: profile.id,
        configurationName: profile.name,
        serverHost: profile.serverHost,
        host: profile.host || profile.serverHost,
        serverPort: profile.serverPort,
        path: profile.path,
        sniHost: profile.sniHost,
        uuid: clientUuid,
        protocol: profile.protocol,
        transport: profile.transport,
        security: ['native', 'raw', 'kcp'].includes(profile.transport) ? 'none' : 'tls'
      };

      const encryptedLink = ctx.encryptConfig(encryptedPayload, ctx.masterSecret);

      const tokenObj: ClientToken = {
        id: 'tok_' + crypto.randomUUID().slice(0, 8),
        token: tokenCode,
        clientUuid,
        resellerId: 'admin_telegram',
        resellerName: 'Super Admin Telegram',
        plan: `${requestedGb} GO CYBER LOT`,
        bandwidthGb: requestedGb,
        bandwidthUsedGb: 0,
        expiresAt,
        days,
        deviceLimit: 2,
        deviceIds: [],
        connectionCount: 0,
        lastSeenAt: null,
        lastSeenIp: null,
        status: 'active',
        configurationId: profile.id,
        configurationName: profile.name,
        configurationSnapshot: profile,
        encryptedLink,
        createdAt: new Date().toISOString()
      };

      const directLink = ctx.buildDirectProtocolUrl(tokenObj, profile);
      (tokenObj as any).directLink = directLink;

      tokens.unshift(tokenObj);
      createdTokens.push(tokenObj);

      csvRows.push(`"${tokenCode}","${tokenObj.plan}",${requestedGb},${days},"${expiresAt}","${encryptedLink}","${directLink}"`);
    }

    ctx.saveTokens(tokens);

    ctx.logTransaction({
      resellerId: 'admin_telegram',
      resellerName: 'Super Admin Telegram',
      type: 'BATCH_CREATE',
      amountGb: requestedGb * count,
      balanceBefore: 0,
      balanceAfter: 0,
      note: `Génération de lot de ${count} vouchers (${requestedGb} Go/voucher, Telegram)`
    });

    const csvBuffer = Buffer.from(csvRows.join('\n'), 'utf8');
    const firstCodes = createdTokens.slice(0, 8).map(t => `• \`${t.token}\``).join('\n');

    const summaryText = `📦 *LOT DE ${count} VOUCHERS GÉNÉRÉ AVEC SUCCÈS !*\n` +
      `────────────────────────\n` +
      `📊 *Quota unitaire :* ${requestedGb} Go\n` +
      `⏳ *Validité :* ${days} jours\n` +
      `🌐 *Protocole :* ${profile.name}\n` +
      `────────────────────────\n` +
      `*Aperçu des premiers vouchers :*\n${firstCodes}\n` +
      (count > 8 ? `_...et ${count - 8} autres inclus dans le fichier CSV ci-joint._\n` : '') +
      `────────────────────────\n` +
      `_Le fichier CSV téléchargeable a été généré pour vos cartes ou revendeurs._`;

    await sendDocument(
      chatId,
      csvBuffer,
      `vouchers_lot_${count}x_${Date.now()}.csv`,
      summaryText,
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Client List & Detail View
  function getClientsPageKeyboard(page = 0, filter: 'all' | 'active' | 'issues' = 'all'): { inline_keyboard: InlineBtn[][] } {
    let tokens = ctx.loadTokens();
    if (filter === 'active') {
      tokens = tokens.filter(t => t.status === 'active');
    } else if (filter === 'issues') {
      tokens = tokens.filter(t => t.status === 'expired' || t.status === 'quota_exceeded' || t.status === 'revoked');
    }

    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(tokens.length / pageSize));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const slice = tokens.slice(safePage * pageSize, (safePage + 1) * pageSize);

    const rows: InlineBtn[][] = [];

    // Filter selector row
    rows.push([
      { text: filter === 'all' ? '🔘 Tous' : 'Tous', callback_data: 'menu_clients_p0_all' },
      { text: filter === 'active' ? '🟢 Actifs' : 'Actifs', callback_data: 'menu_clients_p0_active' },
      { text: filter === 'issues' ? '🔴 Alertes' : 'Alertes', callback_data: 'menu_clients_p0_issues' }
    ]);

    // Token item buttons
    for (const t of slice) {
      let icon = '🟢';
      if (t.status === 'expired') icon = '🟡';
      else if (t.status === 'quota_exceeded') icon = '🔴';
      else if (t.status === 'revoked') icon = '⛔';

      const label = `${icon} ${t.token} (${t.bandwidthUsedGb.toFixed(1)}/${t.bandwidthGb} Go)`;
      rows.push([{ text: label, callback_data: `client_view_${t.id}` }]);
    }

    // Navigation buttons
    const nav: InlineBtn[] = [];
    if (safePage > 0) {
      nav.push({ text: '⬅️ Précédent', callback_data: `menu_clients_p${safePage - 1}_${filter}` });
    }
    nav.push({ text: `Page ${safePage + 1}/${totalPages}`, callback_data: 'noop' });
    if (safePage < totalPages - 1) {
      nav.push({ text: 'Suivant ➡️', callback_data: `menu_clients_p${safePage + 1}_${filter}` });
    }
    rows.push(nav);
    rows.push([{ text: '⬅️ Retour Menu Principal', callback_data: 'menu_main' }]);

    return { inline_keyboard: rows };
  }

  function getClientDetailText(token: ClientToken): string {
    const isExpired = new Date(token.expiresAt).getTime() <= Date.now() || token.status === 'expired';
    const isQuota = token.bandwidthUsedGb >= token.bandwidthGb || token.status === 'quota_exceeded';

    let statusLabel = '🟢 Actif';
    if (token.status === 'revoked') statusLabel = '⛔ Révoqué';
    else if (isQuota) statusLabel = '🔴 Quota Épuisé';
    else if (isExpired) statusLabel = '🟡 Expiré';

    const devicesCount = Array.isArray(token.deviceIds) ? token.deviceIds.length : 0;
    const directLink = (token as any).directLink || 'Non disponible';

    return `👤 *FICHE CLIENT / TOKEN*\n` +
      `────────────────────────\n` +
      `🔑 *Code :* \`${token.token}\`\n` +
      `📦 *Plan :* ${token.plan}\n` +
      `🏷️ *Statut :* ${statusLabel}\n` +
      (token.customerNote ? `📝 *Note client :* ${token.customerNote}\n` : '') +
      `────────────────────────\n` +
      `📊 *Bande Passante :*\n` +
      `   ${renderProgressBar(token.bandwidthUsedGb, token.bandwidthGb, 10)}\n` +
      `   ${token.bandwidthUsedGb.toFixed(2)} Go / ${token.bandwidthGb} Go\n` +
      `⏳ *Expiration :* ${token.expiresAt.split('T')[0]} (${token.days} jours)\n` +
      `📱 *Appareils :* ${devicesCount} / ${token.deviceLimit} slots utilisés\n` +
      (token.lastSeenAt ? `🕒 *Dernière IP :* \`${token.lastSeenIp || 'Inconnue'}\` (${token.lastSeenAt.split('T')[0]})\n` : '🕒 *Dernière IP :* Aucune connexion\n') +
      `🌐 *Profil :* ${token.configurationName || 'Par défaut'}\n` +
      `────────────────────────\n` +
      `📱 *Lien Abess :*\n\`${token.encryptedLink}\`\n\n` +
      `🌐 *Lien V2Ray Direct :*\n\`${directLink}\``;
  }

  function getClientDetailKeyboard(token: ClientToken): { inline_keyboard: InlineBtn[][] } {
    return {
      inline_keyboard: [
        [
          { text: '🔄 Reset Appareils (Unbind)', callback_data: `action_reset_${token.id}` },
          { text: '➕ +10 Go', callback_data: `action_addgb_${token.id}_10` }
        ],
        [
          { text: '⏳ +7 Jours', callback_data: `action_adddays_${token.id}_7` },
          { text: '⏳ +30 Jours', callback_data: `action_adddays_${token.id}_30` }
        ],
        [
          {
            text: token.status === 'revoked' ? '✅ Réactiver' : '⛔ Révoquer',
            callback_data: `action_toggle_${token.id}`
          },
          { text: '🖼️ Renvoyer QR Code', callback_data: `action_resend_qr_${token.id}` }
        ],
        [
          { text: '🗑️ Supprimer', callback_data: `action_delete_${token.id}` },
          { text: '⬅️ Liste Clients', callback_data: 'menu_clients_p0' }
        ]
      ]
    };
  }

  function getXrayMenuText(): string {
    const isXrayReady = fs.existsSync(ctx.xrayStatusFile);
    const profiles = ctx.loadProtocolConfigs();

    let profilesList = '';
    for (const p of profiles) {
      profilesList += `• *${p.name}* : \`${p.protocol.toUpperCase()}\` / \`${p.transport.toUpperCase()}\` (Port: ${p.serverPort})\n`;
    }

    return `⚙️ *STATUT DU MOTEUR XRAY-CORE & PROTOCOLES*\n` +
      `────────────────────────\n` +
      `🟢 *État Moteur :* ${isXrayReady ? '✅ Actif & Écoute' : '🔴 Inactif ou en démarrage'}\n` +
      `📄 *Fichier Config :* \`${ctx.xrayConfigFile}\`\n` +
      `────────────────────────\n` +
      `*Profils de Protocoles Actifs (${profiles.length}) :*\n` +
      (profilesList || '_Aucun profil configuré._\n') +
      `────────────────────────\n` +
      `_Toutes les modifications de tokens ou de profils synchronisent instantanément la matrice d'inbounds Xray-core._`;
  }

  function getLedgerText(): string {
    const list = ctx.loadTransactions().slice(0, 8);
    if (list.length === 0) {
      return `💰 *JOURNAL D'AUDIT & TRANSACTIONS*\n────────────────────────\nAucune transaction récente enregistrée.`;
    }

    let text = `💰 *JOURNAL DES 8 DERNIÈRES OPÉRATIONS*\n────────────────────────\n`;
    for (const tx of list) {
      const date = tx.timestamp ? tx.timestamp.replace('T', ' ').slice(0, 16) : '';
      let badge = '📝';
      if (tx.type === 'TOKEN_CREATE') badge = '🎟️';
      else if (tx.type === 'BATCH_CREATE') badge = '📦';
      else if (tx.type === 'RESET_DEVICES') badge = '🔄';
      else if (tx.type === 'CREDIT_ADD') badge = '➕';

      text += `${badge} *${tx.type}* (${date})\n   • Note : ${tx.note}\n`;
    }
    return text;
  }

  function getHelpText(): string {
    return `❓ *AIDE DU BOT DE GESTION ABESS VPN*\n` +
      `────────────────────────\n` +
      `*Commandes disponibles :*\n` +
      `• \`/start\` ou \`/menu\` : Ouvrir le tableau de bord interactif\n` +
      `• \`/stats\` : Afficher les métriques serveur & RAM\n` +
      `• \`/create [Go] [Jours] [Appareils] [Note]\` : Créer un voucher direct\n` +
      `   _Exemple :_ \`/create 50 30 2 Client Jean\`\n` +
      `• \`/batch [Quantité] [Go] [Jours]\` : Générer un lot de vouchers\n` +
      `   _Exemple :_ \`/batch 10 50 30\`\n` +
      `• \`/search [terme]\` : Rechercher un client ou code\n` +
      `• \`/reset [code_token]\` : Réinitialiser les slots d'appareils\n` +
      `• \`/backup\` : Télécharger une sauvegarde complète de la base\n` +
      `• \`/reload\` : Forcer la régénération de la config Xray\n` +
      `• \`/update\` : Mettre à jour le serveur automatiquement (Git Pull + Build)\n` +
      `• \`/version\` : Afficher la version mobile et la politique de mise à jour\n` +
      `• \`/setversion [version] [obligatoire: 1/0] [url]\` : Publier une mise à jour d'application\n` +
      `• \`/login [mot_de_passe]\` : Vous authentifier comme Super Admin\n` +
      `────────────────────────\n` +
      `_Toutes les opérations sont protégées par chiffrement et contrôle d'accès strict._`;
  }

  function getVersionMenuText(): string {
    const v = ctx.loadAppVersionConfig();
    return `📲 *GESTION DES VERSIONS & MISES À JOUR APP*\n` +
      `────────────────────────\n` +
      `📱 *Dernière version publiée :* \`v${v.latestVersion}\`\n` +
      `🔒 *Version minimale requise :* \`v${v.minRequiredVersion}\`\n` +
      `⚠️ *Statut de mise à jour :* ${v.isMandatory ? '🔴 *OBLIGATOIRE (Bloquante)*' : '🟢 *Optionnelle*'}\n` +
      `📥 *Lien de téléchargement :*\n\`${v.downloadUrl}\`\n` +
      `────────────────────────\n` +
      `📝 *Notes de version :*\n_${v.releaseNotes}_\n` +
      `────────────────────────\n` +
      `_💡 Si OBLIGATOIRE est actif, l'application mobile affiche un écran bloquant et coupe la connexion VPN tant que le client n'a pas mis à jour._`;
  }

  function getVersionMenuKeyboard(): { inline_keyboard: InlineBtn[][] } {
    const v = ctx.loadAppVersionConfig();
    return {
      inline_keyboard: [
        [
          {
            text: v.isMandatory ? '🟢 Rendre Optionnelle' : '🔴 Rendre Obligatoire (Bloquante)',
            callback_data: 'action_toggle_mandatory'
          }
        ],
        [
          { text: '⬅️ Retour Menu Principal', callback_data: 'menu_main' }
        ]
      ]
    };
  }

  // Handle incoming callback queries from inline buttons
  async function handleCallbackQuery(cb: NonNullable<TelegramUpdate['callback_query']>) {
    const data = cb.data;
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    const userId = cb.from.id;

    if (!chatId || !messageId || !data) {
      await answerCallbackQuery(cb.id);
      return;
    }

    if (!isAdmin(userId)) {
      await answerCallbackQuery(cb.id, '⛔ Vous n\'êtes pas autorisé.', true);
      return;
    }

    await answerCallbackQuery(cb.id);

    try {
      if (data === 'menu_main') {
        await editMessageText(chatId, messageId, getMainMenuText(cb.from.first_name || 'Admin'), {
          reply_markup: getMainMenuKeyboard()
        });
      } else if (data === 'menu_stats') {
        await editMessageText(chatId, messageId, getStatsText(), {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Actualiser', callback_data: 'menu_stats' },
                { text: '⬅️ Retour Menu', callback_data: 'menu_main' }
              ]
            ]
          }
        });
      } else if (data === 'menu_create') {
        await editMessageText(chatId, messageId, `🎟️ *CRÉATION DE VOUCHER ABESS VPN*\n\nChoisissez un forfait prédéfini ou créez un lot :`, {
          reply_markup: getCreateMenuKeyboard()
        });
      } else if (data === 'menu_batch') {
        await editMessageText(chatId, messageId, `📦 *GÉNÉRATION DE LOTS DE VOUCHERS (BATCH)*\n\nChoisissez la quantité à générer :`, {
          reply_markup: getBatchMenuKeyboard()
        });
      } else if (data.startsWith('create_quick_')) {
        const pack = data.replace('create_quick_', '');
        if (pack === 'test') {
          await createVoucher(chatId, 1, 1, 1, '1 GO TEST 24H', 'Test 24H');
        } else if (pack === 'week') {
          await createVoucher(chatId, 10, 7, 1, '10 GO SEMAINE', 'Forfait 7 Jours');
        } else if (pack === 'month') {
          await createVoucher(chatId, 50, 30, 2, '50 GO CYBER VIP', 'Forfait Mensuel VIP');
        } else if (pack === 'pro') {
          await createVoucher(chatId, 150, 30, 3, '150 GO PRO MENSUEL', 'Forfait Illimité PRO');
        }
      } else if (data.startsWith('batch_run_')) {
        const count = Number(data.replace('batch_run_', '')) || 5;
        await sendMessage(chatId, `⏳ *Génération de ${count} vouchers en cours...*`);
        await createBatchVouchers(chatId, count, 50, 30, 'VIP');
      } else if (data.startsWith('menu_clients_p')) {
        const parts = data.replace('menu_clients_p', '').split('_');
        const page = Number(parts[0]) || 0;
        const filter = (parts[1] as 'all' | 'active' | 'issues') || 'all';
        await editMessageText(chatId, messageId, `👥 *GESTION DU PARC CLIENTS (Filtre: ${filter.toUpperCase()})*\n\nSélectionnez un client pour voir sa fiche et ses actions :`, {
          reply_markup: getClientsPageKeyboard(page, filter)
        });
      } else if (data.startsWith('client_view_')) {
        const tokenId = data.replace('client_view_', '');
        const token = ctx.loadTokens().find(t => t.id === tokenId);
        if (!token) {
          await answerCallbackQuery(cb.id, 'Token introuvable.', true);
          return;
        }
        await editMessageText(chatId, messageId, getClientDetailText(token), {
          reply_markup: getClientDetailKeyboard(token)
        });
      } else if (data.startsWith('action_reset_')) {
        const tokenId = data.replace('action_reset_', '');
        const tokens = ctx.loadTokens();
        const found = tokens.find(t => t.id === tokenId);
        if (!found) {
          await answerCallbackQuery(cb.id, 'Token introuvable.', true);
          return;
        }
        const prevCount = Array.isArray(found.deviceIds) ? found.deviceIds.length : 0;
        found.deviceIds = [];
        delete found.allowedDeviceId;
        ctx.saveTokens(tokens);

        ctx.logTransaction({
          resellerId: 'admin_telegram',
          resellerName: 'Super Admin Telegram',
          type: 'RESET_DEVICES',
          amountGb: 0,
          balanceBefore: 0,
          balanceAfter: 0,
          note: `Réinitialisation slots appareils pour ${found.token}`
        });

        await answerCallbackQuery(cb.id, `✅ Appareils réinitialisés (${prevCount} libérés) !`, true);
        await editMessageText(chatId, messageId, getClientDetailText(found), {
          reply_markup: getClientDetailKeyboard(found)
        });
      } else if (data.startsWith('action_addgb_')) {
        const parts = data.replace('action_addgb_', '').split('_');
        const tokenId = parts[0];
        const addGb = Number(parts[1]) || 10;
        const tokens = ctx.loadTokens();
        const found = tokens.find(t => t.id === tokenId);
        if (!found) {
          await answerCallbackQuery(cb.id, 'Token introuvable.', true);
          return;
        }
        found.bandwidthGb += addGb;
        if (found.status === 'quota_exceeded' && found.bandwidthUsedGb < found.bandwidthGb) {
          found.status = 'active';
        }
        ctx.saveTokens(tokens);

        ctx.logTransaction({
          resellerId: 'admin_telegram',
          resellerName: 'Super Admin Telegram',
          type: 'CREDIT_ADD',
          amountGb: addGb,
          balanceBefore: 0,
          balanceAfter: 0,
          note: `Ajout de +${addGb} Go sur token ${found.token}`
        });

        await answerCallbackQuery(cb.id, `✅ +${addGb} Go ajoutés avec succès !`, true);
        await editMessageText(chatId, messageId, getClientDetailText(found), {
          reply_markup: getClientDetailKeyboard(found)
        });
      } else if (data.startsWith('action_adddays_')) {
        const parts = data.replace('action_adddays_', '').split('_');
        const tokenId = parts[0];
        const addDays = Number(parts[1]) || 7;
        const tokens = ctx.loadTokens();
        const found = tokens.find(t => t.id === tokenId);
        if (!found) {
          await answerCallbackQuery(cb.id, 'Token introuvable.', true);
          return;
        }
        const currentExp = Math.max(Date.now(), new Date(found.expiresAt).getTime() || Date.now());
        found.expiresAt = new Date(currentExp + addDays * 24 * 3600 * 1000).toISOString();
        found.days += addDays;
        if (found.status === 'expired') found.status = 'active';
        ctx.saveTokens(tokens);

        await answerCallbackQuery(cb.id, `✅ Validité prolongée de +${addDays} jours !`, true);
        await editMessageText(chatId, messageId, getClientDetailText(found), {
          reply_markup: getClientDetailKeyboard(found)
        });
      } else if (data.startsWith('action_toggle_')) {
        const tokenId = data.replace('action_toggle_', '');
        const tokens = ctx.loadTokens();
        const found = tokens.find(t => t.id === tokenId);
        if (!found) {
          await answerCallbackQuery(cb.id, 'Token introuvable.', true);
          return;
        }
        found.status = found.status === 'revoked' ? 'active' : 'revoked';
        ctx.saveTokens(tokens);

        await answerCallbackQuery(cb.id, `✅ Statut modifié : ${found.status.toUpperCase()}`, true);
        await editMessageText(chatId, messageId, getClientDetailText(found), {
          reply_markup: getClientDetailKeyboard(found)
        });
      } else if (data.startsWith('action_delete_')) {
        const tokenId = data.replace('action_delete_', '');
        let tokens = ctx.loadTokens();
        const found = tokens.find(t => t.id === tokenId);
        if (!found) {
          await answerCallbackQuery(cb.id, 'Token introuvable.', true);
          return;
        }
        tokens = tokens.filter(t => t.id !== tokenId);
        ctx.saveTokens(tokens);

        await answerCallbackQuery(cb.id, `🗑️ Token ${found.token} supprimé.`, true);
        await editMessageText(chatId, messageId, `👥 *GESTION DU PARC CLIENTS*\n\nToken \`${found.token}\` supprimé définitivement.`, {
          reply_markup: getClientsPageKeyboard(0, 'all')
        });
      } else if (data.startsWith('action_resend_qr_')) {
        const tokenId = data.replace('action_resend_qr_', '');
        const found = ctx.loadTokens().find(t => t.id === tokenId);
        if (!found) {
          await answerCallbackQuery(cb.id, 'Token introuvable.', true);
          return;
        }
        let qrBuffer: Buffer | null = null;
        try {
          qrBuffer = await QRCode.toBuffer(found.encryptedLink, { width: 350, margin: 2 });
        } catch {
          // ignore
        }
        const cap = `🎟️ *QR CODE DU TOKEN \`${found.token}\`*\n\n` +
          `📱 *Lien Abess :*\n\`${found.encryptedLink}\`\n\n` +
          `🌐 *Lien Direct :*\n\`${(found as any).directLink || 'Non défini'}\``;

        if (qrBuffer) {
          await sendPhoto(chatId, qrBuffer, cap);
        } else {
          await sendMessage(chatId, cap);
        }
      } else if (data === 'action_reload_xray') {
        const tokens = ctx.loadTokens();
        const ok = ctx.syncXrayConfig(tokens);
        await answerCallbackQuery(cb.id, ok ? '✅ Configuration Xray rechargée avec succès !' : '⚠️ Erreur rechargement Xray.', true);
        await editMessageText(chatId, messageId, getXrayMenuText(), {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Recharger à nouveau', callback_data: 'action_reload_xray' },
                { text: '⬅️ Retour Menu', callback_data: 'menu_main' }
              ]
            ]
          }
        });
      } else if (data === 'menu_xray') {
        await editMessageText(chatId, messageId, getXrayMenuText(), {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Recharger Config Xray', callback_data: 'action_reload_xray' },
                { text: '⬅️ Retour Menu', callback_data: 'menu_main' }
              ]
            ]
          }
        });
      } else if (data === 'menu_ledger') {
        await editMessageText(chatId, messageId, getLedgerText(), {
          reply_markup: {
            inline_keyboard: [
              [{ text: '⬅️ Retour Menu', callback_data: 'menu_main' }]
            ]
          }
        });
      } else if (data === 'action_backup') {
        const snapshot = {
          timestamp: new Date().toISOString(),
          version: 'abessvpn-master-v2',
          users: ctx.loadUsers(),
          tokens: ctx.loadTokens(),
          masterConfig: ctx.loadMasterConfig(),
          protocolConfigs: ctx.loadProtocolConfigs(),
          transactions: ctx.loadTransactions()
        };
        const buffer = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8');
        const filename = `backup_abessvpn_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;

        await sendDocument(
          chatId,
          buffer,
          filename,
          `💾 *SAUVEGARDE COMPLÈTE SYSTÈME ABESS VPN*\n\nInstantane généré le ${snapshot.timestamp}.\nConservez ce fichier en lieu sûr pour toute restauration future.`,
          { reply_markup: getMainMenuKeyboard() }
        );
      } else if (data === 'menu_help') {
        await editMessageText(chatId, messageId, getHelpText(), {
          reply_markup: {
            inline_keyboard: [
              [{ text: '⬅️ Retour Menu', callback_data: 'menu_main' }]
            ]
          }
        });
      } else if (data === 'menu_version') {
        await editMessageText(chatId, messageId, getVersionMenuText(), {
          reply_markup: getVersionMenuKeyboard()
        });
      } else if (data === 'action_toggle_mandatory') {
        const v = ctx.loadAppVersionConfig();
        v.isMandatory = !v.isMandatory;
        ctx.saveAppVersionConfig(v);
        await answerCallbackQuery(cb.id, `Mise à jour passée en : ${v.isMandatory ? 'OBLIGATOIRE' : 'OPTIONNELLE'}`, true);
        await editMessageText(chatId, messageId, getVersionMenuText(), {
          reply_markup: getVersionMenuKeyboard()
        });
      } else if (data === 'action_server_update') {
        await answerCallbackQuery(cb.id, 'Vérification mise à jour serveur...');
        await sendMessage(chatId, '⏳ *Vérification du dépôt Git distant origin/main...*');
        const status = await ctx.getServerUpdateStatus();
        if (!status.isGitRepo) {
          await sendMessage(chatId, `⚠️ ${status.error || 'Pas de dépôt git détecté (déploiement conteneur).'}`);
          return;
        }
        if (!status.hasUpdate) {
          await sendMessage(chatId, `✅ *Le serveur est déjà à jour !*\nCommit actuel : \`${status.currentCommit}\` (Branche \`${status.branch}\`).`);
          return;
        }
        await sendMessage(chatId, `🚀 *Mise à jour détectée :* \`${status.currentCommit}\` -> \`${status.remoteCommit}\`\n*Exécution du git pull & recompilation...*`);
        const updateRes = await ctx.executeServerUpdate();
        if (updateRes.success) {
          await sendMessage(chatId, `✅ *SERVEUR MIS À JOUR AVEC SUCCÈS !*\n\nCommit actif : \`${updateRes.currentCommit}\`\n\n_Les configurations Xray et services ont été rechargés._`);
        } else {
          await sendMessage(chatId, `❌ *Erreur lors de la mise à jour :*\n\`\`\`\n${updateRes.output}\n\`\`\``);
        }
      }
    } catch (err: unknown) {
      console.error('[TelegramBot] Callback Error:', err instanceof Error ? err.message : String(err));
    }
  }

  // Handle incoming text commands
  async function handleMessage(msg: NonNullable<TelegramUpdate['message']>) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = (msg.text || '').trim();

    if (!userId) return;

    // Login command for new admin authentication
    if (text.startsWith('/login')) {
      const passwordAttempt = text.replace('/login', '').trim();
      const users = ctx.loadUsers();
      const initialPass = process.env.ADMIN_INITIAL_PASSWORD;

      let isMatch = false;
      if (initialPass && passwordAttempt === initialPass) {
        isMatch = true;
      } else {
        const superAdmin = users.find(u => u.role === 'SUPER_ADMIN');
        if (superAdmin) {
          const sha = crypto.createHash('sha256').update(passwordAttempt).digest('hex');
          if (superAdmin.passwordHash === sha || superAdmin.passwordHash === passwordAttempt) {
            isMatch = true;
          }
        }
      }

      if (isMatch) {
        authorizedAdmins.add(userId);
        saveAdmins(authorizedAdmins);
        await sendMessage(
          chatId,
          `✅ *AUTHENTIFICATION RÉUSSIE !*\n\nVotre compte Telegram a été enregistré comme *Super Administrateur*.\nVous avez désormais le plein contrôle sur le serveur Abess VPN.`,
          { reply_markup: getMainMenuKeyboard() }
        );
        return;
      } else {
        await sendMessage(chatId, '❌ Mot de passe administrateur incorrect.');
        return;
      }
    }

    // Guard for all other actions
    if (!isAdmin(userId)) {
      await sendMessage(
        chatId,
        `⛔ *ACCÈS RESTREINT — ABESS VPN MASTER*\n\nCe bot est réservé aux administrateurs du serveur Abess VPN.\n\nPour vous authentifier, envoyez :\n\`/login <votre_mot_de_passe_admin>\``
      );
      return;
    }

    // Direct Commands
    if (text === '/start' || text === '/menu') {
      await sendMessage(chatId, getMainMenuText(msg.from?.first_name || 'Admin'), {
        reply_markup: getMainMenuKeyboard()
      });
      return;
    }

    if (text === '/stats') {
      await sendMessage(chatId, getStatsText(), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Actualiser', callback_data: 'menu_stats' }, { text: '⬅️ Menu', callback_data: 'menu_main' }]
          ]
        }
      });
      return;
    }

    if (text.startsWith('/create')) {
      const args = text.replace('/create', '').trim().split(/\s+/).filter(Boolean);
      const gb = Number(args[0]) || 50;
      const days = Number(args[1]) || 30;
      const devices = Number(args[2]) || 2;
      const note = args.slice(3).join(' ') || undefined;

      await createVoucher(chatId, gb, days, devices, `${gb} GO CYBER VIP`, note);
      return;
    }

    if (text.startsWith('/batch')) {
      const args = text.replace('/batch', '').trim().split(/\s+/).filter(Boolean);
      const count = Math.min(200, Math.max(1, Number(args[0]) || 10));
      const gb = Number(args[1]) || 50;
      const days = Number(args[2]) || 30;

      await sendMessage(chatId, `⏳ *Génération de ${count} vouchers en cours...*`);
      await createBatchVouchers(chatId, count, gb, days, 'VIP');
      return;
    }

    if (text.startsWith('/search')) {
      const query = text.replace('/search', '').trim().toUpperCase();
      if (!query) {
        await sendMessage(chatId, 'ℹ️ Utilisez : `/search <terme_ou_code>`');
        return;
      }
      const tokens = ctx.loadTokens();
      const matched = tokens.filter(t =>
        t.token.toUpperCase().includes(query) ||
        (t.customerNote && t.customerNote.toUpperCase().includes(query))
      );

      if (matched.length === 0) {
        await sendMessage(chatId, `🔍 Aucun client trouvé pour la recherche *"${query}"*.`);
        return;
      }

      const rows: InlineBtn[][] = matched.slice(0, 10).map(t => ([
        { text: `👤 ${t.token} (${t.bandwidthUsedGb.toFixed(1)}/${t.bandwidthGb} Go)`, callback_data: `client_view_${t.id}` }
      ]));
      rows.push([{ text: '⬅️ Retour Menu', callback_data: 'menu_main' }]);

      await sendMessage(chatId, `🔍 *${matched.length} résultat(s) pour "${query}" :*`, {
        reply_markup: { inline_keyboard: rows }
      });
      return;
    }

    if (text.startsWith('/reset')) {
      const targetCode = text.replace('/reset', '').trim().toUpperCase();
      const tokens = ctx.loadTokens();
      const found = tokens.find(t => t.token.toUpperCase() === targetCode);
      if (!found) {
        await sendMessage(chatId, `❌ Aucun token trouvé avec le code \`${targetCode}\`.`);
        return;
      }
      found.deviceIds = [];
      delete found.allowedDeviceId;
      ctx.saveTokens(tokens);

      ctx.logTransaction({
        resellerId: 'admin_telegram',
        resellerName: 'Super Admin Telegram',
        type: 'RESET_DEVICES',
        amountGb: 0,
        balanceBefore: 0,
        balanceAfter: 0,
        note: `Reset manuel via commande /reset sur ${found.token}`
      });

      await sendMessage(chatId, `✅ *Slots d'appareils réinitialisés avec succès pour le token \`${found.token}\` !*`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👤 Voir la Fiche', callback_data: `client_view_${found.id}` }]
          ]
        }
      });
      return;
    }

    if (text === '/backup') {
      const snapshot = {
        timestamp: new Date().toISOString(),
        version: 'abessvpn-master-v2',
        users: ctx.loadUsers(),
        tokens: ctx.loadTokens(),
        masterConfig: ctx.loadMasterConfig(),
        protocolConfigs: ctx.loadProtocolConfigs(),
        transactions: ctx.loadTransactions()
      };
      const buffer = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8');
      const filename = `backup_abessvpn_${Date.now()}.json`;

      await sendDocument(
        chatId,
        buffer,
        filename,
        `💾 *SAUVEGARDE COMPLÈTE SYSTÈME ABESS VPN*`,
        { reply_markup: getMainMenuKeyboard() }
      );
      return;
    }

    if (text === '/xray') {
      await sendMessage(chatId, getXrayMenuText(), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Recharger Config Xray', callback_data: 'action_reload_xray' }, { text: '⬅️ Menu', callback_data: 'menu_main' }]
          ]
        }
      });
      return;
    }

    if (text === '/reload') {
      const ok = ctx.syncXrayConfig(ctx.loadTokens());
      await sendMessage(chatId, ok ? '✅ Configuration Xray rechargée avec succès !' : '⚠️ Erreur lors du rechargement de Xray.');
      return;
    }

    if (text === '/update') {
      await sendMessage(chatId, '⏳ *Vérification du dépôt Git origin/main...*');
      const status = await ctx.getServerUpdateStatus();
      if (!status.isGitRepo) {
        await sendMessage(chatId, `⚠️ ${status.error || 'Dépôt git non accessible.'}`);
        return;
      }
      if (!status.hasUpdate) {
        await sendMessage(chatId, `✅ *Le serveur est déjà sur la dernière version !*\nCommit : \`${status.currentCommit}\``);
        return;
      }
      await sendMessage(chatId, `🚀 *Mise à jour en cours vers \`${status.remoteCommit}\`...*`);
      const res = await ctx.executeServerUpdate();
      if (res.success) {
        await sendMessage(chatId, `✅ *Mise à jour terminée avec succès !*\nNouveau commit : \`${res.currentCommit}\``);
      } else {
        await sendMessage(chatId, `❌ *Échec de la mise à jour :*\n\`\`\`\n${res.output}\n\`\`\``);
      }
      return;
    }

    if (text === '/version') {
      await sendMessage(chatId, getVersionMenuText(), {
        reply_markup: getVersionMenuKeyboard()
      });
      return;
    }

    if (text.startsWith('/setversion')) {
      const args = text.replace('/setversion', '').trim().split(/\s+/).filter(Boolean);
      const newVersion = args[0];
      if (!newVersion) {
        await sendMessage(chatId, 'ℹ️ Syntaxe : `/setversion <version> [obligatoire: 1/0] [url_apk]`\n_Exemple :_ `/setversion 2.2.0 1 https://t.me/Abess_Vpn`');
        return;
      }
      const isMandatory = args[1] === '1' || args[1] === 'true' || args[1] === 'oui';
      const downloadUrl = args.slice(2).join(' ') || 'https://t.me/Abess_Vpn';
      const v = ctx.loadAppVersionConfig();
      v.latestVersion = newVersion;
      if (isMandatory) v.minRequiredVersion = newVersion;
      v.isMandatory = isMandatory;
      v.downloadUrl = downloadUrl;
      v.publishedAt = new Date().toISOString();
      ctx.saveAppVersionConfig(v);

      await sendMessage(chatId, `✅ *NOUVELLE VERSION APPLICATION ENREGISTRÉE !*\n\n` +
        `• Version : \`v${newVersion}\`\n` +
        `• Obligatoire : *${isMandatory ? 'OUI (Bloquante)' : 'NON (Optionnelle)'}*\n` +
        `• Téléchargement : \`${downloadUrl}\`\n\n` +
        `_Tous les clients mobiles recevront immédiatement cette consigne._`, {
        reply_markup: getVersionMenuKeyboard()
      });
      return;
    }

    if (text === '/help') {
      await sendMessage(chatId, getHelpText(), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ Menu Principal', callback_data: 'menu_main' }]
          ]
        }
      });
      return;
    }

    // Default response for unmatched text
    await sendMessage(chatId, `ℹ️ Commande non reconnue. Utilisez le menu ou tapez \`/help\`.`, {
      reply_markup: getMainMenuKeyboard()
    });
  }

  // Periodic proactive notifications for admins (Quota exceeded, Expirations)
  const alertInterval = setInterval(async () => {
    if (!isRunning || authorizedAdmins.size === 0) return;
    try {
      const tokens = ctx.loadTokens();
      for (const t of tokens) {
        if (t.status === 'quota_exceeded' && !notifiedQuotas.has(`quota_${t.id}`)) {
          notifiedQuotas.add(`quota_${t.id}`);
          const alertMsg = `⚠️ *ALERTE COMMERCIALE — QUOTA ÉPUISÉ*\n\n` +
            `Le client \`${t.token}\`${t.customerNote ? ` (*${t.customerNote}*)` : ''} a atteint 100% de son quota (${t.bandwidthUsedGb.toFixed(1)} / ${t.bandwidthGb} Go).\n` +
            `Sa connexion est temporairement suspendue.`;

          for (const adminId of authorizedAdmins) {
            await sendMessage(adminId, alertMsg, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '➕ Ajouter +10 Go', callback_data: `action_addgb_${t.id}_10` }, { text: '👤 Fiche', callback_data: `client_view_${t.id}` }]
                ]
              }
            });
          }
        }
      }
    } catch {
      // Silent error in background alert loop
    }
  }, 180000); // Check every 3 minutes
  alertInterval.unref();

  // Long Polling Loop
  let offset = 0;
  async function pollUpdates() {
    while (isRunning) {
      pollAbortController = new AbortController();
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=25`, {
          signal: pollAbortController.signal
        });
        const json = await res.json() as any;

        if (json.ok && Array.isArray(json.result)) {
          for (const update of json.result as TelegramUpdate[]) {
            offset = Math.max(offset, update.update_id + 1);

            if (update.callback_query) {
              handleCallbackQuery(update.callback_query).catch(console.error);
            } else if (update.message) {
              handleMessage(update.message).catch(console.error);
            }
          }
        } else if (json.error_code === 409) {
          console.error('[TelegramBot] Conflit 409 : Une autre instance de bot utilise ce token. Nouvelle tentative dans 10s...');
          await new Promise(r => setTimeout(r, 10000));
        } else {
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (err: unknown) {
        if (!isRunning) break;
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  // Initial handshake: getMe
  fetch(`https://api.telegram.org/bot${token}/getMe`)
    .then(r => r.json())
    .then((data: any) => {
      if (data.ok && data.result) {
        botUsername = data.result.username || 'AbessVpnBot';
        console.log(`[TelegramBot] ✅ Bot Telegram Commercial connecté sous @${botUsername} !`);
        console.log(`[TelegramBot] Administrateurs enregistrés : ${authorizedAdmins.size} chat ID(s).`);
        pollUpdates().catch(console.error);
      } else {
        console.error('[TelegramBot] ❌ Token de bot Telegram invalide :', data.description);
      }
    })
    .catch(err => {
      console.error('[TelegramBot] Impossible de contacter les serveurs Telegram :', err.message);
    });

  return {
    stop() {
      isRunning = false;
      clearInterval(alertInterval);
      if (pollAbortController) pollAbortController.abort();
      console.log('[TelegramBot] Bot arrêté.');
    }
  };
}
