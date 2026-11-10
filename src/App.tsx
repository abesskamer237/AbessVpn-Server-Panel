import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { WorkspaceWelcome } from './components/WorkspaceWelcome';
import {
  Shield,
  Server,
  Users,
  Key,
  Database,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  Sliders,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  HardDrive,
  Eye,
  EyeOff,
  UserCheck,
  UserX,
  CreditCard,
  Zap,
  Terminal,
  ExternalLink,
  DollarSign,
  TrendingUp,
  FileKey,
  Sparkles,
  RotateCcw,
  FileText,
  Download,
  Upload,
  Search,
  Filter,
  History,
  Share2,
  Smartphone,
  Tag,
  PhoneCall,
  Gauge,
  Radio,
  CheckCheck,
  XCircle,
  Globe,
  Megaphone,
  Bell,
  Sun,
  Moon
} from 'lucide-react';

interface Announcement {
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

interface UserSession {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'RESELLER';
  credits: number;
  totalTokensCreated: number;
  totalBandwidthAllocatedGb: number;
  parentId?: string;
  parentName?: string;
}

interface Reseller {
  id: string;
  email: string;
  name: string;
  role: 'RESELLER';
  credits: number;
  totalTokensCreated: number;
  totalBandwidthAllocatedGb: number;
  status: 'active' | 'suspended';
  createdAt: string;
  lastLoginAt: string | null;
  parentId?: string;
  parentName?: string;
  subResellersCount?: number;
}

interface ClientToken {
  id: string;
  token: string;
  configurationId?: string;
  configurationName?: string;
  resellerId: string;
  resellerName: string;
  plan: string;
  bandwidthGb: number;
  bandwidthUsedGb: number;
  expiresAt: string;
  days: number;
  deviceLimit: number;
  allowedDeviceId?: string;
  connectionCount: number;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  status: 'active' | 'revoked' | 'expired' | 'quota_exceeded';
  customerNote?: string;
  customerContact?: string;
  deviceIds?: string[];
  encryptedLink: string;
  directLink?: string;
  protocolType?: string;
  sshConfig?: {
    sshConfigType: string;
    remarks: string;
    sshHost: string;
    sshPort: number;
    sshUsername: string;
    sshPassword: string;
    payload: string;
  };
  createdAt: string;
}

interface TransactionLog {
  id: string;
  resellerId: string;
  resellerName: string;
  type: string;
  amountGb: number;
  balanceBefore: number;
  balanceAfter: number;
  note: string;
  timestamp: string;
}

interface MasterConfig {
  id?: string;
  name: string;
  serverHost: string;
  /** Optional HTTP Host/:authority header; independent from destination and SNI. */
  host: string;
  serverPort: number;
  protocol: string;
  transport: string;
  path: string;
  sniHost: string;
  uuid?: string;
  secretPassphrase?: string;
  systemName?: string;
  contactTelegram?: string;
  payload?: string;
  remarks?: string;
}

interface AvailableProtocolConfig {
  id: string;
  name: string;
  protocol: string;
  transport: string;
  serverPort: number;
}

interface PricingPlan {
  id: string;
  name: string;
  quotaGb: number;
  durationDays: number;
  priceCfa: number;
  badge?: string;
  description?: string;
  activeUsersCount?: number;
}

interface MembershipRequest {
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
  paymentMethod?: string;
  paymentRef?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  assignedTokenId?: string;
  assignedToken?: string;
  submittedAt: string;
  processedAt?: string;
}

interface VlessVariant {
  id: string;
  label: string;
  badge: string;
  protocol: string;
  uri: string;
  sni: string;
  target: string;
  qrCode?: string;
}

interface SystemDiagnostics {
  ok: boolean;
  server: {
    uptimeSeconds: number;
    systemUptimeSeconds: number;
    nodeVersion: string;
    platform: string;
    release: string;
    arch: string;
    cpuCount: number;
    loadAverage: number[];
    memory: {
      totalBytes: number;
      freeBytes: number;
      usedBytes: number;
      usedPercent: number;
    };
  };
  vpn: {
    activeTokensCount: number;
    totalTokensCount: number;
    resellersCount: number;
    totalBandwidthUsedGb: number;
    plansCount: number;
    pendingRequestsCount: number;
    xrayStatus: string;
    dropbearStatus?: string;
    wsDropbearStatus?: string;
    activeSshConnections?: number;
    vpnDomain: string;
    appVersion: string;
  };
  timestamp: string;
}

const EMPTY_PROTOCOL_CONFIG: MasterConfig = {
  name: '', serverHost: '', host: '', serverPort: 443, protocol: 'vless',
  transport: 'ws', path: '/@abess237', sniHost: '', uuid: '',
  payload: '', remarks: '',
  secretPassphrase: '', systemName: 'AbessVpn', contactTelegram: '@abess237'
};

function generateUnifiedToken(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 11; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `ABESS-${rand}`;
}

export default function App() {
  // Theme State: "light" (Mode clair) par défaut, ou "dark" (Mode sombre)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('abess_panel_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    localStorage.setItem('abess_panel_theme', theme);
    if (theme === 'light') {
      document.documentElement.classList.add('theme-light');
      document.body.classList.add('theme-light');
    } else {
      document.documentElement.classList.remove('theme-light');
      document.body.classList.remove('theme-light');
    }
  }, [theme]);

  // Session State
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [authToken, setAuthToken] = useState<string>('');
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'overview' | 'resellers' | 'tokens' | 'plans' | 'requests' | 'diagnostics' | 'transactions' | 'infrastructure' | 'logs' | 'announcements'>('overview');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Announcements State
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementModalOpen, setAnnouncementModalOpen] = useState<boolean>(false);
  const [annTitle, setAnnTitle] = useState<string>('');
  const [annMessage, setAnnMessage] = useState<string>('');
  const [annType, setAnnType] = useState<'INFO' | 'WARNING' | 'CRITICAL' | 'PROMO' | 'UPDATE'>('INFO');
  const [annPlatform, setAnnPlatform] = useState<'ALL' | 'ANDROID' | 'WINDOWS'>('ALL');
  const [annIsMandatory, setAnnIsMandatory] = useState<boolean>(false);
  const [annBtnText, setAnnBtnText] = useState<string>('En savoir plus');
  const [annBtnUrl, setAnnBtnUrl] = useState<string>('https://t.me/Abess_Vpn');
  const [annShowMode, setAnnShowMode] = useState<'EVERY_LAUNCH' | 'ONCE_PER_USER'>('ONCE_PER_USER');
  const [annLoading, setAnnLoading] = useState<boolean>(false);
  const [previewAnnouncement, setPreviewAnnouncement] = useState<Announcement | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  // Stats & Lists
  const [stats, setStats] = useState<any>(null);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [tokens, setTokens] = useState<ClientToken[]>([]);
  const [masterConfig, setMasterConfig] = useState<MasterConfig | null>(null);
  const [protocolConfigs, setProtocolConfigs] = useState<MasterConfig[]>([]);
  const [availableConfigs, setAvailableConfigs] = useState<AvailableProtocolConfig[]>([]);
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState<boolean>(false);
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState<boolean>(false);
  const [configSuccess, setConfigSuccess] = useState<boolean>(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Modal / Action States: New Reseller
  const [newResellerName, setNewResellerName] = useState<string>('');
  const [newResellerEmail, setNewResellerEmail] = useState<string>('');
  const [newResellerPassword, setNewResellerPassword] = useState<string>('');
  const [newResellerCredits, setNewResellerCredits] = useState<number>(100);
  const [resellerModalOpen, setResellerModalOpen] = useState<boolean>(false);

  // Credit Reseller Modal
  const [creditingReseller, setCreditingReseller] = useState<Reseller | null>(null);
  const [creditAmount, setCreditAmount] = useState<number>(100);

  // New Client Token Modal
  const [tokenModalOpen, setTokenModalOpen] = useState<boolean>(false);
  const [newTokenCode, setNewTokenCode] = useState<string>(generateUnifiedToken());
  const [newTokenPlan, setNewTokenPlan] = useState<string>('PASS COMMERCE 30J');
  const [newTokenBandwidth, setNewTokenBandwidth] = useState<number>(50); // Go
  const [newTokenExpiryDate, setNewTokenExpiryDate] = useState<string>(
    new Date(Date.now() + 30 * 24 * 3600 * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  );
  const [newTokenDeviceLimit, setNewTokenDeviceLimit] = useState<number>(2);
  const [newTokenAllowedDeviceId, setNewTokenAllowedDeviceId] = useState<string>('');
  const [newTokenConfigurationId, setNewTokenConfigurationId] = useState<string>('');
  const [tokenCreating, setTokenCreating] = useState<boolean>(false);
  const [tokenCreationError, setTokenCreationError] = useState<string | null>(null);

  // Display QR Code Modal
  const [qrModalToken, setQrModalToken] = useState<ClientToken | null>(null);

  // Commercial Batch Generation State
  const [batchModalOpen, setBatchModalOpen] = useState<boolean>(false);
  const [batchCount, setBatchCount] = useState<number>(10);
  const [batchGb, setBatchGb] = useState<number>(50);
  const [batchDays, setBatchDays] = useState<number>(30);
  const [batchDeviceLimit, setBatchDeviceLimit] = useState<number>(2);
  const [batchVoucherPrefix, setBatchVoucherPrefix] = useState<string>('VIP');
  const [batchNotePrefix, setBatchNotePrefix] = useState<string>('');
  const [batchConfigId, setBatchConfigId] = useState<string>('');
  const [batchLoading, setBatchLoading] = useState<boolean>(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<ClientToken[] | null>(null);

  // Single Token Customer Note
  const [newTokenCustomerNote, setNewTokenCustomerNote] = useState<string>('');

  // Search & Filter State
  const [tokenSearchQuery, setTokenSearchQuery] = useState<string>('');
  const [tokenStatusFilter, setTokenStatusFilter] = useState<'ALL' | 'active' | 'expired' | 'quota_exceeded' | 'revoked'>('ALL');

  // Transaction Ledger State
  const [transactions, setTransactions] = useState<TransactionLog[]>([]);
  const [backupLoading, setBackupLoading] = useState<boolean>(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');

  // App Version & Server Update State
  const [appVersionConfig, setAppVersionConfig] = useState<{
    latestVersion: string;
    minRequiredVersion: string;
    isMandatory: boolean;
    downloadUrl: string;
    releaseNotes: string;
  }>({
    latestVersion: '2.1.0',
    minRequiredVersion: '2.0.0',
    isMandatory: true,
    downloadUrl: 'https://t.me/Abess_Vpn',
    releaseNotes: 'Mise à jour majeure obligatoire : protocoles Xray renforcés et sécurité optimisée.'
  });
  const [appVersionSaving, setAppVersionSaving] = useState<boolean>(false);
  const [appVersionSaved, setAppVersionSaved] = useState<boolean>(false);
  const [serverUpdateStatus, setServerUpdateStatus] = useState<any>(null);
  const [serverUpdating, setServerUpdating] = useState<boolean>(false);
  const [serverUpdateMsg, setServerUpdateMsg] = useState<string | null>(null);

  // Server logs are populated by real actions; do not seed simulated startup status.
  const [systemLogs, setSystemLogs] = useState<string[]>([]);

  // Plans & Commercial Tiers State
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [planModalOpen, setPlanModalOpen] = useState<boolean>(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string>('');
  const [planQuotaGb, setPlanQuotaGb] = useState<number>(25);
  const [planDurationDays, setPlanDurationDays] = useState<number>(30);
  const [planPriceCfa, setPlanPriceCfa] = useState<number>(3500);
  const [planBadge, setPlanBadge] = useState<string>('RECOMMANDÉ');
  const [planDesc, setPlanDesc] = useState<string>('');

  // Membership & Onboarding Requests State
  const [requests, setRequests] = useState<MembershipRequest[]>([]);
  const [requestFilter, setRequestFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [requestActionLoading, setRequestActionLoading] = useState<string | null>(null);

  // Diagnostics & Probe State
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [probeHost, setProbeHost] = useState<string>('');
  const [probePort, setProbePort] = useState<number>(443);
  const [probeTls, setProbeTls] = useState<boolean>(true);
  const [probeSni, setProbeSni] = useState<string>('');
  const [probeLoading, setProbeLoading] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<any>(null);

  // Multi-Variants & Subscription Modal State
  const [variantsModalOpen, setVariantsModalOpen] = useState<boolean>(false);
  const [variantsModalToken, setVariantsModalToken] = useState<ClientToken | null>(null);
  const [variantsList, setVariantsList] = useState<VlessVariant[]>([]);
  const [variantsLoading, setVariantsLoading] = useState<boolean>(false);
  const [variantsSubUrl, setVariantsSubUrl] = useState<string>('');
  const [variantsClientJson, setVariantsClientJson] = useState<any>(null);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setSystemLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 40)]);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // Restore session from localStorage on initial render
  useEffect(() => {
    const savedToken = localStorage.getItem('abess_admin_token');
    const savedUser = localStorage.getItem('abess_admin_user');
    if (savedToken && savedUser) {
      try {
        setAuthToken(savedToken);
        setCurrentUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('abess_admin_token');
        localStorage.removeItem('abess_admin_user');
      }
    }
  }, []);

  // Fetch all dashboard data when user is logged in
  const refreshData = async () => {
    if (!authToken || refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);

    try {
      const headers = { 'Authorization': `Bearer ${authToken}` };

      // Sync Current User profile & real-time credits
      const meRes = await fetch('/api/v1/auth/me', { headers });
      if (meRes.status === 401 || meRes.status === 403) {
        setAuthToken('');
        setCurrentUser(null);
        localStorage.removeItem('abess_admin_token');
        localStorage.removeItem('abess_admin_user');
        setLoginError('Votre session a expiré. Veuillez vous reconnecter.');
        return;
      }
      if (!meRes.ok) throw new Error('Connexion au serveur interrompue. Réessayez.');
      if (meRes.ok) {
        const meData = await meRes.json();
        setCurrentUser(meData);
        localStorage.setItem('abess_admin_user', JSON.stringify(meData));
      }

      // Stats
      const statsRes = await fetch('/api/v1/admin/stats', { headers });
      if (!statsRes.ok) throw new Error('Les statistiques ne sont pas disponibles. Réessayez.');
      setStats(await statsRes.json());

      // Tokens (Admin or Reseller specific)
      const tokensRes = await fetch('/api/v1/admin/tokens', { headers });
      if (tokensRes.ok) setTokens(await tokensRes.json());

      // Resellers & Sub-Resellers (Available for Super Admin & Resellers)
      const resellersRes = await fetch('/api/v1/admin/resellers', { headers });
      if (resellersRes.ok) setResellers(await resellersRes.json());

      if (currentUser?.role === 'SUPER_ADMIN') {
        const appVerRes = await fetch('/api/v1/admin/app-version', { headers });
        if (appVerRes.ok) setAppVersionConfig(await appVerRes.json());

        const srvUpdRes = await fetch('/api/v1/admin/system/update-status', { headers });
        if (srvUpdRes.ok) setServerUpdateStatus(await srvUpdRes.json());
      }

      // Transactions Ledger
      const txRes = await fetch('/api/v1/admin/transactions', { headers });
      if (txRes.ok) setTransactions(await txRes.json());

      // Plans
      const plansRes = await fetch('/api/v1/plans');
      if (plansRes.ok) setPlans(await plansRes.json());

      // Requests & Diagnostics (Only for Super Admin)
      if (currentUser?.role === 'SUPER_ADMIN') {
        const reqRes = await fetch('/api/v1/admin/requests', { headers });
        if (reqRes.ok) setRequests(await reqRes.json());

        const diagRes = await fetch('/api/v1/system/diagnostics', { headers });
        if (diagRes.ok) setDiagnostics(await diagRes.json());

        const annRes = await fetch('/api/v1/admin/announcements', { headers });
        if (annRes.ok) {
          const annData = await annRes.json();
          setAnnouncements(annData.announcements || []);
        }
      }
      setUpdatedAt(new Date());
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Connexion au serveur indisponible.');
      if (!masterConfig) {
        setConfigLoadError('Impossible de joindre l’API pour charger les données du panneau.');
        setConfigLoading(false);
      }
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  };


  // Load the non-sensitive configuration choices for every user, and full Host/SNI data only for Super Admin.
  const loadProtocolConfigData = async () => {
    if (!authToken) return;
    setConfigLoading(true);
    try {
      const headers = { 'Authorization': `Bearer ${authToken}` };
      const availableRes = await fetch('/api/v1/admin/available-configs', { headers });
      if (availableRes.ok) {
        const available = await availableRes.json();
        setAvailableConfigs(Array.isArray(available) ? available : []);
      } else {
        const payload = await availableRes.json().catch(() => ({}));
        throw new Error(payload.error || `Chargement des choix de configuration impossible (HTTP ${availableRes.status}).`);
      }

      if (currentUser?.role === 'SUPER_ADMIN') {
        const response = await fetch('/api/v1/admin/protocol-configs', { headers });
        const payload = await response.json().catch(() => []);
        if (!response.ok) throw new Error(payload.error || `Chargement des configurations impossible (HTTP ${response.status}).`);
        const configs = Array.isArray(payload) ? payload as MasterConfig[] : [];
        setProtocolConfigs(configs);
        setMasterConfig(current => current ?? (configs[0] || { ...EMPTY_PROTOCOL_CONFIG }));
        setEditingConfigId(current => current ?? (configs[0]?.id || null));
        setConfigLoadError(null);
      }
    } catch (error) {
      setConfigLoadError(error instanceof Error ? error.message : 'Erreur réseau lors du chargement des configurations.');
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    if (authToken) {
      refreshData();
      const interval = setInterval(refreshData, 8000);
      return () => clearInterval(interval);
    }
  }, [authToken, currentUser?.role]);

  useEffect(() => {
    if (authToken && currentUser?.role) void loadProtocolConfigData();
  }, [authToken, currentUser?.role]);

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setAuthToken(data.token);
        setCurrentUser(data.user);
        localStorage.setItem('abess_admin_token', data.token);
        localStorage.setItem('abess_admin_user', JSON.stringify(data.user));
        addLog(`[LOGIN] Connexion réussie : ${data.user.email} (${data.user.role})`);
        setActiveTab('overview');
      } else {
        setLoginError(data.error || 'Identifiants incorrects');
      }
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoginLoading(false);
    }
  };

  // Handle Logout
  const handleLogout = () => {
    if (authToken) {
      void fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => addLog('[LOGOUT] Révocation serveur impossible ; la session expirera sous 24 h.'));
    }
    setAuthToken('');
    setCurrentUser(null);
    localStorage.removeItem('abess_admin_token');
    localStorage.removeItem('abess_admin_user');
    addLog(`[LOGOUT] Déconnexion effectuée.`);
  };

  // Create Reseller (Super Admin or Reseller creating Sub-Reseller)
  const handleCreateReseller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResellerEmail || !newResellerPassword || !newResellerName) return;

    if (currentUser?.role === 'RESELLER' && Number(newResellerCredits) > currentUser.credits) {
      alert(`Solde insuffisant ! Vous disposez de ${currentUser.credits} Go.`);
      return;
    }

    try {
      const res = await fetch('/api/v1/admin/resellers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          name: newResellerName,
          email: newResellerEmail,
          password: newResellerPassword,
          initialCredits: Number(newResellerCredits) || 0
        })
      });

      if (res.ok) {
        setResellerModalOpen(false);
        setNewResellerName('');
        setNewResellerEmail('');
        setNewResellerPassword('');
        setNewResellerCredits(currentUser?.role === 'SUPER_ADMIN' ? 100 : Math.min(50, currentUser?.credits || 0));
        refreshData();
        addLog(`[RESELLER CREATE] Compte ${currentUser?.role === 'SUPER_ADMIN' ? 'revendeur' : 'sous-revendeur'} créé pour ${newResellerEmail} (+${newResellerCredits} Go)`);
      } else {
        const data = await res.json();
        alert(data.error || 'Erreur lors de la création du compte');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Credit Reseller
  const handleCreditReseller = async (resellerId: string, amount: number) => {
    if (currentUser?.role === 'RESELLER' && amount > currentUser.credits) {
      alert(`Solde insuffisant ! Votre solde est de ${currentUser.credits} Go.`);
      return;
    }

    try {
      const res = await fetch(`/api/v1/admin/resellers/${resellerId}/credit`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ amount })
      });

      if (res.ok) {
        setCreditingReseller(null);
        refreshData();
        addLog(`[RESELLER RECHARGE] Revendeur rechargé de ${amount > 0 ? '+' : ''}${amount} Go de crédits.`);
      } else {
        const data = await res.json();
        alert(data.error || 'Erreur lors du rechargement');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Toggle Reseller Status
  const handleToggleResellerStatus = async (reseller: Reseller) => {
    const newStatus = reseller.status === 'active' ? 'suspended' : 'active';
    try {
      const res = await fetch(`/api/v1/admin/resellers/${reseller.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        refreshData();
        addLog(`[RESELLER STATUS] Statut de ${reseller.email} changé à ${newStatus.toUpperCase()}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete Reseller
  const handleDeleteReseller = async (id: string, email: string) => {
    if (!confirm(`Confirmez-vous la suppression du revendeur ${email} ?`)) return;
    try {
      const res = await fetch(`/api/v1/admin/resellers/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        refreshData();
        addLog(`[RESELLER DELETE] Revendeur ${email} supprimé.`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Create Client Token (Admin or Reseller)
  const handleCreateClientToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setTokenCreating(true);
    setTokenCreationError(null);

    const generatedCode = newTokenCode.trim() || generateUnifiedToken();

    try {
      const res = await fetch('/api/v1/admin/tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          token: generatedCode,
          plan: newTokenPlan,
          bandwidthGb: Number(newTokenBandwidth),
          expiresAt: new Date(newTokenExpiryDate).toISOString(),
          deviceLimit: Number(newTokenDeviceLimit),
          allowedDeviceId: newTokenAllowedDeviceId.trim() || undefined,
          customerNote: newTokenCustomerNote.trim() || undefined,
          configurationId: newTokenConfigurationId
        })
      });

      const data = await res.json();
      if (res.ok) {
        setTokenModalOpen(false);
        setNewTokenCode(generateUnifiedToken());
        setNewTokenAllowedDeviceId('');
        setNewTokenCustomerNote('');
        refreshData();
        addLog(`[CLIENT TOKEN CREATE] Token client ${data.token} créé (${data.bandwidthGb} Go, profil ${data.configurationName || newTokenConfigurationId}${data.allowedDeviceId ? ', ID lié' : ''}).`);
      } else {
        setTokenCreationError(data.error || 'Erreur lors de la création du token');
      }
    } catch (err: unknown) {
      setTokenCreationError(err instanceof Error ? err.message : String(err));
    } finally {
      setTokenCreating(false);
    }
  };

  const handleToggleTokenStatus = async (id: string, token: string, currentStatus: ClientToken['status']) => {
    const nextStatus = currentStatus === 'active' ? 'revoked' : 'active';
    const action = nextStatus === 'revoked' ? 'suspendre' : 'réactiver';
    if (!confirm(`Voulez-vous ${action} le token ${token} ?`)) return;
    try {
      const response = await fetch(`/api/v1/admin/tokens/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ status: nextStatus })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Modification du statut impossible.');
      await refreshData();
      addLog(`[TOKEN STATUS] Token ${token} : ${nextStatus}.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  // 1-Click Reset Device Slots for customer
  const handleResetDevices = async (id: string, token: string) => {
    if (!confirm(`Réinitialiser les appareils pour le token ${token} ?\nLe client pourra alors activer son nouveau smartphone.`)) return;
    try {
      const res = await fetch(`/api/v1/admin/tokens/${id}/reset-devices`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Appareils réinitialisés avec succès !');
        refreshData();
        addLog(`[DEVICE RESET] Token ${token} : appareils réinitialisés.`);
      } else {
        alert(data.error || 'Erreur lors de la réinitialisation.');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Batch / Bulk Token Generator
  const handleBatchTokenCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchLoading(true);
    setBatchError(null);
    try {
      const res = await fetch('/api/v1/admin/tokens/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({
          count: batchCount,
          bandwidthGb: batchGb,
          days: batchDays,
          deviceLimit: batchDeviceLimit,
          voucherPrefix: batchVoucherPrefix,
          customerNotePrefix: batchNotePrefix,
          configurationId: batchConfigId || (availableConfigs[0]?.id || '')
        })
      });
      const data = await res.json();
      if (res.ok) {
        setBatchResult(data.tokens);
        refreshData();
        addLog(`[BATCH CREATE] Lot de ${data.count} vouchers généré avec succès (${data.totalBandwidthGb} Go).`);
      } else {
        setBatchError(data.error || 'Erreur lors de la génération du lot.');
      }
    } catch (err: unknown) {
      setBatchError(err instanceof Error ? err.message : String(err));
    } finally {
      setBatchLoading(false);
    }
  };

  const handleSaveAppVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    setAppVersionSaving(true);
    setAppVersionSaved(false);
    try {
      const res = await fetch('/api/v1/admin/app-version', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(appVersionConfig)
      });
      if (res.ok) {
        setAppVersionSaved(true);
        addLog(`[APP VERSION] Version publiée v${appVersionConfig.latestVersion} (Obligatoire: ${appVersionConfig.isMandatory ? 'OUI' : 'NON'})`);
        setTimeout(() => setAppVersionSaved(false), 4000);
      }
    } catch (_) {}
    finally {
      setAppVersionSaving(false);
    }
  };

  const handleExecuteServerUpdate = async () => {
    setServerUpdating(true);
    setServerUpdateMsg(null);
    try {
      const res = await fetch('/api/v1/admin/system/update', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setServerUpdateMsg(`✅ Serveur mis à jour vers commit ${data.currentCommit}`);
        addLog(`[SERVER UPDATE] Mise à jour effectuée vers ${data.currentCommit}`);
        const updRes = await fetch('/api/v1/admin/system/update-status', { headers: { Authorization: `Bearer ${authToken}` } });
        if (updRes.ok) setServerUpdateStatus(await updRes.json());
      } else {
        setServerUpdateMsg(`❌ Échec: ${data.output || data.error || 'Erreur'}`);
      }
    } catch (err: unknown) {
      setServerUpdateMsg(`❌ Erreur: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setServerUpdating(false);
    }
  };

  // Export Tokens to CSV
  const exportTokensCsv = () => {
    if (tokens.length === 0) {
      alert('Aucune licence à exporter.');
      return;
    }
    const headers = ['Token', 'Plan', 'Configuration', 'Revendeur', 'Quota_Go', 'Consomme_Go', 'Expiration', 'Statut', 'Appareils_Max', 'Note_Client', 'Lien_ABESS'];
    const rows = tokens.map(t => [
      `"${t.token}"`,
      `"${t.plan || ''}"`,
      `"${t.configurationName || ''}"`,
      `"${t.resellerName || ''}"`,
      t.bandwidthGb,
      t.bandwidthUsedGb.toFixed(2),
      `"${t.expiresAt}"`,
      t.status,
      t.deviceLimit,
      `"${t.customerNote || ''}"`,
      `"${t.encryptedLink || ''}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `abessvpn-licences-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Download Backup
  const handleDownloadBackup = () => {
    const link = document.createElement('a');
    link.href = '/api/v1/admin/backup';
    link.setAttribute('download', `abessvpn-backup-${new Date().toISOString().slice(0, 10)}.json`);
    fetch('/api/v1/admin/backup', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    })
      .then(res => res.blob())
      .then(blob => {
        const u = URL.createObjectURL(blob);
        link.href = u;
        link.click();
        URL.revokeObjectURL(u);
      })
      .catch(() => alert('Erreur lors du téléchargement de la sauvegarde.'));
  };

  // Delete / Revoke Token
  const handleDeleteToken = async (id: string, token: string) => {
    if (!confirm(`Révoquer immédiatement le token client ${token} ?`)) return;
    try {
      const res = await fetch(`/api/v1/admin/tokens/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        refreshData();
        addLog(`[TOKEN REVOKE] Token ${token} révoqué.`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Start a fresh profile; the admin can store multiple independent protocol configurations.
  const handleNewProtocolConfig = () => {
    setEditingConfigId(null);
    setMasterConfig({ ...EMPTY_PROTOCOL_CONFIG });
    setConfigError(null);
    setConfigSuccess(false);
    setConfigLoadError(null);
  };

  const handleSelectProtocolConfig = (config: MasterConfig) => {
    setEditingConfigId(config.id || null);
    setMasterConfig({ ...EMPTY_PROTOCOL_CONFIG, ...config });
    setConfigError(null);
    setConfigSuccess(false);
  };

  const handleDeleteProtocolConfig = async (config: MasterConfig) => {
    if (!config.id || !confirm(`Supprimer la configuration « ${config.name} » ? Les configurations utilisées par des tokens ne peuvent pas être supprimées.`)) return;
    try {
      const response = await fetch(`/api/v1/admin/protocol-configs/${encodeURIComponent(config.id)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Suppression impossible.');
      const next = Array.isArray(payload.configs) ? payload.configs as MasterConfig[] : protocolConfigs.filter(item => item.id !== config.id);
      setProtocolConfigs(next);
      setAvailableConfigs(next.map(item => ({ id: item.id || '', name: item.name, protocol: item.protocol, transport: item.transport, serverPort: item.serverPort })));
      if (editingConfigId === config.id) {
        setEditingConfigId(next[0]?.id || null);
        setMasterConfig(next[0] ? { ...EMPTY_PROTOCOL_CONFIG, ...next[0] } : { ...EMPTY_PROTOCOL_CONFIG });
      }
      setConfigError(null);
      setConfigSuccess(false);
      addLog(`[CONFIG DELETE] Configuration « ${config.name} » supprimée.`);
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterConfig) return;
    setConfigSaving(true);
    setConfigSuccess(false);
    setConfigError(null);

    try {
      const isEditing = Boolean(editingConfigId);
      const url = isEditing
        ? `/api/v1/admin/protocol-configs/${encodeURIComponent(editingConfigId as string)}`
        : '/api/v1/admin/protocol-configs';
      const response = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          name: masterConfig.name,
          serverHost: masterConfig.serverHost,
          host: masterConfig.host,
          serverPort: Number(masterConfig.serverPort),
          protocol: masterConfig.protocol,
          transport: masterConfig.transport,
          path: masterConfig.path,
          sniHost: masterConfig.sniHost,
          payload: masterConfig.payload,
          remarks: masterConfig.remarks
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'La configuration n’a pas pu être sauvegardée.');
      const config = payload.config as MasterConfig;
      const configs = Array.isArray(payload.configs) ? payload.configs as MasterConfig[] : [...protocolConfigs.filter(item => item.id !== config.id), config];
      setProtocolConfigs(configs);
      setAvailableConfigs(configs.map(item => ({ id: item.id || '', name: item.name, protocol: item.protocol, transport: item.transport, serverPort: item.serverPort })));
      setEditingConfigId(config.id || null);
      setMasterConfig({ ...EMPTY_PROTOCOL_CONFIG, ...config });
      setConfigSuccess(true);
      setTimeout(() => setConfigSuccess(false), 3500);
      addLog(`[PROTOCOL CONFIG] Configuration « ${config.name} » ${isEditing ? 'mise à jour' : 'créée'}.`);
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error));
    } finally {
      setConfigSaving(false);
    }
  };

  // Open QR Code Modal
  const openQrModal = (token: ClientToken) => {
    setQrModalToken(token);
    QRCode.toDataURL(token.encryptedLink, {
      width: 280,
      margin: 2,
      color: { dark: '#030712', light: '#10b981' }
    })
      .then(url => setQrCodeDataUrl(url))
      .catch(console.error);
  };

  // Open Multi-Variants & Subscription Modal
  const openVariantsModal = async (token: ClientToken) => {
    setVariantsModalToken(token);
    setVariantsModalOpen(true);
    setVariantsLoading(true);
    setVariantsList([]);
    try {
      const res = await fetch(`/api/v1/admin/tokens/${token.id}/variants`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setVariantsList(data.variants || []);
        setVariantsSubUrl(data.subscriptionUrl || `/sub/${token.token}`);
        setVariantsClientJson(data.xrayClient);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setVariantsLoading(false);
    }
  };

  // Plan Handlers
  const handleOpenPlanModal = (plan?: PricingPlan) => {
    if (plan) {
      setEditingPlanId(plan.id);
      setPlanName(plan.name);
      setPlanQuotaGb(plan.quotaGb);
      setPlanDurationDays(plan.durationDays);
      setPlanPriceCfa(plan.priceCfa);
      setPlanBadge(plan.badge || 'PRO');
      setPlanDesc(plan.description || '');
    } else {
      setEditingPlanId(null);
      setPlanName('');
      setPlanQuotaGb(25);
      setPlanDurationDays(30);
      setPlanPriceCfa(3500);
      setPlanBadge('POPULAIRE');
      setPlanDesc('');
    }
    setPlanModalOpen(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/v1/admin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({
          id: editingPlanId || undefined,
          name: planName,
          quotaGb: Number(planQuotaGb),
          durationDays: Number(planDurationDays),
          priceCfa: Number(planPriceCfa),
          badge: planBadge,
          description: planDesc
        })
      });
      if (res.ok) {
        setPlanModalOpen(false);
        refreshData();
        addLog(`[PLAN] Forfait ${planName} enregistré (${planQuotaGb} Go, ${planPriceCfa} FCFA).`);
      } else {
        const d = await res.json();
        alert(d.error || 'Erreur lors de la sauvegarde du forfait.');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeletePlan = async (id: string, name: string) => {
    if (!confirm(`Supprimer le forfait commercial "${name}" ?`)) return;
    try {
      const res = await fetch(`/api/v1/admin/plans/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        refreshData();
        addLog(`[PLAN DELETE] Forfait ${name} supprimé.`);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Membership Request Handlers
  const handleApproveRequest = async (reqId: string, name: string) => {
    setRequestActionLoading(reqId);
    try {
      const res = await fetch(`/api/v1/admin/requests/${reqId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (res.ok) {
        refreshData();
        addLog(`[ADHESION APPROVE] Demande de ${name} validée ! Token: ${data.token?.token}`);
        alert(`Demande approuvée avec succès !\n\nClient : ${name}\nCode Token généré : ${data.token?.token}\nLien d'abonnement : /sub/${data.token?.token}`);
      } else {
        alert(data.error || 'Erreur lors de la validation.');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setRequestActionLoading(null);
    }
  };

  const handleRejectRequest = async (reqId: string, name: string) => {
    const reason = prompt(`Motif du rejet pour ${name} :`, 'Paiement non confirmé');
    if (reason === null) return;
    setRequestActionLoading(reqId);
    try {
      const res = await fetch(`/api/v1/admin/requests/${reqId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ reason })
      });
      if (res.ok) {
        refreshData();
        addLog(`[ADHESION REJECT] Demande de ${name} rejetée.`);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setRequestActionLoading(null);
    }
  };

  const handleDeleteRequest = async (reqId: string) => {
    if (!confirm('Supprimer définitivement cette demande de la base ?')) return;
    try {
      const res = await fetch(`/api/v1/admin/requests/${reqId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        refreshData();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Network Probe Handler
  const handleRunProbe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!probeHost.trim()) return;
    setProbeLoading(true);
    setProbeResult(null);
    try {
      const res = await fetch('/api/v1/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: probeHost.trim(),
          port: Number(probePort) || 443,
          tls: probeTls,
          sni: probeSni.trim() || undefined
        })
      });
      const data = await res.json();
      setProbeResult(data);
      addLog(`[PROBE] Sonde sur ${probeHost}:${probePort} -> ${data.success ? `OK (${data.tcpLatencyMs}ms)` : `Échec: ${data.error}`}`);
    } catch (err: unknown) {
      setProbeResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setProbeLoading(false);
    }
  };

  // Announcements Handlers
  const fetchAnnouncements = async () => {
    if (!authToken || currentUser?.role !== 'SUPER_ADMIN') return;
    try {
      const res = await fetch('/api/v1/admin/announcements', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annMessage.trim()) return;
    setAnnLoading(true);
    try {
      const res = await fetch('/api/v1/admin/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title: annTitle.trim(),
          message: annMessage.trim(),
          type: annType,
          targetPlatform: annPlatform,
          isMandatory: annIsMandatory,
          actionButtonText: annBtnText.trim() || undefined,
          actionButtonUrl: annBtnUrl.trim() || undefined,
          showMode: annShowMode,
          priority: annIsMandatory ? 100 : 10
        })
      });
      if (res.ok) {
        setAnnouncementModalOpen(false);
        setAnnTitle('');
        setAnnMessage('');
        setAnnType('INFO');
        setAnnPlatform('ALL');
        setAnnIsMandatory(false);
        setAnnBtnText('En savoir plus');
        setAnnBtnUrl('https://t.me/Abess_Vpn');
        setAnnShowMode('ONCE_PER_USER');
        await fetchAnnouncements();
        addLog(`[ANNONCE PUBLIÉE] "${annTitle}" diffusée vers ${annPlatform}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAnnLoading(false);
    }
  };

  const handleToggleAnnouncement = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/v1/admin/announcements/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ isActive: !currentActive })
      });
      if (res.ok) {
        await fetchAnnouncements();
        addLog(`[ANNONCE STATUT] ${id} -> ${!currentActive ? 'ACTIVÉE' : 'DÉSACTIVÉE'}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteAnnouncement = async (id: string, title: string) => {
    if (!confirm(`Supprimer définitivement l'annonce "${title}" ?`)) return;
    try {
      const res = await fetch(`/api/v1/admin/announcements/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        await fetchAnnouncements();
        addLog(`[ANNONCE SUPPRIMÉE] "${title}"`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ==========================================
  // LOGIN SCREEN
  // ==========================================
  if (!currentUser) {
    return (
      <div className="login-page min-h-screen bg-[#03060e] text-emerald-400 font-sans selection:bg-emerald-500 selection:text-black">
        <aside className="login-story" aria-label="Bienvenue sur AbessVPN">
          <div className="login-wordmark"><Shield size={25} aria-hidden="true" /> ABESS<span>VPN</span><span className="brand-edition">BUSINESS</span></div>
          <div className="login-story-content">
            <span className="eyebrow">UNE CONNEXION. TOUTES LES POSSIBILITÉS.</span>
            <h2>Votre réseau.<br />Votre <span>ambition.</span></h2>
            <p>Une plateforme pour piloter vos licences, accompagner vos revendeurs et garder le contrôle de votre activité.</p>
            <div className="login-features">
              <span><Key size={16} aria-hidden="true" /> Gestion des licences</span>
              <span><Users size={16} aria-hidden="true" /> Réseau de revendeurs</span>
              <span><Activity size={16} aria-hidden="true" /> Suivi des quotas</span>
            </div>
          </div>
          <div className="login-orbit" aria-hidden="true"><div className="orbit-ring orbit-ring-two" /><div className="orbit-ring" /><div className="orbit-core"><Shield size={58} strokeWidth={1.2} /></div></div>
          <p className="login-story-footer">L’essentiel de votre réseau, au même endroit.</p>
        </aside>
        <div className="login-form-area">
        <div className="login-card w-full max-w-md bg-[#060c18] border border-emerald-900/80 rounded-3xl p-6 sm:p-8 relative overflow-hidden space-y-6">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="px-2.5 py-1 rounded-lg border text-[10px] font-bold flex items-center gap-1.5 transition bg-slate-900/50 hover:bg-slate-800 text-slate-300 border-slate-700"
              title="Basculer le mode d'affichage"
            >
              {theme === 'light' ? (
                <>
                  <Moon className="w-3 h-3 text-slate-700" />
                  <span>Mode sombre</span>
                </>
              ) : (
                <>
                  <Sun className="w-3 h-3 text-amber-400" />
                  <span>Mode clair</span>
                </>
              )}
            </button>
          </div>
          <div className="text-center space-y-2">
            <div className="h-14 w-14 mx-auto rounded-2xl bg-gradient-to-tr from-emerald-500 to-cyan-500 p-0.5 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
              <div className="w-full h-full bg-[#03060e] rounded-[14px] flex items-center justify-center">
                <Shield className="w-7 h-7 text-emerald-400 animate-pulse" />
              </div>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Heureux de vous revoir</h1>
            <p className="text-sm text-slate-400">Connectez-vous à votre espace de gestion.</p>
          </div>

          {loginError && (
            <div className="p-3 bg-red-950/40 border border-red-500/50 rounded-xl text-xs text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            <div>
              <label htmlFor="login-email" className="block text-slate-300 font-semibold mb-2 text-xs">Adresse email</label>
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="admin@votre-domaine.com"
                className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-400 font-sans"
                required
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-slate-300 font-semibold mb-2 text-xs">Mot de passe</label>
              <div className="relative">
                <input
                  id="login-password"
                  autoComplete="current-password"
                  type={showPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-400 font-sans pr-10"
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3.5 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl text-xs flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] transition"
            >
              <Lock className={`w-4 h-4 ${loginLoading ? 'animate-spin' : ''}`} />
              <span>{loginLoading ? 'Connexion en cours...' : 'Se connecter'}</span>
            </button>
          </form>
          <p className="login-help"><Lock size={12} aria-hidden="true" /> Accès réservé aux administrateurs et revendeurs.</p>
        </div>
        <p className="login-copyright">ABESSVPN · Votre espace professionnel</p>
        </div>
      </div>
    );
  }

  // ==========================================
  // AUTHENTICATED PANEL
  // ==========================================
  return (
    <div className="panel-app min-h-screen bg-[#03060e] text-emerald-400 font-sans flex flex-col selection:bg-emerald-500 selection:text-black">
      <a className="skip-link" href="#main-content">Aller au contenu</a>
      {/* Account bar */}
      <div className="border-b border-emerald-950 bg-black/90 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3 text-emerald-400">
        <div className="flex items-center gap-3">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="font-bold tracking-widest text-white">
            ABESS<span className="text-emerald-400">VPN</span> BUSINESS
          </span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
            currentUser.role === 'SUPER_ADMIN' ? 'bg-amber-950 text-amber-300 border border-amber-500/50' : 'bg-cyan-950 text-cyan-300 border border-cyan-500/50'
          }`}>
            {currentUser.role === 'SUPER_ADMIN' ? 'SUPER ADMINISTRATEUR' : 'ESPACE REVENDEUR AGRÉÉ'}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs">
          {currentUser.role === 'RESELLER' && (
            <div className="flex items-center gap-1.5 bg-cyan-950/60 px-3 py-1 rounded-lg border border-cyan-800">
              <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
              <span>Solde Crédits :</span>
              <strong className="text-white font-bold">{currentUser.credits} Go</strong>
            </div>
          )}

          <span className="text-slate-300">
            Connecté : <strong className="text-emerald-300">{currentUser.name}</strong> ({currentUser.email})
          </span>

          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition border ${
              theme === 'light'
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                : 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-amber-500/40'
            }`}
            title="Basculer entre Mode clair et Mode sombre"
          >
            {theme === 'light' ? (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-700" />
                <span>Mode sombre</span>
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Mode clair</span>
              </>
            )}
          </button>

          <button
            onClick={handleLogout}
            className="px-2.5 py-1 bg-red-950/60 hover:bg-red-900 border border-red-800 text-red-300 rounded text-[11px] flex items-center gap-1 transition"
          >
            <LogOut className="w-3 h-3" />
            <span>Déconnexion</span>
          </button>
        </div>
      </div>

      {/* Main Server Header */}
      <header className="border-b border-emerald-900/40 bg-[#050a15]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 via-cyan-500 to-indigo-600 p-0.5 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <div className="w-full h-full bg-[#03060e] rounded-[10px] flex items-center justify-center">
                <Server className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-wider text-white">
                  Votre centre de gestion
                </h1>
                <span className="text-[10px] text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5">CONSOLE</span>
              </div>
              <p className="text-xs text-slate-400">
                {currentUser.role === 'SUPER_ADMIN'
                  ? 'Gestion Totale : Revendeurs, Crédits, Infrastructure & Quotas'
                  : 'Distribution Commerciale de Tokens Clients avec Quotas Fixes'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                setNewTokenCode(generateUnifiedToken());
                setTokenCreationError(null);
                setNewTokenConfigurationId(current => current && availableConfigs.some(config => config.id === current) ? current : (availableConfigs[0]?.id || ''));
                setTokenCreationError(null);
                setTokenModalOpen(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl text-xs flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition"
            >
              <Plus className="w-4 h-4" />
              <span>Nouvelle licence</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <nav aria-label="Navigation principale" className="panel-navigation flex space-x-1 sm:space-x-2 border-t border-emerald-900/40 overflow-x-auto py-1 scrollbar-none text-xs">
            {[
              { id: 'overview', label: 'Tableau de Bord', icon: Activity },
              {
                id: 'resellers',
                label: currentUser.role === 'SUPER_ADMIN' ? 'Gestion des Revendeurs' : 'Mes Sous-Revendeurs',
                icon: Users
              },
              ...(currentUser.role === 'SUPER_ADMIN'
                ? [
                    { id: 'infrastructure', label: 'Infrastructure Maître', icon: Database },
                  ]
                : []),
              { id: 'tokens', label: 'Clients & Licences', icon: Key },
              { id: 'plans', label: 'Plans & Tarifs', icon: Tag },
              ...(currentUser.role === 'SUPER_ADMIN'
                ? [
                    {
                      id: 'requests',
                      label: `Adhésions${requests.filter(r => r.status === 'PENDING').length > 0 ? ` (${requests.filter(r => r.status === 'PENDING').length})` : ''}`,
                      icon: PhoneCall
                    },
                    { id: 'diagnostics', label: 'Diagnostics & Sonde', icon: Gauge },
                    {
                      id: 'announcements',
                      label: `Annonces Réseau${announcements.filter(a => a.isActive).length > 0 ? ` (${announcements.filter(a => a.isActive).length})` : ''}`,
                      icon: Megaphone
                    },
                  ]
                : []),
              { id: 'transactions', label: 'Registre & Crédits', icon: History },
              { id: 'logs', label: 'Journal & Télémétrie', icon: Terminal },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`panel-tab flex items-center gap-2 px-3.5 py-2 rounded-lg transition whitespace-nowrap font-bold ${
                    isActive
                      ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                      : 'text-slate-400 hover:text-emerald-400 hover:bg-emerald-950/20'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Body */}
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full space-y-6">

        {/* ========================================================================= */}
        {/* TAB 1: OVERVIEW METRICS */}
        {/* ========================================================================= */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
            <WorkspaceWelcome name={currentUser.name} refreshing={refreshing} updatedAt={updatedAt} error={syncError} onRefresh={() => void refreshData()} onOpenLicences={() => setActiveTab('tokens')} />
            {currentUser.role === 'SUPER_ADMIN' ? (
              // Super Admin Global Stats
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
                <div className="p-4 rounded-2xl bg-[#060c18] border border-emerald-900/60 space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="font-bold uppercase text-[10px]">Revendeurs Agréés</span>
                    <Users className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-black text-white">{stats?.totalResellers ?? resellers.length}</div>
                  <span className="text-[10px] text-emerald-400">Comptes distributeurs actifs</span>
                </div>

                <div className="p-4 rounded-2xl bg-[#060c18] border border-cyan-900/60 space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="font-bold uppercase text-[10px]">Crédits en Circulation</span>
                    <CreditCard className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="text-2xl font-black text-cyan-300 font-mono">
                    {stats?.totalCreditsInCirculation ?? '—'} Go
                  </div>
                  <span className="text-[10px] text-slate-400">Solde total alloué aux revendeurs</span>
                </div>

                <div className="p-4 rounded-2xl bg-[#060c18] border border-indigo-900/60 space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="font-bold uppercase text-[10px]">Clients Finaux Actifs</span>
                    <Key className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="text-2xl font-black text-indigo-300 font-mono">
                    {stats?.totalTokens ?? tokens.length} Tokens
                  </div>
                  <span className="text-[10px] text-indigo-400">{stats?.activeTokens ?? tokens.length} connectables</span>
                </div>

                <div className="p-4 rounded-2xl bg-[#060c18] border border-amber-900/60 space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="font-bold uppercase text-[10px]">Bande Passante Allouée</span>
                    <HardDrive className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-2xl font-black text-amber-300 font-mono">
                    {stats?.totalBandwidthAllocated ?? '—'} Go
                  </div>
                  <span className="text-[10px] text-slate-400">Consommation : {stats?.totalBandwidthConsumed ?? '—'} Go</span>
                </div>
              </div>
            ) : (
              // Reseller Dashboard Stats
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
                <div className="p-5 rounded-2xl bg-cyan-950/30 border border-cyan-500/50 space-y-2">
                  <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider block">
                    Votre Solde de Crédits Disponible
                  </span>
                  <div className="text-3xl font-black text-white">{currentUser.credits} Go</div>
                  <p className="text-slate-300 text-[11px]">
                    Quota disponible pour clients ou sous-revendeurs.
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-[#060c18] border border-purple-900/60 space-y-2">
                  <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider block">
                    Mes Sous-Revendeurs
                  </span>
                  <div className="text-3xl font-black text-purple-300 font-mono">{resellers.length}</div>
                  <p className="text-slate-400 text-[11px]">
                    {resellers.filter(r => r.status === 'active').length} comptes actifs dans votre réseau
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-[#060c18] border border-emerald-900/60 space-y-2">
                  <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">
                    Clients Créés
                  </span>
                  <div className="text-3xl font-black text-emerald-300 font-mono">{tokens.length}</div>
                  <p className="text-slate-400 text-[11px]">
                    {tokens.filter(t => t.status === 'active').length} licences actuellement actives
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-[#060c18] border border-indigo-900/60 space-y-2">
                  <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider block">
                    Volume Distribué
                  </span>
                  <div className="text-3xl font-black text-indigo-300 font-mono">
                    {tokens.reduce((acc, t) => acc + t.bandwidthGb, 0)} Go
                  </div>
                  <p className="text-slate-400 text-[11px]">Total des quotas alloués à vos clients</p>
                </div>
              </div>
            )}

            {/* Quick Actions Card */}
            <div className="p-6 rounded-2xl bg-[#060c18] border border-emerald-950 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400" />
                Actions Rapides
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <button
                  onClick={() => {
                    setNewTokenCode(generateUnifiedToken());
                    setNewTokenConfigurationId(current => current && availableConfigs.some(config => config.id === current) ? current : (availableConfigs[0]?.id || ''));
                setTokenCreationError(null);
                setTokenModalOpen(true);
                  }}
                  className="p-4 rounded-xl bg-black/60 border border-emerald-900/60 hover:border-emerald-500 text-left transition group"
                >
                  <Plus className="w-5 h-5 text-emerald-400 mb-2 group-hover:scale-110 transition" />
                  <strong className="text-white block mb-0.5">Créer un Forfait Client</strong>
                  <span className="text-slate-400 text-[11px]">Définir quota en Go et date d'expiration</span>
                </button>

                <button
                  onClick={() => setResellerModalOpen(true)}
                  className="p-4 rounded-xl bg-black/60 border border-emerald-900/60 hover:border-cyan-500 text-left transition group"
                >
                  <Users className="w-5 h-5 text-cyan-400 mb-2 group-hover:scale-110 transition" />
                  <strong className="text-white block mb-0.5">
                    {currentUser.role === 'SUPER_ADMIN' ? 'Nouveau Revendeur' : 'Nouveau Sous-Revendeur'}
                  </strong>
                  <span className="text-slate-400 text-[11px]">
                    {currentUser.role === 'SUPER_ADMIN' ? 'Créer un compte distributeur et le créditer' : 'Créer un sous-revendeur et lui déléguer des Gigas'}
                  </span>
                </button>

                {currentUser.role === 'SUPER_ADMIN' ? (
                  <button
                    onClick={() => setActiveTab('infrastructure')}
                    className="p-4 rounded-xl bg-black/60 border border-emerald-900/60 hover:border-indigo-500 text-left transition group"
                  >
                    <Database className="w-5 h-5 text-indigo-400 mb-2 group-hover:scale-110 transition" />
                    <strong className="text-white block mb-0.5">Configurer Infrastructure</strong>
                    <span className="text-slate-400 text-[11px]">Gérer serveurs Xray, ports et protocoles</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setActiveTab('tokens')}
                    className="p-4 rounded-xl bg-black/60 border border-emerald-900/60 hover:border-indigo-500 text-left transition group"
                  >
                    <Key className="w-5 h-5 text-indigo-400 mb-2 group-hover:scale-110 transition" />
                    <strong className="text-white block mb-0.5">Gérer mes Licences</strong>
                    <span className="text-slate-400 text-[11px]">Consulter, exporter ou réinitialiser les appareils</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: RESELLERS & SUB-RESELLERS MANAGEMENT */}
        {/* ========================================================================= */}
        {activeTab === 'resellers' && (currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'RESELLER') && (
          <div className="space-y-6 animate-fade-in font-mono text-xs">
            <div className="p-6 rounded-2xl bg-[#060c18] border border-emerald-900/80 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-emerald-950">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-emerald-400" />
                    {currentUser.role === 'SUPER_ADMIN' ? 'Gestion des Revendeurs Agréés' : 'Gestion de mes Sous-Revendeurs'}
                  </h2>
                  <p className="text-slate-400 text-xs mt-0.5">
                    {currentUser.role === 'SUPER_ADMIN'
                      ? 'Créez des accès revendeurs et rechargez leur solde de crédits (Gigas). Les revendeurs ne voient JAMAIS les hôtes, SNI ou IPs maîtres.'
                      : `Créez des accès pour vos sous-revendeurs et dotez-les en crédits depuis votre solde disponible (${currentUser.credits} Go). Ils bénéficient de toutes les fonctionnalités pour gérer leurs clients et sous-revendeurs.`}
                  </p>
                </div>

                <button
                  onClick={() => setResellerModalOpen(true)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl text-xs flex items-center gap-1.5 transition shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>{currentUser.role === 'SUPER_ADMIN' ? 'Nouveau Revendeur' : 'Nouveau Sous-Revendeur'}</span>
                </button>
              </div>

              {/* Resellers Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-emerald-950 text-slate-500 text-[10px] uppercase">
                      <th className="py-2.5 px-3">Revendeur</th>
                      <th className="py-2.5 px-3">Email de Connexion</th>
                      {currentUser.role === 'SUPER_ADMIN' && (
                        <th className="py-2.5 px-3">Créé Par</th>
                      )}
                      <th className="py-2.5 px-3">Solde Crédits (Go)</th>
                      <th className="py-2.5 px-3">Sous-Revendeurs</th>
                      <th className="py-2.5 px-3">Tokens Générés</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-950/60">
                    {resellers.map((r) => (
                      <tr key={r.id} className="hover:bg-emerald-950/20 transition">
                        <td className="py-3 px-3 font-bold text-white">{r.name}</td>
                        <td className="py-3 px-3 text-slate-300">{r.email}</td>
                        {currentUser.role === 'SUPER_ADMIN' && (
                          <td className="py-3 px-3">
                            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950/50 border border-cyan-800 text-cyan-300">
                              {r.parentName || 'Super Admin'}
                            </span>
                          </td>
                        )}
                        <td className="py-3 px-3 font-bold text-cyan-300 text-sm">{r.credits} Go</td>
                        <td className="py-3 px-3 font-bold text-purple-400">{r.subResellersCount || 0}</td>
                        <td className="py-3 px-3 text-emerald-400">{r.totalTokensCreated || 0} clients</td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.status === 'active'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-red-500/20 text-red-300 border border-red-500/40'
                          }`}>
                            {r.status === 'active' ? 'ACTIF' : 'SUSPENDU'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setCreditingReseller(r);
                                setCreditAmount(currentUser.role === 'SUPER_ADMIN' ? 100 : Math.min(50, currentUser.credits));
                              }}
                              className="px-2.5 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 rounded text-[11px] font-bold"
                              title="Recharger le compte en Gigas"
                            >
                              + Créditer
                            </button>

                            <button
                              onClick={() => handleToggleResellerStatus(r)}
                              className="p-1.5 text-slate-400 hover:text-white"
                              title={r.status === 'active' ? 'Suspendre' : 'Activer'}
                            >
                              {r.status === 'active' ? <UserX className="w-4 h-4 text-amber-400" /> : <UserCheck className="w-4 h-4 text-emerald-400" />}
                            </button>

                            <button
                              onClick={() => handleDeleteReseller(r.id, r.email)}
                              className="p-1.5 text-red-400 hover:text-red-300"
                              title="Supprimer définitivement"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {resellers.length === 0 && (
                  <div className="text-center py-12 text-slate-500">
                    <Users className="w-10 h-10 mx-auto mb-2 opacity-30 text-emerald-400" />
                    <p className="font-bold text-slate-300">
                      {currentUser.role === 'SUPER_ADMIN'
                        ? 'Aucun revendeur enregistré.'
                        : 'Vous n’avez aucun sous-revendeur pour le moment.'}
                    </p>
                    <p className="text-[11px] mt-1 text-slate-500">
                      {currentUser.role === 'SUPER_ADMIN'
                        ? 'Créez un premier revendeur avec le bouton ci-dessus.'
                        : 'Cliquez sur « Nouveau Sous-Revendeur » pour déléguer des Gigas et étendre votre réseau.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: CLIENTS & GENERATED TOKENS */}
        {/* ========================================================================= */}
        {activeTab === 'tokens' && (
          <div className="space-y-6 animate-fade-in font-mono text-xs">
            <div className="p-6 rounded-2xl bg-[#060c18] border border-emerald-900/80 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-emerald-950">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Key className="w-5 h-5 text-emerald-400" />
                    {currentUser.role === 'SUPER_ADMIN' ? 'Tous les Tokens Clients de la Plateforme' : 'Mes Clients & Licences Générées'}
                  </h2>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Chaque client possède un quota de Gigas fixe et une date d'expiration.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={exportTokensCsv}
                    className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 font-bold rounded-xl text-xs flex items-center gap-1.5 transition shrink-0"
                    title="Télécharger la liste au format CSV"
                  >
                    <FileText className="w-4 h-4 text-slate-400" />
                    <span>Export CSV</span>
                  </button>

                  <button
                    onClick={() => {
                      setBatchModalOpen(true);
                      setBatchError(null);
                      setBatchResult(null);
                      setBatchConfigId(availableConfigs[0]?.id || '');
                    }}
                    className="px-3.5 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-black rounded-xl text-xs flex items-center gap-1.5 transition shrink-0 shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Génération en Masse (Vouchers)</span>
                  </button>

                  <button
                    onClick={() => {
                      setNewTokenCode(generateUnifiedToken());
                      setTokenCreationError(null);
                      setNewTokenConfigurationId(current => current && availableConfigs.some(config => config.id === current) ? current : (availableConfigs[0]?.id || ''));
                      setNewTokenCustomerNote('');
                      setTokenModalOpen(true);
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl text-xs flex items-center gap-1.5 transition shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Créer un Token Client</span>
                  </button>
                </div>
              </div>

              {/* Search & Filter Toolbar */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-[#040812] p-3 rounded-xl border border-emerald-950">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={tokenSearchQuery}
                    onChange={(e) => setTokenSearchQuery(e.target.value)}
                    placeholder="Filtrer par code token, client, note, ou revendeur..."
                    className="w-full bg-black/60 border border-emerald-950/80 rounded-lg pl-9 pr-3 py-1.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="flex items-center gap-1 overflow-x-auto text-[11px]">
                  {(['ALL', 'active', 'expired', 'quota_exceeded', 'revoked'] as const).map(statusKey => (
                    <button
                      key={statusKey}
                      onClick={() => setTokenStatusFilter(statusKey)}
                      className={`px-2.5 py-1 rounded-md font-bold transition whitespace-nowrap ${
                        tokenStatusFilter === statusKey
                          ? 'bg-emerald-500 text-black'
                          : 'text-slate-400 hover:text-white bg-slate-900/60'
                      }`}
                    >
                      {statusKey === 'ALL' ? 'Tous' : statusKey === 'active' ? 'Actifs' : statusKey === 'expired' ? 'Expirés' : statusKey === 'quota_exceeded' ? 'Quota Atteint' : 'Suspendus'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tokens Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-emerald-950 text-slate-500 text-[10px] uppercase">
                      <th className="py-2.5 px-3">Token Client</th>
                      <th className="py-2.5 px-3">Plan Commercial</th>
                      <th className="py-2.5 px-3">Configuration</th>
                      {(currentUser.role === 'SUPER_ADMIN' || resellers.length > 0) && <th className="py-2.5 px-3">Revendeur / Émetteur</th>}
                      <th className="py-2.5 px-3">Quota Go</th>
                      <th className="py-2.5 px-3">Consommé</th>
                      <th className="py-2.5 px-3">Expiration</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3 text-right">Lien Crypté &amp; Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-950/60">
                    {tokens
                    .filter(t => {
                      if (tokenStatusFilter !== 'ALL' && t.status !== tokenStatusFilter) return false;
                      if (!tokenSearchQuery.trim()) return true;
                      const q = tokenSearchQuery.toLowerCase().trim();
                      return (
                        t.token.toLowerCase().includes(q) ||
                        (t.customerNote && t.customerNote.toLowerCase().includes(q)) ||
                        (t.resellerName && t.resellerName.toLowerCase().includes(q)) ||
                        (t.plan && t.plan.toLowerCase().includes(q))
                      );
                    })
                    .map((token) => (
                      <tr key={token.id} className="hover:bg-emerald-950/20 transition">
                        <td className="py-3 px-3 font-bold text-emerald-300">
                          <div className="flex items-center gap-1.5">
                            <span>{token.token}</span>
                            <button
                              onClick={() => copyToClipboard(token.token, token.id)}
                              className="text-slate-500 hover:text-emerald-400"
                              title="Copier le code token"
                            >
                              {copiedKey === token.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          {token.customerNote && (
                            <div className="text-[10px] text-amber-300/90 font-sans mt-0.5 flex items-center gap-1">
                              <span>👤</span>
                              <span>{token.customerNote}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-300">{token.plan}</td>
                        <td className="py-3 px-3">
                          <span className="text-cyan-200 font-semibold">{token.configurationName || 'Configuration historique'}</span>
                          {token.allowedDeviceId && <div className="mt-1 text-[10px] text-amber-300 break-all">ID lié : {token.allowedDeviceId}</div>}
                        </td>
                        {(currentUser.role === 'SUPER_ADMIN' || resellers.length > 0) && (
                          <td className="py-3 px-3 text-cyan-400 font-semibold">{token.resellerName}</td>
                        )}
                        <td className="py-3 px-3 font-bold text-white text-sm">{token.bandwidthGb} Go</td>
                        <td className="py-3 px-3 text-slate-400">{token.bandwidthUsedGb.toFixed(2)} Go</td>
                        <td className="py-3 px-3 text-slate-300">
                          {new Date(token.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            token.status === 'active'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : token.status === 'revoked'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-red-500/20 text-red-300 border border-red-500/40'
                          }`}>
                            {token.status === 'active' ? 'ACTIF' : token.status === 'revoked' ? 'SUSPENDU' : token.status === 'quota_exceeded' ? 'QUOTA ÉPUISÉ' : 'EXPIRÉ'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => copyToClipboard(token.encryptedLink, `link_${token.id}`)}
                              className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded text-[11px] flex items-center gap-1"
                              title="Copier le lien crypté abess://"
                            >
                              {copiedKey === `link_${token.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <FileKey className="w-3 h-3 text-emerald-400" />}
                              <span>{copiedKey === `link_${token.id}` ? 'Copié !' : 'Lien abess://'}</span>
                            </button>

                            {token.directLink && (
                              <button
                                onClick={() => copyToClipboard(token.directLink!, `dir_${token.id}`)}
                                className="px-2 py-1 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-800 text-cyan-300 rounded text-[11px] flex items-center gap-1"
                                title="Copier le lien direct V2Ray / Universel"
                              >
                                {copiedKey === `dir_${token.id}` ? <Check className="w-3 h-3 text-cyan-400" /> : <Share2 className="w-3 h-3 text-cyan-400" />}
                                <span>{copiedKey === `dir_${token.id}` ? 'Copié !' : 'Lien V2Ray'}</span>
                              </button>
                            )}

                            {(token.protocolType === 'ssh' || token.sshConfig) && (
                              <button
                                onClick={async () => {
                                  try {
                                    const res = await fetch(`/api/v1/ssh/config/${token.token}`);
                                    if (res.ok) {
                                      const cfg = await res.json();
                                      copyToClipboard(JSON.stringify(cfg, null, 2), `ssh_${token.id}`);
                                    } else {
                                      copyToClipboard(token.directLink || '', `ssh_${token.id}`);
                                    }
                                  } catch {
                                    copyToClipboard(token.directLink || '', `ssh_${token.id}`);
                                  }
                                }}
                                className="px-2 py-1 bg-amber-950/60 hover:bg-amber-900/60 border border-amber-800 text-amber-300 rounded text-[11px] flex items-center gap-1 font-bold"
                                title="Copier la configuration JSON SSH-Payload (Peddygist / HTTP Injector)"
                              >
                                {copiedKey === `ssh_${token.id}` ? <Check className="w-3 h-3 text-amber-400" /> : <Terminal className="w-3 h-3 text-amber-400" />}
                                <span>{copiedKey === `ssh_${token.id}` ? 'Copié !' : 'JSON SSH'}</span>
                              </button>
                            )}

                            <button
                              onClick={() => openQrModal(token)}
                              className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-slate-300"
                              title="Afficher QR Code"
                            >
                              <Zap className="w-3.5 h-3.5 text-cyan-400" />
                            </button>

                            <button
                              onClick={() => openVariantsModal(token)}
                              className="px-2 py-1 bg-indigo-950/60 hover:bg-indigo-900/60 border border-indigo-700 text-indigo-300 rounded text-[11px] flex items-center gap-1"
                              title="Portail Universel & Multi-Variantes VLESS"
                            >
                              <Globe className="w-3 h-3 text-indigo-400" />
                              <span>Variantes & Portail</span>
                            </button>

                            <button
                              onClick={() => handleResetDevices(token.id, token.token)}
                              className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-cyan-400 hover:text-cyan-300"
                              title="Réinitialiser les appareils liés à ce client (changement de téléphone)"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>

                            {(token.status === 'active' || token.status === 'revoked') && (
                              <button
                                onClick={() => void handleToggleTokenStatus(token.id, token.token, token.status)}
                                className={`p-1.5 rounded ${token.status === 'active' ? 'text-amber-300 hover:bg-amber-950/50' : 'text-emerald-300 hover:bg-emerald-950/50'}`}
                                title={token.status === 'active' ? 'Suspendre le token sans le supprimer' : 'Réactiver le token'}
                              >
                                {token.status === 'active' ? <Lock className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteToken(token.id, token.token)}
                              className="p-1.5 text-red-400 hover:text-red-300"
                              title="Supprimer définitivement ce token"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: MASTER INFRASTRUCTURE CONFIG (SUPER ADMIN ONLY - STRICTLY CONFIDENTIAL) */}
        {/* ========================================================================= */}
        {activeTab === 'infrastructure' && currentUser.role === 'SUPER_ADMIN' && (
          <div className="space-y-6 animate-fade-in font-mono text-xs">
            <section className="rounded-2xl border border-emerald-900/80 bg-[#060c18] p-5 sm:p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-emerald-950 pb-3">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2"><Database className="w-5 h-5 text-amber-400" />Configurations de protocoles</h2>
                  <p className="text-slate-400 mt-1">Crée plusieurs profils, puis choisis le profil à associer à chaque token. Cette section et les paramètres Host/SNI sont réservés à l’administrateur principal.</p>
                </div>
                <button type="button" onClick={handleNewProtocolConfig} className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-black font-black flex items-center gap-2 hover:bg-emerald-500">
                  <Plus className="w-4 h-4" /> Nouvelle configuration
                </button>
              </div>

              {configLoading && <p className="text-cyan-300 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />Chargement des configurations…</p>}
              {configLoadError && (
                <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-red-200 space-y-3">
                  <p className="font-bold">Impossible de charger les configurations.</p>
                  <p className="break-words">{configLoadError}</p>
                  <button type="button" onClick={() => void loadProtocolConfigData()} className="rounded-lg bg-red-900/60 px-3 py-2 font-bold">Réessayer</button>
                </div>
              )}
              {configSuccess && <div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3 text-emerald-300 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Configuration enregistrée.</div>}
              {configError && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/30 p-3 text-red-200">{configError}</div>}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {protocolConfigs.map((config) => (
                  <div key={config.id || config.name} className={`rounded-xl border p-4 space-y-3 ${editingConfigId === config.id ? 'border-emerald-500/70 bg-emerald-950/20' : 'border-slate-800 bg-[#03060e]'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-white font-bold break-words">{config.name}</p>
                        <p className="mt-1 text-emerald-300 uppercase">{config.protocol} · {config.transport}</p>
                      </div>
                      <span className="shrink-0 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300">{config.serverPort}</span>
                    </div>
                    <div className="text-slate-400 space-y-1 break-all">
                      <p>Destination : <span className="text-slate-200">{config.serverHost}</span></p>
                      <p>Host HTTP : <span className="text-cyan-200">{config.host || 'identique à la destination'}</span></p>
                      <p>SNI : <span className="text-amber-200">{config.sniHost || 'non utilisé'}</span></p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => handleSelectProtocolConfig(config)} className="flex-1 rounded-lg border border-emerald-800 bg-emerald-950/40 py-2 font-bold text-emerald-300 hover:bg-emerald-900/40">Modifier</button>
                      <button type="button" onClick={() => void handleDeleteProtocolConfig(config)} className="rounded-lg border border-red-900/70 px-3 py-2 text-red-300 hover:bg-red-950/50" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
                {protocolConfigs.length === 0 && !configLoading && (
                  <div className="md:col-span-2 xl:col-span-3 rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400">
                    Aucune configuration enregistrée. Clique sur « Nouvelle configuration » pour créer ton premier profil.
                  </div>
                )}
              </div>
            </section>

            {masterConfig && (
              <section className="rounded-2xl border border-emerald-900/80 bg-[#060c18] p-5 sm:p-6 shadow-xl space-y-5">
                <div className="border-b border-emerald-950 pb-3">
                  <h3 className="text-sm font-black text-white">{editingConfigId ? 'Modifier le profil sélectionné' : 'Créer une configuration'}</h3>
                  <p className="mt-1 text-slate-400">L’adresse de destination, le Host HTTP et le SNI TLS sont trois champs distincts.</p>
                </div>

                <form onSubmit={handleSaveConfig} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-slate-300 font-semibold mb-1">Nom de la configuration</label>
                    <input type="text" value={masterConfig.name} onChange={(e) => setMasterConfig({ ...masterConfig, name: e.target.value })} className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-3 text-white" placeholder="Ex. VLESS Premium WS TLS" minLength={2} maxLength={80} required />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Adresse de destination — domaine ou IP</label>
                    <input type="text" value={masterConfig.serverHost} onChange={(e) => setMasterConfig({ ...masterConfig, serverHost: e.target.value })} className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-3 text-emerald-300 font-bold" placeholder="IP publique ou domaine pointant vers ton entrée VPN" required />
                    <p className="mt-1 text-slate-500">C’est l’adresse à laquelle le client se connecte, pas le Host HTTP ni le SNI.</p>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Port du service</label>
                    <input
                      type="number"
                      value={masterConfig.serverPort}
                      readOnly={masterConfig.protocol !== 'ssh'}
                      onChange={(e) => setMasterConfig({ ...masterConfig, serverPort: Number(e.target.value) })}
                      className="w-full bg-[#03060e] border border-slate-800 rounded-lg px-3 py-3 text-slate-300"
                    />
                    <p className="mt-1 text-slate-500">
                      {masterConfig.protocol === 'ssh' ? 'Port Dropbear WebSocket (80 direct ou 8880 proxy).' : 'Calculé selon le transport : HTTPS (443) ou TCP direct (10050).'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Protocole</label>
                    <select
                      value={masterConfig.protocol}
                      onChange={(e) => {
                        const proto = e.target.value;
                        if (proto === 'ssh') {
                          setMasterConfig({
                            ...masterConfig,
                            protocol: 'ssh',
                            transport: 'ws',
                            serverPort: 80,
                            host: 'm.batch.com',
                            path: '/loic',
                            sniHost: masterConfig.serverHost || 'server.nexustunnel.me',
                            payload: masterConfig.payload || 'GET / HTTP/1.1[crlf]FoxNews.com;www.epicgames.com;us.shop.battle.net;unity3d.com;www.icloud.com;www.bing.com;www.samsung.com;store.nintendo.com.br;www.garena.com;n41-06-05.opera-mini.net[crlf]Host: m.batch.com[crlf][crlf]X / HTTP/1.1[crlf]FoxNews.com;www.epicgames.com;us.shop.battle.net;unity3d.com;www.icloud.com;www.bing.com;www.samsung.com;store.nintendo.com.br;www.garena.com;n41-06-05.opera-mini.net[crlf]Host: [host][crlf][crlf]GET /loic HTTP/1.1[crlf]Host: dbl5i9lrmmeui.cloudfront.net[crlf]Backend: crashlyticsreports-pa.googleapis.com[crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf]User-agent:[ua][crlf][crlf]',
                            remarks: masterConfig.remarks || masterConfig.name || '𖤍 ORANGE🍊〆DANNY 𖤍'
                          });
                        } else {
                          setMasterConfig({
                            ...masterConfig,
                            protocol: 'vless',
                            transport: 'ws',
                            serverPort: 443,
                            path: '/@abess237'
                          });
                        }
                      }}
                      className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-3 text-emerald-200 font-bold"
                    >
                      <option value="vless">VLESS (Optimisé 100% TCP • Xray)</option>
                      <option value="ssh">SSH-Payload (Dropbear / WebSocket Injection)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Transport</label>
                    <select
                      value={masterConfig.transport}
                      disabled={masterConfig.protocol === 'ssh'}
                      onChange={(e) => {
                        const transport = e.target.value;
                        const serverPort = transport === 'tcp' ? 10050 : 443;
                        setMasterConfig({ ...masterConfig, transport, serverPort, sniHost: transport === 'tcp' ? '' : masterConfig.sniHost });
                      }}
                      className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-3 text-emerald-200 disabled:opacity-50"
                    >
                      <option value="ws">WebSocket sur TCP (Port 443 • Cloudflare / TLS)</option>
                      <option value="tcp">TCP Direct (Port 10050 • Ultra Faible Latence)</option>
                      <option value="grpc">gRPC sur TCP (Port 443 • Haute Vitesse HTTP/2)</option>
                      <option value="httpupgrade">HTTPUpgrade sur TCP (Port 443)</option>
                      <option value="xhttp">XHTTP sur TCP (Port 443)</option>
                    </select>
                  </div>

                  {masterConfig.protocol === 'ssh' ? (
                    <>
                      <div className="md:col-span-2 rounded-xl border border-amber-900/80 bg-amber-950/20 p-3">
                        <label className="block text-amber-200 font-semibold mb-1">Host HTTP d'Injection / Bug Host (ex: m.batch.com)</label>
                        <input
                          type="text"
                          value={masterConfig.host}
                          onChange={(e) => setMasterConfig({ ...masterConfig, host: e.target.value })}
                          className="w-full bg-[#03060e] border border-amber-800 rounded-lg px-3 py-2 text-amber-100"
                          placeholder="m.batch.com"
                        />
                      </div>
                      <div className="md:col-span-2 rounded-xl border border-amber-900/80 bg-amber-950/20 p-3">
                        <label className="block text-amber-200 font-semibold mb-1">Payload HTTP d'Injection Complet</label>
                        <textarea
                          value={masterConfig.payload || ''}
                          onChange={(e) => setMasterConfig({ ...masterConfig, payload: e.target.value })}
                          rows={4}
                          className="w-full bg-[#03060e] border border-amber-800 rounded-lg px-3 py-2 text-amber-300 font-mono text-[11px]"
                          placeholder="GET / HTTP/1.1[crlf]Host: m.batch.com..."
                          required
                        />
                        <p className="mt-1 text-slate-400">Ce payload modèle sera automatiquement injecté pour tous les tokens créés sur ce profil.</p>
                      </div>
                      <div className="md:col-span-2 rounded-xl border border-amber-900/80 bg-amber-950/20 p-3">
                        <label className="block text-amber-200 font-semibold mb-1">Remarques / Nom de la configuration (JSON)</label>
                        <input
                          type="text"
                          value={masterConfig.remarks || ''}
                          onChange={(e) => setMasterConfig({ ...masterConfig, remarks: e.target.value })}
                          className="w-full bg-[#03060e] border border-amber-800 rounded-lg px-3 py-2 text-amber-200"
                          placeholder="Ex: 𖤍 ORANGE🍊〆DANNY 𖤍"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="md:col-span-2 rounded-xl border border-cyan-900/80 bg-cyan-950/20 p-3">
                        <label className="block text-cyan-200 font-semibold mb-1">Host HTTP / WebSocket / :authority (facultatif)</label>
                        <input type="text" value={masterConfig.host} onChange={(e) => setMasterConfig({ ...masterConfig, host: e.target.value })} className="w-full bg-[#03060e] border border-cyan-800 rounded-lg px-3 py-3 text-cyan-100" placeholder="Host distinct, sans http:// ni chemin" autoComplete="off" />
                        <p className="mt-1 text-slate-400">Cet en-tête est séparé de l’adresse de destination et du SNI. Laisse vide pour utiliser l’adresse de destination.</p>
                      </div>
                      <div className="md:col-span-2 rounded-xl border border-amber-900/80 bg-amber-950/15 p-3">
                        <label className="block text-amber-200 font-semibold mb-1">SNI TLS — nom présenté au serveur TLS</label>
                        <input type="text" value={masterConfig.sniHost} onChange={(e) => setMasterConfig({ ...masterConfig, sniHost: e.target.value })} className="w-full bg-[#03060e] border border-amber-800 rounded-lg px-3 py-3 text-amber-100 disabled:opacity-50" placeholder={masterConfig.transport === 'tcp' ? 'Non utilisé pour TCP direct' : 'Nom couvert par le certificat présenté'} disabled={masterConfig.transport === 'tcp'} required={masterConfig.transport !== 'tcp'} />
                        <p className="mt-1 text-slate-400">Pour ce déploiement, Caddy présente le certificat associé à la variable VPN_DOMAIN. Pour WS, gRPC, HTTPUpgrade et XHTTP, le SNI doit donc être exactement ce domaine.</p>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-slate-300 font-semibold mb-1">Chemin de transport</label>
                        <input type="text" value={masterConfig.path || '/@abess237'} readOnly className="w-full bg-[#03060e] border border-slate-800 rounded-lg px-3 py-2 text-slate-300" />
                        <p className="mt-1 text-slate-500">Le chemin technique est généré par Xray selon le protocole et le transport.</p>
                      </div>
                    </>
                  )}
                  <div className="md:col-span-2 rounded-xl border border-slate-800 bg-black/20 p-3 text-slate-400">
                    <span className={masterConfig.transport === 'tcp' ? 'text-amber-300' : 'text-emerald-300'}>{masterConfig.transport === 'tcp' ? 'Transport TCP direct ultra-faible latence sans couche TLS' : 'TLS sécurisé sur le point d’entrée HTTPS'}</span>
                    <p className="mt-1">Les modifications du profil n’altèrent pas les paramètres déjà copiés dans les licences existantes : chaque token garde son instantané de configuration.</p>
                  </div>
                  <div className="md:col-span-2 flex flex-wrap justify-end gap-2 pt-2">
                    <button type="button" onClick={handleNewProtocolConfig} className="rounded-xl border border-slate-700 px-4 py-2.5 text-slate-300 hover:bg-slate-900">Annuler / Nouveau</button>
                    <button type="submit" disabled={configSaving} className="rounded-xl bg-emerald-600 px-6 py-2.5 font-black text-black flex items-center gap-2 disabled:opacity-60">
                      {configSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      {configSaving ? 'Sauvegarde…' : editingConfigId ? 'Enregistrer les modifications' : 'Créer la configuration'}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {/* App Version & Mandatory Updates Management */}
            <section className="rounded-2xl border border-cyan-900/60 bg-[#060c18] p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-cyan-950">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="w-5 h-5 text-cyan-400" />
                  <div>
                    <h2 className="text-sm font-bold text-white">Application Mobile — Version &amp; Mises à Jour Obligatoires</h2>
                    <p className="text-xs text-slate-400">Configurez la version minimale exigée pour bloquer les anciennes versions et forcer la mise à jour.</p>
                  </div>
                </div>
                {appVersionSaved && (
                  <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Enregistré &amp; Publié !
                  </span>
                )}
              </div>

              <form onSubmit={handleSaveAppVersion} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">Dernière Version Publiée</label>
                  <input
                    type="text"
                    value={appVersionConfig.latestVersion}
                    onChange={(e) => setAppVersionConfig({ ...appVersionConfig, latestVersion: e.target.value })}
                    className="w-full bg-[#03060e] border border-cyan-900 rounded-lg px-3 py-2 text-cyan-200"
                    placeholder="ex: 2.1.0"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">Version Minimale Requise (Bloquante)</label>
                  <input
                    type="text"
                    value={appVersionConfig.minRequiredVersion}
                    onChange={(e) => setAppVersionConfig({ ...appVersionConfig, minRequiredVersion: e.target.value })}
                    className="w-full bg-[#03060e] border border-cyan-900 rounded-lg px-3 py-2 text-cyan-200"
                    placeholder="ex: 2.0.0"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-slate-300 font-bold mb-1">Lien de Téléchargement Direct (APK ou Canal Telegram)</label>
                  <input
                    type="url"
                    value={appVersionConfig.downloadUrl}
                    onChange={(e) => setAppVersionConfig({ ...appVersionConfig, downloadUrl: e.target.value })}
                    className="w-full bg-[#03060e] border border-cyan-900 rounded-lg px-3 py-2 text-cyan-200"
                    placeholder="https://t.me/Abess_Vpn ou lien direct APK"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-slate-300 font-bold mb-1">Notes de Version / Nouveautés</label>
                  <textarea
                    value={appVersionConfig.releaseNotes}
                    onChange={(e) => setAppVersionConfig({ ...appVersionConfig, releaseNotes: e.target.value })}
                    className="w-full bg-[#03060e] border border-cyan-900 rounded-lg px-3 py-2 text-cyan-200 h-20"
                    placeholder="Décrivez les nouveautés ou raisons de la mise à jour..."
                  />
                </div>

                <div className="md:col-span-2 p-3 rounded-xl border border-rose-900/60 bg-rose-950/20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                    <div>
                      <span className="font-bold text-rose-200">Mise à jour STRICTEMENT OBLIGATOIRE (Bloquante)</span>
                      <p className="text-slate-400 text-[11px]">Si activé, l'application mobile refuse toute connexion VPN et affiche un écran bloquant sans bouton "Plus tard".</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={appVersionConfig.isMandatory}
                      onChange={(e) => setAppVersionConfig({ ...appVersionConfig, isMandatory: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
                  </label>
                </div>

                <div className="md:col-span-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={appVersionSaving}
                    className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-black font-black rounded-xl text-xs flex items-center gap-1.5 transition shadow"
                  >
                    <Check className="w-4 h-4" />
                    <span>{appVersionSaving ? 'Publication...' : 'Publier la Version Immédiatement'}</span>
                  </button>
                </div>
              </form>
            </section>

            {/* Server Auto-Update Management */}
            <section className="rounded-2xl border border-emerald-900/60 bg-[#060c18] p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-emerald-950">
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="w-5 h-5 text-emerald-400" />
                  <div>
                    <h2 className="text-sm font-bold text-white">Mises à Jour Automatiques du Serveur</h2>
                    <p className="text-xs text-slate-400">Le serveur surveille automatiquement le dépôt Git origin/main toutes les 6 heures pour appliquer les mises à jour.</p>
                  </div>
                </div>
                {serverUpdateStatus?.currentCommit && (
                  <span className="text-xs bg-slate-900 border border-slate-700 px-2.5 py-1 rounded text-slate-300 font-mono">
                    Commit : <code className="text-emerald-400">{serverUpdateStatus.currentCommit}</code>
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-emerald-950 bg-black/40">
                <div>
                  <span className="font-bold text-slate-200">Statut du Serveur : </span>
                  {serverUpdateStatus?.hasUpdate ? (
                    <span className="text-amber-400 font-bold">⚠️ Nouvelle version disponible ({serverUpdateStatus.remoteCommit})</span>
                  ) : (
                    <span className="text-emerald-400 font-bold">✅ Le serveur est à jour avec origin/main</span>
                  )}
                  {serverUpdateMsg && (
                    <p className="mt-1 text-xs text-cyan-300 font-mono">{serverUpdateMsg}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleExecuteServerUpdate}
                  disabled={serverUpdating}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl text-xs flex items-center gap-1.5 shrink-0 transition shadow disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${serverUpdating ? 'animate-spin' : ''}`} />
                  <span>{serverUpdating ? 'Mise à jour en cours...' : 'Mettre à Jour le Serveur Maintenant'}</span>
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ========================================================================= */}
        
        {/* ========================================================================= */}
        {/* TAB: AUDIT LEDGER & TRANSACTIONS */}
        {/* ========================================================================= */}
        {activeTab === 'transactions' && (
          <div className="space-y-6 animate-fade-in font-mono text-xs">
            <div className="p-6 rounded-2xl bg-[#060c18] border border-emerald-900/80 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-emerald-950">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <History className="w-5 h-5 text-emerald-400" />
                    <span>Registre des Transactions &amp; Audit de Crédits</span>
                  </h2>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Historique complet et infalsifiable des recharges, créations de licences et déductions de solde.
                  </p>
                </div>
                <button
                  onClick={refreshData}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg flex items-center gap-1.5 border border-slate-700"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Actualiser</span>
                </button>
              </div>

              {transactions.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  Aucune transaction enregistrée pour le moment.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-emerald-950 text-slate-500 text-[10px] uppercase">
                        <th className="py-2.5 px-3">Date &amp; Heure</th>
                        <th className="py-2.5 px-3">Revendeur</th>
                        <th className="py-2.5 px-3">Opération</th>
                        <th className="py-2.5 px-3">Volume (Go)</th>
                        <th className="py-2.5 px-3">Solde Avant / Après</th>
                        <th className="py-2.5 px-3">Détails &amp; Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-emerald-950/60">
                      {transactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-emerald-950/20 transition">
                          <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
                            {new Date(tx.timestamp).toLocaleString()}
                          </td>
                          <td className="py-3 px-3 font-bold text-cyan-300">
                            {tx.resellerName}
                          </td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              tx.type === 'CREDIT_ADD'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : tx.type === 'BATCH_CREATE'
                                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                  : tx.type === 'RESET_DEVICES'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    : tx.type === 'SUB_RESELLER_CREATE'
                                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                      : tx.type === 'CREDIT_TRANSFER'
                                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                                        : tx.type === 'RESELLER_DELETE_REFUND'
                                          ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40'
                                          : 'bg-slate-800 text-slate-300'
                            }`}>
                              {tx.type}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-bold text-white">
                            {tx.amountGb !== 0 ? `${tx.amountGb > 0 ? '+' : ''}${tx.amountGb} Go` : '-'}
                          </td>
                          <td className="py-3 px-3 text-slate-300 font-mono">
                            {tx.balanceBefore} Go → <span className="text-emerald-400 font-bold">{tx.balanceAfter} Go</span>
                          </td>
                          <td className="py-3 px-3 text-slate-400">
                            {tx.note}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: SYSTEM LOGS & TELEMETRY */}
        {activeTab === 'logs' && (
          <div className="space-y-6 animate-fade-in font-mono text-xs">
            <div className="p-6 rounded-2xl bg-black border border-emerald-900 shadow-2xl space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-emerald-950">
                <span className="text-emerald-400 font-bold flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  JOURNAL D'ÉVÉNEMENTS SYSTÈME EN DIRECT
                </span>
                <button
                  onClick={() => setSystemLogs(['[RESET] Journal vidé.'])}
                  className="text-slate-500 hover:text-slate-300 text-[11px]"
                >
                  Effacer
                </button>
              </div>

              <div className="space-y-1.5 max-h-96 overflow-y-auto leading-relaxed">
                {systemLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`${
                      log.includes('CREATE') || log.includes('LOGIN')
                        ? 'text-cyan-400'
                        : log.includes('ERROR') || log.includes('REVOKE')
                        ? 'text-red-400'
                        : log.includes('RECHARGE') || log.includes('SUCCESS')
                        ? 'text-emerald-300 font-bold'
                        : 'text-slate-400'
                    }`}
                  >
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: COMMERCIAL PRICING PLANS & TIERS */}
        {/* ========================================================================= */}
        {activeTab === 'plans' && (
          <div className="space-y-6 animate-fade-in font-mono text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-[#060c18] border border-emerald-900/80 p-5 rounded-2xl shadow-xl">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Tag className="w-5 h-5 text-emerald-400" />
                  Catalogue des Offres & Forfaits Commerciaux
                </h2>
                <p className="text-slate-400 mt-1">
                  Définissez les forfaits proposés sur le portail d'adhésion public et les quotas alloués aux clients.
                </p>
              </div>

              {currentUser.role === 'SUPER_ADMIN' && (
                <button
                  onClick={() => handleOpenPlanModal()}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl text-xs flex items-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Ajouter un Forfait</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {plans.map((p) => (
                <div
                  key={p.id}
                  className="bg-[#060c18] border border-emerald-900/80 hover:border-emerald-500/60 rounded-2xl p-5 shadow-xl flex flex-col justify-between transition group relative overflow-hidden"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                          {p.badge || 'PRO'}
                        </span>
                        <h3 className="text-base font-bold text-white mt-1.5">{p.name}</h3>
                      </div>
                      <div className="text-right">
                        <span className="text-lg font-black text-cyan-300">
                          {p.priceCfa === 0 ? 'GRATUIT' : `${p.priceCfa.toLocaleString('fr-FR')} FCFA`}
                        </span>
                      </div>
                    </div>

                    <p className="text-slate-400 text-xs min-h-[32px]">
                      {p.description || 'Accès VPN optimisé haute vitesse avec volume garanti.'}
                    </p>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-950">
                      <div className="bg-[#03060e] p-2 rounded-lg border border-emerald-950">
                        <span className="text-slate-500 text-[10px] block">Quota Données</span>
                        <span className="text-sm font-bold text-white">{p.quotaGb} Go</span>
                      </div>
                      <div className="bg-[#03060e] p-2 rounded-lg border border-emerald-950">
                        <span className="text-slate-500 text-[10px] block">Validité</span>
                        <span className="text-sm font-bold text-emerald-400">{p.durationDays} Jours</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 mt-3 border-t border-emerald-950 flex items-center justify-between gap-2">
                    <button
                      onClick={() => {
                        setNewTokenPlan(p.name);
                        setNewTokenBandwidth(p.quotaGb);
                        setNewTokenExpiryDate(
                          new Date(Date.now() + p.durationDays * 24 * 3600 * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                        );
                        setNewTokenCode(generateUnifiedToken());
                        setTokenModalOpen(true);
                      }}
                      className="flex-1 py-2 bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-800 text-emerald-300 rounded-xl text-center font-bold text-xs"
                    >
                      Émettre ce Voucher
                    </button>

                    {currentUser.role === 'SUPER_ADMIN' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenPlanModal(p)}
                          className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl"
                          title="Modifier ce plan"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeletePlan(p.id, p.name)}
                          className="p-2 bg-slate-900 hover:bg-red-950/50 text-red-400 rounded-xl"
                          title="Supprimer ce plan"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: ONBOARDING & MEMBERSHIP REQUESTS */}
        {/* ========================================================================= */}
        {activeTab === 'requests' && currentUser.role === 'SUPER_ADMIN' && (
          <div className="space-y-6 animate-fade-in font-mono text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-[#060c18] border border-emerald-900/80 p-5 rounded-2xl shadow-xl">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <PhoneCall className="w-5 h-5 text-cyan-400" />
                  Demandes d'Adhésion & Onboarding Clients
                </h2>
                <p className="text-slate-400 mt-1">
                  Validez en 1-clic les formulaires d'inscription reçus depuis la page publique d'adhésion.
                </p>
              </div>

              {/* Status Filters */}
              <div className="flex items-center gap-1.5 bg-[#03060e] p-1 rounded-xl border border-emerald-950">
                {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setRequestFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      requestFilter === f
                        ? 'bg-emerald-600 text-black'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {f === 'ALL' ? 'Toutes' : f === 'PENDING' ? `En attente (${requests.filter(r => r.status === 'PENDING').length})` : f === 'APPROVED' ? 'Approuvées' : 'Rejetées'}
                  </button>
                ))}
              </div>
            </div>

            {/* Requests List */}
            <div className="bg-[#060c18] border border-emerald-900/80 rounded-2xl overflow-hidden shadow-xl">
              {requests.length === 0 ? (
                <div className="p-12 text-center text-slate-500">
                  <PhoneCall className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Aucune demande d'adhésion pour le moment.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-emerald-950 text-slate-500 text-[10px] uppercase">
                        <th className="py-2.5 px-3">Client</th>
                        <th className="py-2.5 px-3">Pays & Contact</th>
                        <th className="py-2.5 px-3">Canal</th>
                        <th className="py-2.5 px-3">Forfait Demandé</th>
                        <th className="py-2.5 px-3">Paiement / Réf</th>
                        <th className="py-2.5 px-3">Statut</th>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3 text-right">Actions Validation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-emerald-950/60">
                      {requests
                        .filter(r => requestFilter === 'ALL' || r.status === requestFilter)
                        .map(r => (
                          <tr key={r.id} className="hover:bg-emerald-950/20 transition">
                            <td className="py-3 px-3 font-bold text-white">
                              <div className="flex items-center gap-1.5">
                                <span>{r.fullName}</span>
                              </div>
                              {r.deviceId && (
                                <div className="text-[10px] text-slate-500 font-sans mt-0.5">
                                  Appareil : {r.deviceModel || r.deviceId.slice(0, 12)}...
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-slate-300">
                              <div className="flex items-center gap-1.5">
                                <span>{r.flag || '🌍'}</span>
                                <span className="font-semibold">{r.countryName}</span>
                              </div>
                              <span className="text-cyan-300 font-mono text-[11px] block mt-0.5">
                                {r.dialPrefix} {r.contactDetail}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                r.channel === 'WHATSAPP' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                              }`}>
                                {r.channel}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-bold text-slate-200">
                              {r.planName || 'Standard'}
                            </td>
                            <td className="py-3 px-3 text-slate-400">
                              <div>{r.paymentMethod || 'Non spécifié'}</div>
                              {r.paymentRef && <div className="text-cyan-400 font-mono text-[10px]">{r.paymentRef}</div>}
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                r.status === 'APPROVED'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : r.status === 'PENDING'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                                    : 'bg-red-500/20 text-red-300 border border-red-500/40'
                              }`}>
                                {r.status === 'APPROVED' ? 'APPROUVÉE' : r.status === 'PENDING' ? 'EN ATTENTE' : 'REJETÉE'}
                              </span>
                              {r.assignedToken && (
                                <div className="text-emerald-400 font-mono text-[10px] mt-1">
                                  Token : {r.assignedToken}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-slate-400 text-[11px]">
                              {new Date(r.submittedAt).toLocaleString()}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {r.status === 'PENDING' && (
                                  <>
                                    <button
                                      disabled={requestActionLoading === r.id}
                                      onClick={() => handleApproveRequest(r.id, r.fullName)}
                                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-black font-bold rounded-lg text-xs flex items-center gap-1"
                                      title="Valider la demande et générer automatiquement le code voucher"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Valider</span>
                                    </button>
                                    <button
                                      disabled={requestActionLoading === r.id}
                                      onClick={() => handleRejectRequest(r.id, r.fullName)}
                                      className="px-2.5 py-1 bg-slate-900 hover:bg-red-950 border border-slate-700 text-red-400 rounded-lg text-xs flex items-center gap-1"
                                      title="Rejeter la demande"
                                    >
                                      <XCircle className="w-3.5 h-3.5" />
                                      <span>Rejeter</span>
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => handleDeleteRequest(r.id)}
                                  className="p-1.5 text-slate-600 hover:text-red-400"
                                  title="Supprimer la demande"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: DIAGNOSTICS & NETWORK PROBE */}
        {/* ========================================================================= */}
        {activeTab === 'diagnostics' && currentUser.role === 'SUPER_ADMIN' && (
          <div className="space-y-6 animate-fade-in font-mono text-xs">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-[#060c18] border border-emerald-900/80 p-5 rounded-2xl shadow-xl">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-indigo-400" />
                  Diagnostics Système & Sonde Réseau Haute Performance
                </h2>
                <p className="text-slate-400 mt-1">
                  Surveillance en temps réel de la charge CPU, RAM, noyau Xray et testeur de connectivité TCP/TLS.
                </p>
              </div>

              <button
                onClick={refreshData}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-xs flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Actualiser</span>
              </button>
            </div>

            {/* Gauges & Realtime Metrics */}
            {diagnostics && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-[#060c18] border border-emerald-900/80 p-4 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[10px] uppercase font-bold">Mémoire RAM</span>
                    <HardDrive className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-xl font-black text-white">
                    {Math.round(diagnostics.server.memory.usedBytes / (1024 * 1024))} Mo
                    <span className="text-xs text-slate-500 font-normal"> / {Math.round(diagnostics.server.memory.totalBytes / (1024 * 1024))} Mo</span>
                  </div>
                  <div className="w-full bg-[#03060e] h-2 rounded-full overflow-hidden border border-emerald-950">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all"
                      style={{ width: `${diagnostics.server.memory.usedPercent}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-right text-emerald-400 font-bold">
                    {diagnostics.server.memory.usedPercent}% utilisé
                  </div>
                </div>

                <div className="bg-[#060c18] border border-emerald-900/80 p-4 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[10px] uppercase font-bold">Charge CPU & Noyaux</span>
                    <Activity className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="text-xl font-black text-cyan-300">
                    {diagnostics.server.cpuCount} Coeurs
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Moyennes de charge (1/5/15m) :
                    <span className="font-bold text-white block mt-0.5">
                      {diagnostics.server.loadAverage.map(v => v.toFixed(2)).join(', ')}
                    </span>
                  </div>
                </div>

                <div className="bg-[#060c18] border border-emerald-900/80 p-4 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[10px] uppercase font-bold">Uptime Système</span>
                    <Clock className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-xl font-black text-amber-300">
                    {Math.floor(diagnostics.server.uptimeSeconds / 3600)}h {Math.floor((diagnostics.server.uptimeSeconds % 3600) / 60)}m
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Node.js {diagnostics.server.nodeVersion} • {diagnostics.server.platform} ({diagnostics.server.arch})
                  </div>
                </div>

                <div className="bg-[#060c18] border border-emerald-900/80 p-4 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[10px] uppercase font-bold">Moteur Xray Core</span>
                    <Zap className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xl font-black text-emerald-300 uppercase">
                      {diagnostics.vpn.xrayStatus === 'ready' ? 'Opérationnel' : 'Inactif'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Domaine : <code className="text-cyan-400">{diagnostics.vpn.vpnDomain}</code>
                  </div>
                </div>

                <div className="bg-[#060c18] border border-cyan-900/80 p-4 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-[10px] uppercase font-bold">Dropbear SSH & WS</span>
                    <Terminal className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${diagnostics.vpn.dropbearStatus === 'ready' ? 'bg-cyan-400 animate-pulse' : 'bg-rose-500'}`} />
                    <span className="text-xl font-black text-cyan-300 uppercase">
                      {diagnostics.vpn.dropbearStatus === 'ready' ? 'Opérationnel' : 'Inactif'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>Ports 80, 8880, 143</span>
                    <span className="text-emerald-400 font-bold">{diagnostics.vpn.activeSshConnections ?? 0} actif(s)</span>
                  </div>
                </div>
              </div>
            )}

            {/* Network Probe Form */}
            <div className="bg-[#060c18] border border-cyan-900/80 p-5 rounded-2xl shadow-xl space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  Sonde Réseau & Testeur de Latence TCP / TLS (Bug Hosts & CDN)
                </h3>
                <p className="text-slate-400 text-xs mt-1">
                  Effectue un handshake TCP réel et une négociation TLS pour mesurer la latence réseau exacte vers n'importe quel bug host, CDN ou cible IP.
                </p>
              </div>

              <form onSubmit={handleRunProbe} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-5">
                  <label className="block text-slate-300 text-[11px] mb-1">Cible (Hôte ou IP)</label>
                  <input
                    type="text"
                    value={probeHost}
                    onChange={(e) => setProbeHost(e.target.value)}
                    placeholder="ex: crashlyticsreports-pa.googleapis.com"
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-slate-300 text-[11px] mb-1">Port</label>
                  <input
                    type="number"
                    value={probePort}
                    onChange={(e) => setProbePort(Number(e.target.value))}
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-slate-300 text-[11px] mb-1">SNI Personnalisé (Optionnel)</label>
                  <input
                    type="text"
                    value={probeSni}
                    onChange={(e) => setProbeSni(e.target.value)}
                    placeholder="ex: panel.pagnol.xyz"
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={probeLoading}
                    className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-black font-bold rounded-xl flex items-center justify-center gap-1.5 transition"
                  >
                    <Radio className={`w-4 h-4 ${probeLoading ? 'animate-spin' : ''}`} />
                    <span>{probeLoading ? 'Mesure...' : 'Lancer Sonde'}</span>
                  </button>
                </div>
              </form>

              {/* Probe Result Card */}
              {probeResult && (
                <div className={`p-4 rounded-xl border ${
                  probeResult.success ? 'bg-emerald-950/30 border-emerald-600/40' : 'bg-red-950/30 border-red-600/40'
                } space-y-2`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      {probeResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-red-400" />}
                      Résultat Sonde : {probeResult.target}:{probeResult.port}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                      probeResult.success ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                    }`}>
                      {probeResult.success ? 'ACCESSIBLE' : 'ÉCHEC'}
                    </span>
                  </div>

                  {probeResult.success ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-950">
                      <div>
                        <span className="text-slate-500 text-[10px] block">Latence TCP</span>
                        <span className="text-base font-bold text-emerald-300">{probeResult.tcpLatencyMs} ms</span>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[10px] block">Latence TLS</span>
                        <span className="text-base font-bold text-cyan-300">{probeResult.tlsLatencyMs ? `${probeResult.tlsLatencyMs} ms` : 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[10px] block">Protocole TLS</span>
                        <span className="text-xs font-bold text-white">{probeResult.tlsProtocol || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[10px] block">Expiration Certificat</span>
                        <span className="text-xs font-bold text-slate-300">{probeResult.certValidTo ? new Date(probeResult.certValidTo).toLocaleDateString() : 'N/A'}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-red-300 text-xs">
                      Erreur de connexion : {probeResult.error || 'Délai d’attente dépassé (timeout).'}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: ANNOUNCEMENTS MANAGEMENT (ANDROID & WINDOWS NETWORK BROADCAST) */}
        {/* ========================================================================= */}
        {activeTab === 'announcements' && currentUser.role === 'SUPER_ADMIN' && (
          <div className="space-y-6">
            {/* Header / Actions Card */}
            <div className="bg-[#060c18] border border-emerald-900/80 p-5 rounded-2xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Megaphone className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-base font-bold text-white tracking-wide">
                    Système d'Annonces & Push Popups Multi-Plateformes (AbessVpn)
                  </h2>
                </div>
                <p className="text-slate-400 text-xs">
                  Diffusez des alertes en temps réel sur l'écran des utilisateurs de l'application Android et du logiciel Windows.
                  Les annonces obligatoires bloquent l'écran jusqu'à acquittement par l'utilisateur.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAnnouncementModalOpen(true)}
                  className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-black font-black rounded-xl text-xs flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.35)] transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Diffuser une Nouvelle Annonce</span>
                </button>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-[#060c18] border border-emerald-900/80 p-4 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase">
                  <span>Total Annonces Créées</span>
                  <Megaphone className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-black text-white">{announcements.length}</div>
                <div className="text-[10px] text-slate-400">Historique et annonces actives</div>
              </div>

              <div className="bg-[#060c18] border border-cyan-900/80 p-4 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase">
                  <span>En Diffusion Directe</span>
                  <Radio className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-2xl font-black text-cyan-300">
                  {announcements.filter(a => a.isActive).length}
                </div>
                <div className="text-[10px] text-slate-400">Reçues instantanément sur Android & Windows</div>
              </div>

              <div className="bg-[#060c18] border border-red-900/80 p-4 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase">
                  <span>Annonces Bloquantes / Critiques</span>
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                </div>
                <div className="text-2xl font-black text-red-400">
                  {announcements.filter(a => a.isMandatory && a.isActive).length}
                </div>
                <div className="text-[10px] text-slate-400">Écran forcé jusqu'à validation</div>
              </div>
            </div>

            {/* Announcements List */}
            <div className="space-y-4">
              {announcements.length === 0 ? (
                <div className="bg-[#060c18] border border-emerald-950 p-8 rounded-2xl text-center space-y-3">
                  <Megaphone className="w-10 h-10 text-slate-600 mx-auto" />
                  <p className="text-slate-400 text-sm">Aucune annonce n'a encore été diffusée sur le réseau.</p>
                  <button
                    onClick={() => setAnnouncementModalOpen(true)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold rounded-xl text-xs inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Créer la Première Annonce</span>
                  </button>
                </div>
              ) : (
                announcements.map((ann) => {
                  const typeColors = {
                    CRITICAL: 'border-red-500/60 bg-red-950/20 shadow-[0_0_20px_rgba(239,68,68,0.15)] text-red-300',
                    WARNING: 'border-amber-500/60 bg-amber-950/20 text-amber-300',
                    PROMO: 'border-purple-500/60 bg-purple-950/20 shadow-[0_0_20px_rgba(168,85,247,0.15)] text-purple-300',
                    UPDATE: 'border-blue-500/60 bg-blue-950/20 text-blue-300',
                    INFO: 'border-emerald-500/60 bg-emerald-950/20 text-emerald-300'
                  };
                  const badgeColors = {
                    CRITICAL: 'bg-red-500/20 border-red-500/40 text-red-300',
                    WARNING: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
                    PROMO: 'bg-purple-500/20 border-purple-500/40 text-purple-300',
                    UPDATE: 'bg-blue-500/20 border-blue-500/40 text-blue-300',
                    INFO: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  };

                  return (
                    <div
                      key={ann.id}
                      className={`p-5 rounded-2xl border transition-all ${
                        ann.isActive ? typeColors[ann.type] : 'border-slate-800 bg-[#060c18]/50 opacity-60'
                      } space-y-3 font-mono`}
                    >
                      {/* Top Badges & Status */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border uppercase ${badgeColors[ann.type]}`}>
                            {ann.type === 'CRITICAL' && '⚠️ '}
                            {ann.type === 'WARNING' && '⚡ '}
                            {ann.type === 'PROMO' && '🎁 '}
                            {ann.type === 'UPDATE' && '🚀 '}
                            {ann.type === 'INFO' && 'ℹ️ '}
                            {ann.type}
                          </span>

                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-900 border border-slate-700 text-slate-300">
                            {ann.targetPlatform === 'ALL' && '🌐 Android + Windows'}
                            {ann.targetPlatform === 'ANDROID' && '📱 Android uniquement'}
                            {ann.targetPlatform === 'WINDOWS' && 'Windows PC uniquement'}
                          </span>

                          {ann.isMandatory && (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-red-600/30 border border-red-500 text-red-200 animate-pulse">
                              OBLIGATOIRE (Écran Bloqué)
                            </span>
                          )}

                          <span className="px-2.5 py-0.5 rounded-full text-[10px] bg-slate-900 text-slate-400">
                            {ann.showMode === 'EVERY_LAUNCH' ? '🔁 À chaque lancement' : '1️⃣ Une seule fois'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleAnnouncement(ann.id, ann.isActive)}
                            className={`px-3 py-1 rounded-lg text-[10px] font-black transition cursor-pointer ${
                              ann.isActive
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                                : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
                            }`}
                          >
                            {ann.isActive ? '🟢 ACTIF (En diffusion)' : '🔴 DÉSACTIVÉ'}
                          </button>
                        </div>
                      </div>

                      {/* Title & Body */}
                      <div className="space-y-1.5">
                        <h3 className="text-base font-black text-white">{ann.title}</h3>
                        <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{ann.message}</p>
                      </div>

                      {/* Action Button Link Preview */}
                      {ann.actionButtonText && ann.actionButtonUrl && (
                        <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between text-xs">
                          <span className="text-slate-400 text-[11px] flex items-center gap-1.5">
                            <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                            Bouton d'action : <strong className="text-white">{ann.actionButtonText}</strong>
                          </span>
                          <a
                            href={ann.actionButtonUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-400 hover:underline text-[10px] truncate max-w-xs"
                          >
                            {ann.actionButtonUrl}
                          </a>
                        </div>
                      )}

                      {/* Footer Actions */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5 text-[10px] text-slate-500">
                        <span>
                          Publié le {new Date(ann.publishedAt).toLocaleString('fr-FR')} par {ann.createdBy || 'Super Admin'}
                        </span>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setPreviewAnnouncement(ann)}
                            className="px-2.5 py-1 rounded bg-cyan-950/40 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/60 transition cursor-pointer flex items-center gap-1"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Aperçu Écran Utilisateur</span>
                          </button>

                          <button
                            onClick={() => handleDeleteAnnouncement(ann.id, ann.title)}
                            className="px-2.5 py-1 rounded bg-red-950/40 border border-red-500/40 text-red-300 hover:bg-red-900/60 transition cursor-pointer flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Supprimer</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* MODAL: CREATE RESELLER & SUB-RESELLER */}
      {/* ========================================================================= */}
      {resellerModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#060c18] border border-emerald-900 rounded-3xl p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-950">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                {currentUser.role === 'SUPER_ADMIN' ? 'Créer un Nouveau Compte Revendeur' : 'Créer un Nouveau Sous-Revendeur'}
              </h3>
              <button onClick={() => setResellerModalOpen(false)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateReseller} className="space-y-3">
              <div>
                <label className="block text-slate-300 mb-1">
                  {currentUser.role === 'SUPER_ADMIN' ? 'Nom / Entreprise du Revendeur' : 'Nom du Sous-Revendeur'}
                </label>
                <input
                  type="text"
                  value={newResellerName}
                  onChange={(e) => setNewResellerName(e.target.value)}
                  placeholder={currentUser.role === 'SUPER_ADMIN' ? "ex: Distributeur Douala Pro" : "ex: Sous-Distributeur Yaoundé"}
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Email de Connexion (Identifiant)</label>
                <input
                  type="email"
                  value={newResellerEmail}
                  onChange={(e) => setNewResellerEmail(e.target.value)}
                  placeholder="revendeur@domaine.com"
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Mot de Passe Initial</label>
                <input
                  type="text"
                  value={newResellerPassword}
                  onChange={(e) => setNewResellerPassword(e.target.value)}
                  placeholder="Mot de passe sécurisé"
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-slate-100"
                  required
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-300 font-bold">Solde Initial Crédité (en Go)</label>
                  {currentUser.role === 'RESELLER' && (
                    <span className="text-cyan-400 text-[10px]">
                      Votre solde : <strong>{currentUser.credits} Go</strong>
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  value={newResellerCredits}
                  onChange={(e) => setNewResellerCredits(Number(e.target.value))}
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-cyan-300 font-bold"
                  min="0"
                  max={currentUser.role === 'RESELLER' ? currentUser.credits : undefined}
                />
                {currentUser.role === 'RESELLER' && (
                  <p className="text-[10px] text-slate-400 mt-1">
                    ℹ️ Ces Gigas seront déduits de votre solde et alloués au sous-revendeur.
                  </p>
                )}
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setResellerModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl shadow"
                >
                  {currentUser.role === 'SUPER_ADMIN' ? 'Créer Revendeur' : 'Créer Sous-Revendeur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREDIT / RECHARGE RESELLER */}
      {/* ========================================================================= */}
      {creditingReseller && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#060c18] border border-cyan-800 rounded-3xl p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-950">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-cyan-400" />
                {currentUser.role === 'SUPER_ADMIN' ? 'Recharger le Solde' : 'Transférer des Crédits'}
              </h3>
              <button onClick={() => setCreditingReseller(null)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            <div className="text-slate-300 text-xs space-y-1">
              <p>
                Revendeur : <strong className="text-white">{creditingReseller.name}</strong> ({creditingReseller.email})
              </p>
              <p>
                Solde actuel : <strong className="text-cyan-300">{creditingReseller.credits} Go</strong>
              </p>
              {currentUser.role === 'RESELLER' && (
                <p className="text-amber-400">
                  Votre solde disponible : <strong>{currentUser.credits} Go</strong>
                </p>
              )}
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-bold">
                {currentUser.role === 'SUPER_ADMIN' ? 'Montant à Ajouter (Go)' : 'Crédits à Transférer (Go)'}
              </label>
              <input
                type="number"
                value={creditAmount}
                onChange={(e) => setCreditAmount(Number(e.target.value))}
                className="w-full bg-[#03060e] border border-cyan-900 rounded-xl px-3 py-2 text-cyan-300 font-bold text-base"
                min="1"
                max={currentUser.role === 'RESELLER' ? currentUser.credits : undefined}
              />
              <div className="flex gap-1.5 mt-2">
                {[20, 50, 100, 200]
                  .filter(amt => currentUser.role === 'SUPER_ADMIN' || amt <= currentUser.credits)
                  .map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCreditAmount(amt)}
                      className="flex-1 py-1 bg-slate-900 border border-slate-800 text-slate-300 rounded hover:text-cyan-300"
                    >
                      +{amt}G
                    </button>
                ))}
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setCreditingReseller(null)}
                className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handleCreditReseller(creditingReseller.id, creditAmount)}
                className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-black font-black rounded-xl shadow"
              >
                {currentUser.role === 'SUPER_ADMIN' ? 'Confirmer Recharge' : 'Transférer Crédits'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREATE CLIENT TOKEN */}
      {/* ========================================================================= */}
      {tokenModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#060c18] border border-emerald-900 rounded-3xl p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-950">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                Générer un Token Client (Forfait)
              </h3>
              <button onClick={() => setTokenModalOpen(false)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            {tokenCreationError && (
              <div className="p-3 bg-red-950/40 border border-red-500/50 rounded-xl text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{tokenCreationError}</span>
              </div>
            )}

            {currentUser.role === 'RESELLER' && (
              <div className="p-3 bg-cyan-950/30 border border-cyan-800 rounded-xl text-cyan-300 text-[11px] flex items-center justify-between">
                <span>Votre solde disponible :</span>
                <strong className="text-white text-xs">{currentUser.credits} Go</strong>
              </div>
            )}

            <form onSubmit={handleCreateClientToken} className="space-y-3">
              <div>
                <label className="block text-slate-300 mb-1">Code du Token Client</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTokenCode}
                    onChange={(e) => setNewTokenCode(e.target.value.toUpperCase())}
                    className="flex-1 bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-emerald-300 font-bold"
                    placeholder="ABESS-XXXXXXXXXXX"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setNewTokenCode(generateUnifiedToken())}
                    className="px-3 bg-slate-900 border border-slate-700 rounded-xl hover:text-white"
                    title="Générer un code aléatoire"
                  >
                    🎲
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-bold">Nom / Référence Client (Facultatif)</label>
                <input
                  type="text"
                  value={newTokenCustomerNote}
                  onChange={(e) => setNewTokenCustomerNote(e.target.value)}
                  placeholder="Ex. Client Paul - Yaoundé - 695140419"
                  maxLength={100}
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-slate-200"
                />
                <p className="mt-1 text-[10px] text-slate-500">Permet d'associer un nom ou contact client à ce token dans la table de gestion.</p>
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Nom du Plan Commercial</label>
                <input
                  type="text"
                  value={newTokenPlan}
                  onChange={(e) => setNewTokenPlan(e.target.value)}
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-bold">Configuration VPN associée</label>
                <select
                  value={newTokenConfigurationId}
                  onChange={(e) => setNewTokenConfigurationId(e.target.value)}
                  className="w-full bg-[#03060e] border border-cyan-900 rounded-xl px-3 py-2 text-cyan-200 font-bold"
                  required
                  disabled={availableConfigs.length === 0}
                >
                  <option value="">Choisir une configuration…</option>
                  {availableConfigs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name} — {config.protocol.toUpperCase()} / {config.transport.toUpperCase()} · Port {config.serverPort}
                    </option>
                  ))}
                </select>
                {availableConfigs.find(c => c.id === newTokenConfigurationId)?.protocol === 'ssh' && (
                  <div className="mt-2 p-2 bg-amber-950/30 border border-amber-800/50 rounded-xl text-amber-300 text-[11px] flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Protocole SSH-Payload : Le compte Dropbear et le payload d'injection sont gérés automatiquement selon le modèle administrateur.</span>
                  </div>
                )}
                {availableConfigs.length === 0 && (
                  <p className="mt-1 text-amber-300">Aucune configuration disponible. L’administrateur principal doit d’abord créer un profil dans Infrastructure.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-bold">Quota Gigas (Go)</label>
                  <input
                    type="number"
                    value={newTokenBandwidth}
                    onChange={(e) => setNewTokenBandwidth(Number(e.target.value))}
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-emerald-400 font-bold"
                    min="1"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-bold">Limite d'Appareils</label>
                  <input
                    type="number"
                    value={newTokenDeviceLimit}
                    onChange={(e) => setNewTokenDeviceLimit(Number(e.target.value))}
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-slate-200"
                    min="1"
                    max="10"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-bold">ID d’installation ABESS autorisée (facultatif)</label>
                <input
                  type="text"
                  value={newTokenAllowedDeviceId}
                  onChange={(e) => setNewTokenAllowedDeviceId(e.target.value.trim())}
                  className="w-full bg-[#03060e] border border-cyan-900 rounded-xl px-3 py-2 text-cyan-200 font-mono"
                  placeholder="Ex. HWID-PHONE-CYBER-123456"
                  maxLength={128}
                  pattern="[A-Za-z0-9._:-]{8,128}"
                  title="8 à 128 caractères sans espace : lettres, chiffres, point, tiret, underscore ou deux-points."
                />
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  Pour verrouiller cette licence à un seul téléphone, récupère son ID dans ABESS VPN → Mode manuel → ID d’installation et colle-le ici. Si tu laisses ce champ vide, la limite d’appareils classique continue de s’appliquer.
                </p>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-bold">Date &amp; Heure d'Expiration</label>
                <input
                  type="datetime-local"
                  value={newTokenExpiryDate}
                  onChange={(e) => setNewTokenExpiryDate(e.target.value)}
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-cyan-300 font-bold"
                  required
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setTokenModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={tokenCreating || !newTokenConfigurationId || availableConfigs.length === 0}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl shadow disabled:opacity-50"
                >
                  {tokenCreating ? 'Création...' : 'Valider & Déduire'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      
      {/* ========================================================================= */}
      {/* MODAL: BATCH / BULK TOKEN GENERATION (COMMERCIAL VOUCHERS) */}
      {/* ========================================================================= */}
      {batchModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#060c18] border border-cyan-500/40 rounded-3xl p-6 shadow-2xl space-y-4 font-mono text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-cyan-950">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <span>Génération en Masse de Vouchers / Cartes d'Accès</span>
              </h3>
              <button onClick={() => setBatchModalOpen(false)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            {batchError && (
              <div className="p-3 bg-red-950/40 border border-red-500/50 rounded-xl text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{batchError}</span>
              </div>
            )}

            {!batchResult ? (
              <form onSubmit={handleBatchTokenCreate} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 mb-1 font-bold">Nombre de Licences à Générer</label>
                    <input
                      type="number"
                      value={batchCount}
                      onChange={(e) => setBatchCount(Math.min(200, Math.max(1, Number(e.target.value))))}
                      className="w-full bg-[#03060e] border border-cyan-950 rounded-xl px-3 py-2 text-cyan-300 font-bold text-sm"
                      min="1"
                      max="200"
                      required
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Maximum : 200 par lot.</p>
                  </div>

                  <div>
                    <label className="block text-slate-300 mb-1 font-bold">Quota par Licence (Go)</label>
                    <input
                      type="number"
                      value={batchGb}
                      onChange={(e) => setBatchGb(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-[#03060e] border border-cyan-950 rounded-xl px-3 py-2 text-cyan-300 font-bold text-sm"
                      min="1"
                      required
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-900/60 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Total crédits déduits :</span>
                  <span className="text-cyan-400 font-bold text-sm">
                    {batchCount * batchGb} Go
                    {currentUser.role === 'RESELLER' && (
                      <span className="text-slate-500 font-normal ml-2">
                        (Votre solde : {currentUser.credits} Go)
                      </span>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 mb-1 font-bold">Validité (Jours)</label>
                    <input
                      type="number"
                      value={batchDays}
                      onChange={(e) => setBatchDays(Math.max(1, Number(e.target.value)))}
                      className="w-full bg-[#03060e] border border-cyan-950 rounded-xl px-3 py-2 text-slate-200"
                      min="1"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1 font-bold">Limite Appareils</label>
                    <input
                      type="number"
                      value={batchDeviceLimit}
                      onChange={(e) => setBatchDeviceLimit(Math.max(1, Math.min(10, Number(e.target.value))))}
                      className="w-full bg-[#03060e] border border-cyan-950 rounded-xl px-3 py-2 text-slate-200"
                      min="1"
                      max="10"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 mb-1 font-bold">Préfixe Code</label>
                    <input
                      type="text"
                      value={batchVoucherPrefix}
                      onChange={(e) => setBatchVoucherPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                      placeholder="VIP"
                      className="w-full bg-[#03060e] border border-cyan-950 rounded-xl px-3 py-2 text-cyan-300 font-bold"
                      maxLength={8}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-bold">Configuration / Serveur Associé</label>
                  <select
                    value={batchConfigId}
                    onChange={(e) => setBatchConfigId(e.target.value)}
                    className="w-full bg-[#03060e] border border-cyan-950 rounded-xl px-3 py-2 text-cyan-200"
                  >
                    {availableConfigs.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.protocol.toUpperCase()} / {c.transport.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-bold">Préfixe Note Client (Facultatif)</label>
                  <input
                    type="text"
                    value={batchNotePrefix}
                    onChange={(e) => setBatchNotePrefix(e.target.value)}
                    placeholder="Ex: Lot Cyber Vente N°1"
                    className="w-full bg-[#03060e] border border-cyan-950 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setBatchModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={batchLoading}
                    className="flex-1 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-black rounded-xl shadow disabled:opacity-50"
                  >
                    {batchLoading ? 'Génération du lot...' : `Générer ${batchCount} Vouchers (${batchCount * batchGb} Go)`}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 flex items-center justify-between">
                  <span className="font-bold">✅ {batchResult.length} Vouchers générés avec succès !</span>
                  <button
                    onClick={() => {
                      const allLinks = batchResult.map(t => `${t.token} : ${t.encryptedLink}`).join('\n');
                      navigator.clipboard.writeText(allLinks);
                      alert('Tous les liens ont été copiés dans le presse-papier !');
                    }}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-black font-bold rounded-lg text-xs flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copier Tout</span>
                  </button>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {batchResult.map((t, idx) => (
                    <div key={t.id} className="p-2.5 bg-black/60 rounded-xl border border-cyan-950 flex items-center justify-between gap-2">
                      <div>
                        <span className="text-slate-500 text-[10px] mr-2">#{idx + 1}</span>
                        <span className="font-bold text-cyan-300">{t.token}</span>
                        <span className="text-slate-400 text-[10px] ml-2">({t.bandwidthGb} Go • {t.days}j)</span>
                      </div>
                      <button
                        onClick={() => copyToClipboard(t.encryptedLink, `batch_${t.id}`)}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded text-[10px] flex items-center gap-1"
                      >
                        {copiedKey === `batch_${t.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === `batch_${t.id}` ? 'Copié' : 'Copier Lien'}</span>
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => {
                    setBatchResult(null);
                    setBatchModalOpen(false);
                  }}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 font-bold rounded-xl"
                >
                  Fermer
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: QR CODE DISPLAY FOR CLIENT */}
      {/* ========================================================================= */}
      {qrModalToken && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#060c18] border border-emerald-900 rounded-3xl p-6 shadow-2xl space-y-4 font-mono text-xs text-center">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-950">
              <h3 className="text-sm font-bold text-white">QR Code Client : {qrModalToken.token}</h3>
              <button onClick={() => setQrModalToken(null)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            {qrCodeDataUrl ? (
              <div className="p-3 bg-black rounded-2xl border border-emerald-900 inline-block mx-auto">
                <img src={qrCodeDataUrl} alt="QR Code" className="w-52 h-52 mx-auto rounded" />
              </div>
            ) : (
              <div className="py-8">Chargement du QR Code...</div>
            )}

            <div className="p-2.5 bg-black rounded-xl border border-emerald-950 break-all text-[10px] text-emerald-300 select-all max-h-24 overflow-y-auto">
              {qrModalToken.encryptedLink}
            </div>

            <button
              onClick={() => copyToClipboard(qrModalToken.encryptedLink, 'modal_link')}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold rounded-xl flex items-center justify-center gap-1.5"
            >
              {copiedKey === 'modal_link' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedKey === 'modal_link' ? 'Lien Copié !' : 'Copier Lien Crypté abess://'}</span>
            </button>

            {qrModalToken.directLink && (
              <button
                onClick={() => copyToClipboard(qrModalToken.directLink!, 'modal_direct_link')}
                className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-black font-bold rounded-xl flex items-center justify-center gap-1.5"
              >
                {copiedKey === 'modal_direct_link' ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                <span>{copiedKey === 'modal_direct_link' ? 'Lien Direct Copié !' : 'Copier Lien Direct (V2Ray / Clash)'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREATE / EDIT PRICING PLAN */}
      {/* ========================================================================= */}
      {planModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#060c18] border border-emerald-900 rounded-3xl p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-950">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Tag className="w-4 h-4 text-emerald-400" />
                {editingPlanId ? 'Modifier le Forfait' : 'Nouveau Forfait Commercial'}
              </h3>
              <button onClick={() => setPlanModalOpen(false)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleSavePlan} className="space-y-3">
              <div>
                <label className="block text-slate-300 mb-1 font-bold">Nom du Forfait</label>
                <input
                  type="text"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="ex: Performance 50 Go"
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-bold">Quota (Go)</label>
                  <input
                    type="number"
                    value={planQuotaGb}
                    onChange={(e) => setPlanQuotaGb(Number(e.target.value))}
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1 font-bold">Durée (Jours)</label>
                  <input
                    type="number"
                    value={planDurationDays}
                    onChange={(e) => setPlanDurationDays(Number(e.target.value))}
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                    min="1"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-bold">Prix (FCFA)</label>
                  <input
                    type="number"
                    value={planPriceCfa}
                    onChange={(e) => setPlanPriceCfa(Number(e.target.value))}
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-cyan-300 font-bold"
                    min="0"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1 font-bold">Badge Commercial</label>
                  <input
                    type="text"
                    value={planBadge}
                    onChange={(e) => setPlanBadge(e.target.value)}
                    placeholder="ex: POPULAIRE"
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-bold">Description Commerciale</label>
                <textarea
                  value={planDesc}
                  onChange={(e) => setPlanDesc(e.target.value)}
                  placeholder="Idéal pour réseaux sociaux, streaming HD et navigation quotidienne."
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white h-16"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPlanModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl shadow"
                >
                  {editingPlanId ? 'Enregistrer Modifications' : 'Créer Forfait'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: MULTI-VARIANTS & UNIVERSAL SUBSCRIPTION PORTAL */}
      {/* ========================================================================= */}
      {variantsModalOpen && variantsModalToken && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#060c18] border border-indigo-900 rounded-3xl p-6 shadow-2xl space-y-4 font-mono text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-indigo-950">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="text-base font-bold text-white">
                    Portail Universel & Moteur VLESS Multi-Variantes
                  </h3>
                  <span className="text-emerald-400 font-bold">{variantsModalToken.token}</span>
                  <span className="text-slate-400 ml-2">({variantsModalToken.bandwidthGb} Go • {variantsModalToken.plan})</span>
                </div>
              </div>
              <button onClick={() => setVariantsModalOpen(false)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            {/* Portal Link Box */}
            <div className="p-3 bg-[#03060e] border border-indigo-950 rounded-xl space-y-2">
              <span className="text-slate-400 text-[10px] uppercase font-bold block">
                Lien Universel de Souscription (Ouvrable dans tout navigateur) :
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={variantsSubUrl ? `${window.location.origin}${variantsSubUrl}` : `${window.location.origin}/sub/${variantsModalToken.token}`}
                  className="flex-1 bg-black border border-indigo-900/60 rounded-lg px-3 py-1.5 text-indigo-300 font-mono text-xs select-all"
                />
                <button
                  onClick={() => copyToClipboard(
                    variantsSubUrl ? `${window.location.origin}${variantsSubUrl}` : `${window.location.origin}/sub/${variantsModalToken.token}`,
                    'sub_portal_link'
                  )}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-black font-bold rounded-lg text-xs flex items-center gap-1"
                >
                  {copiedKey === 'sub_portal_link' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'sub_portal_link' ? 'Copié' : 'Copier'}</span>
                </button>
                <a
                  href={variantsSubUrl || `/sub/${variantsModalToken.token}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-xs flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Ouvrir</span>
                </a>
              </div>
            </div>

            {/* Variants List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-white text-xs">Variantes Réseau Déployées :</h4>
                {variantsClientJson && (
                  <button
                    onClick={() => {
                      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(variantsClientJson, null, 2));
                      const dlAnchor = document.createElement('a');
                      dlAnchor.setAttribute('href', dataStr);
                      dlAnchor.setAttribute('download', `xray-client-${variantsModalToken.token}.json`);
                      dlAnchor.click();
                    }}
                    className="text-cyan-400 hover:text-cyan-300 text-[11px] flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Télécharger config Xray Client (.json)</span>
                  </button>
                )}
              </div>

              {variantsLoading ? (
                <div className="py-8 text-center text-slate-400 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Calcul et génération des variantes en cours...</span>
                </div>
              ) : variantsList.length === 0 ? (
                <div className="p-4 text-center text-slate-500">Aucune variante disponible.</div>
              ) : (
                <div className="space-y-2">
                  {variantsList.map((variant) => (
                    <div
                      key={variant.id}
                      className="p-3 bg-[#03060e] border border-emerald-950 hover:border-indigo-800 rounded-xl space-y-2 transition"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-800">
                            {variant.badge}
                          </span>
                          <span className="font-bold text-white text-xs">{variant.label}</span>
                        </div>
                        <button
                          onClick={() => copyToClipboard(variant.uri, `var_${variant.id}`)}
                          className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded text-[11px] flex items-center gap-1"
                        >
                          {copiedKey === `var_${variant.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedKey === `var_${variant.id}` ? 'Copié !' : 'Copier Lien'}</span>
                        </button>
                      </div>

                      <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
                        <span>SNI : <code className="text-cyan-300">{variant.sni}</code></span>
                        <span>Cible : <code className="text-slate-300">{variant.target}</code></span>
                      </div>

                      <div className="p-1.5 bg-black rounded border border-emerald-950/60 font-mono text-[9px] text-emerald-400 break-all select-all">
                        {variant.uri}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-indigo-950 flex justify-end">
              <button
                onClick={() => setVariantsModalOpen(false)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREATE NEW ANNOUNCEMENT */}
      {/* ========================================================================= */}
      {announcementModalOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-[#060c18] border border-emerald-900 rounded-3xl p-6 shadow-2xl space-y-4 font-mono text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-emerald-950">
              <div className="flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">
                  Diffuser une Nouvelle Annonce Réseau
                </h3>
              </div>
              <button onClick={() => setAnnouncementModalOpen(false)} className="text-slate-500 hover:text-white text-base">✕</button>
            </div>

            <form onSubmit={handleCreateAnnouncement} className="space-y-4">
              <div>
                <label className="block text-slate-300 mb-1 font-bold">Titre de l'Annonce *</label>
                <input
                  type="text"
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  placeholder="ex: ⚡ Maintenance Serveur ou 🎁 Promo Forfait Illimité"
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white font-sans text-sm focus:border-emerald-400 focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-bold">Type d'Annonce</label>
                  <select
                    value={annType}
                    onChange={(e) => setAnnType(e.target.value as any)}
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="INFO">ℹ️ Information Générale</option>
                    <option value="PROMO">🎁 Promotion / Offre Commerciale</option>
                    <option value="UPDATE">🚀 Nouvelle Version Disponible</option>
                    <option value="WARNING">⚡ Avertissement Réseau</option>
                    <option value="CRITICAL">⚠️ Critique (Bloquante / Urgente)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-bold">Plateforme Destinataire</label>
                  <select
                    value={annPlatform}
                    onChange={(e) => setAnnPlatform(e.target.value as any)}
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                  >
                    <option value="ALL">🌐 Tous les Utilisateurs (Android + Windows)</option>
                    <option value="ANDROID">📱 Application Android uniquement</option>
                    <option value="WINDOWS">Logiciel Windows PC uniquement</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-bold">Message Complet *</label>
                <textarea
                  value={annMessage}
                  onChange={(e) => setAnnMessage(e.target.value)}
                  placeholder="Rédigez le texte clair de l'annonce qui s'affichera au premier plan sur l'écran..."
                  rows={4}
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white font-sans text-sm focus:border-emerald-400 focus:outline-none"
                  required
                />
              </div>

              <div className="p-3 bg-black/40 rounded-xl border border-emerald-950 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isMandatory"
                    checked={annIsMandatory}
                    onChange={(e) => setAnnIsMandatory(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-500 focus:ring-0 bg-[#03060e] border-slate-700"
                  />
                  <label htmlFor="isMandatory" className="text-slate-200 font-bold cursor-pointer">
                    Annonce Obligatoire / Bloquante (Force l'utilisateur à voir et cliquer avant de continuer)
                  </label>
                </div>

                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">Fréquence d'Affichage :</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAnnShowMode('ONCE_PER_USER')}
                      className={`p-2 rounded-lg border text-left transition ${
                        annShowMode === 'ONCE_PER_USER'
                          ? 'border-emerald-500 bg-emerald-950/30 text-emerald-300 font-bold'
                          : 'border-slate-800 text-slate-400 hover:bg-slate-900'
                      }`}
                    >
                      1️⃣ Une seule fois par utilisateur
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnnShowMode('EVERY_LAUNCH')}
                      className={`p-2 rounded-lg border text-left transition ${
                        annShowMode === 'EVERY_LAUNCH'
                          ? 'border-emerald-500 bg-emerald-950/30 text-emerald-300 font-bold'
                          : 'border-slate-800 text-slate-400 hover:bg-slate-900'
                      }`}
                    >
                      🔁 À chaque ouverture de l'application
                    </button>
                  </div>
                </div>
              </div>

              {/* Action Button Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-black/40 rounded-xl border border-emerald-950">
                <div>
                  <label className="block text-slate-300 mb-1 text-[11px] font-bold">
                    Texte du Bouton d'Action (Optionnel)
                  </label>
                  <input
                    type="text"
                    value={annBtnText}
                    onChange={(e) => setAnnBtnText(e.target.value)}
                    placeholder="ex: Mettre à jour, Voir l'offre, Ouvrir Telegram"
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 text-[11px] font-bold">
                    Lien / URL du Bouton (Optionnel)
                  </label>
                  <input
                    type="url"
                    value={annBtnUrl}
                    onChange={(e) => setAnnBtnUrl(e.target.value)}
                    placeholder="https://t.me/Abess_Vpn"
                    className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setAnnouncementModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl font-bold cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={annLoading}
                  className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-black font-black rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)] transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Megaphone className={`w-4 h-4 ${annLoading ? 'animate-spin' : ''}`} />
                  <span>{annLoading ? 'Diffusion...' : 'Diffuser sur tout le Réseau'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: LIVE PREVIEW OF POPUP ON USER SCREEN */}
      {/* ========================================================================= */}
      {previewAnnouncement && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0a101f] border-2 border-emerald-500 rounded-3xl p-6 shadow-[0_0_50px_rgba(16,185,129,0.35)] space-y-4 font-mono relative animate-in fade-in zoom-in-95 duration-200">
            {/* Top Bar with Badge & Dismiss button */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-emerald-300" />
                </div>
                <div>
                  <h4 className="font-black text-white text-sm">AbessVpn Annonce</h4>
                  <span className="text-[10px] text-emerald-400 font-bold uppercase">{previewAnnouncement.type}</span>
                </div>
              </div>

              {!previewAnnouncement.isMandatory && (
                <button
                  onClick={() => setPreviewAnnouncement(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Title & Body */}
            <div className="space-y-2">
              <h3 className="text-base font-black text-white leading-snug">{previewAnnouncement.title}</h3>
              <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap font-sans">
                {previewAnnouncement.message}
              </p>
            </div>

            {/* Action Button */}
            {previewAnnouncement.actionButtonText && (
              <a
                href={previewAnnouncement.actionButtonUrl || '#'}
                target="_blank"
                rel="noreferrer"
                className="w-full py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 text-black font-black text-xs rounded-xl flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.4)] transition text-center block"
              >
                <span>{previewAnnouncement.actionButtonText}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            {/* Close / Acknowledge */}
            <button
              onClick={() => setPreviewAnnouncement(null)}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 text-xs rounded-xl font-bold transition"
            >
              {previewAnnouncement.isMandatory ? 'J\'ai compris et je poursuis' : 'Fermer l\'annonce'}
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-emerald-950 bg-black px-4 py-3 text-center text-xs text-slate-500 font-mono">
        <p>
          AbessVpn Enterprise Server • Moteur WebSocket sur <code className="text-emerald-400">/@abess237</code>
        </p>
      </footer>
    </div>
  );
}
