import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
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
  FileKey
} from 'lucide-react';

interface UserSession {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'RESELLER';
  credits: number;
  totalTokensCreated: number;
  totalBandwidthAllocatedGb: number;
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
}

interface ClientToken {
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

interface MasterConfig {
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

export default function App() {
  // Session State
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [authToken, setAuthToken] = useState<string>('');
  const [loginEmail, setLoginEmail] = useState<string>('rigomanga4@gmail.com');
  const [loginPassword, setLoginPassword] = useState<string>('abess237');
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'overview' | 'resellers' | 'tokens' | 'infrastructure' | 'logs'>('overview');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Stats & Lists
  const [stats, setStats] = useState<any>(null);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [tokens, setTokens] = useState<ClientToken[]>([]);
  const [masterConfig, setMasterConfig] = useState<MasterConfig | null>(null);
  const [configSaving, setConfigSaving] = useState<boolean>(false);
  const [configSuccess, setConfigSuccess] = useState<boolean>(false);

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
  const [newTokenCode, setNewTokenCode] = useState<string>('');
  const [newTokenPlan, setNewTokenPlan] = useState<string>('PASS COMMERCE 30J');
  const [newTokenBandwidth, setNewTokenBandwidth] = useState<number>(50); // Go
  const [newTokenExpiryDate, setNewTokenExpiryDate] = useState<string>(
    new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 16)
  );
  const [newTokenDeviceLimit, setNewTokenDeviceLimit] = useState<number>(2);
  const [tokenCreating, setTokenCreating] = useState<boolean>(false);
  const [tokenCreationError, setTokenCreationError] = useState<string | null>(null);

  // Display QR Code Modal
  const [qrModalToken, setQrModalToken] = useState<ClientToken | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');

  // Server Logs
  const [systemLogs, setSystemLogs] = useState<string[]>([
    '[SYSTEM BOOT] AbessVpn Master Server v2026.4 initialisé avec succès.',
    '[AUTH CORE] Super Admin configuré sur rigomanga4@gmail.com.',
    '[TUNNEL GATE] Moteur WebSocket VLESS actif sur /@abess237.',
    '[RESELLER ISOLATION] Masquage cryptographique des hôtes et SNI activé.',
  ]);

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
        localStorage.clear();
      }
    }
  }, []);

  // Fetch all dashboard data when user is logged in
  const refreshData = async () => {
    if (!authToken) return;

    try {
      const headers = { 'Authorization': `Bearer ${authToken}` };

      // Stats
      const statsRes = await fetch('/api/v1/admin/stats', { headers });
      if (statsRes.ok) setStats(await statsRes.json());

      // Tokens (Admin or Reseller specific)
      const tokensRes = await fetch('/api/v1/admin/tokens', { headers });
      if (tokensRes.ok) setTokens(await tokensRes.json());

      // Resellers (Only for Super Admin)
      if (currentUser?.role === 'SUPER_ADMIN') {
        const resellersRes = await fetch('/api/v1/admin/resellers', { headers });
        if (resellersRes.ok) setResellers(await resellersRes.json());

        // Master config
        const configRes = await fetch('/api/v1/admin/server-config', { headers });
        if (configRes.ok) setMasterConfig(await configRes.json());
      }
    } catch {
      // offline fallback
    }
  };

  useEffect(() => {
    if (authToken) {
      refreshData();
      const interval = setInterval(refreshData, 8000);
      return () => clearInterval(interval);
    }
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
    setAuthToken('');
    setCurrentUser(null);
    localStorage.removeItem('abess_admin_token');
    localStorage.removeItem('abess_admin_user');
    addLog(`[LOGOUT] Déconnexion effectuée.`);
  };

  // Create Reseller (Super Admin)
  const handleCreateReseller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResellerEmail || !newResellerPassword || !newResellerName) return;

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
          initialCredits: Number(newResellerCredits) || 100
        })
      });

      if (res.ok) {
        setResellerModalOpen(false);
        setNewResellerName('');
        setNewResellerEmail('');
        setNewResellerPassword('');
        refreshData();
        addLog(`[RESELLER CREATE] Compte revendeur créé pour ${newResellerEmail} (+${newResellerCredits} Go)`);
      } else {
        const data = await res.json();
        alert(data.error || 'Erreur lors de la création du revendeur');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Credit Reseller
  const handleCreditReseller = async (resellerId: string, amount: number) => {
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
        addLog(`[RESELLER RECHARGE] Revendeur rechargé de +${amount} Go de crédits.`);
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

    const generatedCode = newTokenCode.trim() || 'ABESS-' + Math.random().toString(36).substring(2, 8).toUpperCase();

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
          deviceLimit: Number(newTokenDeviceLimit)
        })
      });

      const data = await res.json();
      if (res.ok) {
        setTokenModalOpen(false);
        setNewTokenCode('');
        refreshData();
        addLog(`[CLIENT TOKEN CREATE] Token client ${data.token} créé (${data.bandwidthGb} Go).`);
      } else {
        setTokenCreationError(data.error || 'Erreur lors de la création du token');
      }
    } catch (err: unknown) {
      setTokenCreationError(err instanceof Error ? err.message : String(err));
    } finally {
      setTokenCreating(false);
    }
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

  // Save Master Config (Super Admin only)
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterConfig) return;
    setConfigSaving(true);
    setConfigSuccess(false);

    try {
      const res = await fetch('/api/v1/admin/server-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(masterConfig)
      });
      if (res.ok) {
        setConfigSuccess(true);
        setTimeout(() => setConfigSuccess(false), 3000);
        addLog(`[MASTER CONFIG] Configuration d'infrastructure sauvegardée.`);
      }
    } catch (err) {
      console.error(err);
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

  // ==========================================
  // LOGIN SCREEN
  // ==========================================
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#03060e] text-emerald-400 font-mono flex items-center justify-center p-4 selection:bg-emerald-500 selection:text-black">
        <div className="w-full max-w-md bg-[#060c18] border border-emerald-900/80 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden space-y-6">
          <div className="text-center space-y-2">
            <div className="h-14 w-14 mx-auto rounded-2xl bg-gradient-to-tr from-emerald-500 to-cyan-500 p-0.5 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
              <div className="w-full h-full bg-[#03060e] rounded-[14px] flex items-center justify-center">
                <Shield className="w-7 h-7 text-emerald-400 animate-pulse" />
              </div>
            </div>
            <h1 className="text-xl font-black tracking-wider text-white">
              Abess<span className="text-emerald-400">Vpn</span> Server
            </h1>
            <p className="text-xs text-slate-400">
              Portail Authentifié Super Admin &amp; Revendeurs
            </p>
          </div>

          {loginError && (
            <div className="p-3 bg-red-950/40 border border-red-500/50 rounded-xl text-xs text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-300 font-bold mb-1 uppercase text-[11px]">Adresse Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="rigomanga4@gmail.com"
                className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-400 font-sans"
                required
              />
            </div>

            <div>
              <label className="block text-slate-300 font-bold mb-1 uppercase text-[11px]">Mot de Passe</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-400 font-sans pr-10"
                  required
                />
                <button
                  type="button"
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
              <span>{loginLoading ? 'Connexion en cours...' : 'SE CONNECTER AU SERVEUR'}</span>
            </button>
          </form>

          {/* Quick Demo Credentials for Fast Testing */}
          <div className="pt-4 border-t border-emerald-950/80 space-y-2 text-[11px]">
            <span className="text-slate-500 font-bold uppercase block text-[10px]">Identifiants Configurés :</span>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setLoginEmail('rigomanga4@gmail.com');
                  setLoginPassword('abess237');
                }}
                className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-left hover:bg-emerald-950/60 transition"
              >
                <div className="font-bold text-emerald-300">👑 Super Admin Principal</div>
                <div className="text-slate-400 text-[10px]">rigomanga4@gmail.com • MDP: abess237</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLoginEmail('revendeur@abessvpn.com');
                  setLoginPassword('revendeur123');
                }}
                className="p-2 rounded-lg bg-cyan-950/30 border border-cyan-500/30 text-left hover:bg-cyan-950/60 transition"
              >
                <div className="font-bold text-cyan-300">💼 Revendeur Démo (250 Go)</div>
                <div className="text-slate-400 text-[10px]">revendeur@abessvpn.com • MDP: revendeur123</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // AUTHENTICATED PANEL
  // ==========================================
  return (
    <div className="min-h-screen bg-[#03060e] text-emerald-400 font-mono flex flex-col selection:bg-emerald-500 selection:text-black">
      {/* Top Bar with DEFCON & Active User Banner */}
      <div className="border-b border-emerald-950 bg-black/90 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3 text-emerald-400">
        <div className="flex items-center gap-3">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="font-bold tracking-widest text-white">
            ABESS<span className="text-emerald-400">VPN</span> ENTERPRISE SERVER
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
                  Panneau de Contrôle Abess<span className="text-emerald-400">Vpn</span>
                </h1>
                <span className="text-xs text-slate-500">v2026.4</span>
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
                setNewTokenCode('ABESS-' + Math.random().toString(36).substring(2, 8).toUpperCase());
                setTokenCreationError(null);
                setTokenModalOpen(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl text-xs flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition"
            >
              <Plus className="w-4 h-4" />
              <span>Générer un Token Client</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <nav className="flex space-x-1 sm:space-x-2 border-t border-emerald-900/40 overflow-x-auto py-1 scrollbar-none text-xs">
            {[
              { id: 'overview', label: '📊 Tableau de Bord', icon: Activity },
              ...(currentUser.role === 'SUPER_ADMIN'
                ? [
                    { id: 'resellers', label: '👥 Gestion des Revendeurs', icon: Users },
                    { id: 'infrastructure', label: '🔒 Infrastructure Maître (Confidentiel)', icon: Database },
                  ]
                : []),
              { id: 'tokens', label: '🔑 Clients & Licences Générées', icon: Key },
              { id: 'logs', label: '💻 Journal Serveur & Télémétrie', icon: Terminal },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition whitespace-nowrap font-bold ${
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full space-y-6">

        {/* ========================================================================= */}
        {/* TAB 1: OVERVIEW METRICS */}
        {/* ========================================================================= */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
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
                    {stats?.totalCreditsInCirculation ?? 250} Go
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
                    {stats?.totalBandwidthAllocated ?? 600} Go
                  </div>
                  <span className="text-[10px] text-slate-400">Consommation : {stats?.totalBandwidthConsumed ?? 3.42} Go</span>
                </div>
              </div>
            ) : (
              // Reseller Dashboard Stats
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
                <div className="p-5 rounded-2xl bg-cyan-950/30 border border-cyan-500/50 space-y-2">
                  <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider block">
                    Votre Solde de Crédits Disponible
                  </span>
                  <div className="text-3xl font-black text-white">{currentUser.credits} Go</div>
                  <p className="text-slate-300 text-[11px]">
                    Vous pouvez générer jusqu'à {currentUser.credits} Go de forfaits clients.
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-[#060c18] border border-emerald-900/60 space-y-2">
                  <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">
                    Clients Créés
                  </span>
                  <div className="text-3xl font-black text-emerald-300 font-mono">{tokens.length}</div>
                  <p className="text-slate-400 text-[11px]">
                    {tokens.filter(t => t.status === 'active').length} tokens actuellement actifs
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
                    setNewTokenCode('ABESS-' + Math.random().toString(36).substring(2, 8).toUpperCase());
                    setTokenModalOpen(true);
                  }}
                  className="p-4 rounded-xl bg-black/60 border border-emerald-900/60 hover:border-emerald-500 text-left transition group"
                >
                  <Plus className="w-5 h-5 text-emerald-400 mb-2 group-hover:scale-110 transition" />
                  <strong className="text-white block mb-0.5">Créer un Forfait Client</strong>
                  <span className="text-slate-400 text-[11px]">Définir quota en Go et date d'expiration</span>
                </button>

                {currentUser.role === 'SUPER_ADMIN' && (
                  <button
                    onClick={() => setResellerModalOpen(true)}
                    className="p-4 rounded-xl bg-black/60 border border-emerald-900/60 hover:border-cyan-500 text-left transition group"
                  >
                    <Users className="w-5 h-5 text-cyan-400 mb-2 group-hover:scale-110 transition" />
                    <strong className="text-white block mb-0.5">Nouveau Revendeur</strong>
                    <span className="text-slate-400 text-[11px]">Créer un compte distributeur et le créditer</span>
                  </button>
                )}

                <button
                  onClick={() => setActiveTab('logs')}
                  className="p-4 rounded-xl bg-black/60 border border-emerald-900/60 hover:border-indigo-500 text-left transition group"
                >
                  <Terminal className="w-5 h-5 text-indigo-400 mb-2 group-hover:scale-110 transition" />
                  <strong className="text-white block mb-0.5">Journal Serveur Live</strong>
                  <span className="text-slate-400 text-[11px]">Surveiller les connexions WebSocket et les requêtes</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: RESELLERS MANAGEMENT (SUPER ADMIN ONLY) */}
        {/* ========================================================================= */}
        {activeTab === 'resellers' && currentUser.role === 'SUPER_ADMIN' && (
          <div className="space-y-6 animate-fade-in font-mono text-xs">
            <div className="p-6 rounded-2xl bg-[#060c18] border border-emerald-900/80 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-emerald-950">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-emerald-400" />
                    Gestion des Revendeurs Agréés
                  </h2>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Créez des accès revendeurs et rechargez leur solde de crédits (Gigas). Les revendeurs ne voient JAMAIS les hôtes, SNI ou IPs maîtres.
                  </p>
                </div>

                <button
                  onClick={() => setResellerModalOpen(true)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl text-xs flex items-center gap-1.5 transition shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nouveau Revendeur</span>
                </button>
              </div>

              {/* Resellers Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-emerald-950 text-slate-500 text-[10px] uppercase">
                      <th className="py-2.5 px-3">Revendeur</th>
                      <th className="py-2.5 px-3">Email de Connexion</th>
                      <th className="py-2.5 px-3">Solde Crédits (Go)</th>
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
                        <td className="py-3 px-3 font-bold text-cyan-300 text-sm">{r.credits} Go</td>
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
                                setCreditAmount(100);
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

                <button
                  onClick={() => {
                    setNewTokenCode('ABESS-' + Math.random().toString(36).substring(2, 8).toUpperCase());
                    setTokenCreationError(null);
                    setTokenModalOpen(true);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl text-xs flex items-center gap-1.5 transition shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Créer un Token Client</span>
                </button>
              </div>

              {/* Tokens Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-emerald-950 text-slate-500 text-[10px] uppercase">
                      <th className="py-2.5 px-3">Token Client</th>
                      <th className="py-2.5 px-3">Plan Commercial</th>
                      {currentUser.role === 'SUPER_ADMIN' && <th className="py-2.5 px-3">Revendeur</th>}
                      <th className="py-2.5 px-3">Quota Go</th>
                      <th className="py-2.5 px-3">Consommé</th>
                      <th className="py-2.5 px-3">Expiration</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3 text-right">Lien Crypté &amp; Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-950/60">
                    {tokens.map((token) => (
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
                        </td>
                        <td className="py-3 px-3 text-slate-300">{token.plan}</td>
                        {currentUser.role === 'SUPER_ADMIN' && (
                          <td className="py-3 px-3 text-cyan-400">{token.resellerName}</td>
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
                              : 'bg-red-500/20 text-red-300 border border-red-500/40'
                          }`}>
                            {token.status === 'active' ? 'ACTIF' : 'EXPIRÉ'}
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

                            <button
                              onClick={() => openQrModal(token)}
                              className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-slate-300"
                              title="Afficher QR Code"
                            >
                              <Zap className="w-3.5 h-3.5 text-cyan-400" />
                            </button>

                            <button
                              onClick={() => handleDeleteToken(token.id, token.token)}
                              className="p-1.5 text-red-400 hover:text-red-300"
                              title="Révoquer ce token"
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
        {activeTab === 'infrastructure' && currentUser.role === 'SUPER_ADMIN' && masterConfig && (
          <div className="space-y-6 animate-fade-in font-mono text-xs">
            <div className="p-6 rounded-2xl bg-[#060c18] border border-emerald-900/80 shadow-xl space-y-5">
              <div className="pb-3 border-b border-emerald-950">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-amber-400" />
                  <h2 className="text-base font-bold text-white">
                    Paramètres d'Infrastructure du Serveur Maître
                  </h2>
                </div>
                <div className="mt-2 p-3 bg-amber-950/30 border border-amber-500/40 rounded-xl text-amber-300 text-[11px] flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>Confidentialité stricte :</strong> Ces informations (Hôte, SNI, IP, UUID, Passphrase) sont gérées exclusivement par le Super Administrateur. Aucun revendeur n'y a accès.
                  </span>
                </div>
              </div>

              {configSuccess && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/50 rounded-xl text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Configuration du serveur maître mise à jour avec succès.</span>
                </div>
              )}

              <form onSubmit={handleSaveConfig} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Serveur Hôte / Domaine Principal</label>
                  <input
                    type="text"
                    value={masterConfig.serverHost}
                    onChange={(e) => setMasterConfig({ ...masterConfig, serverHost: e.target.value })}
                    className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-2 text-emerald-300 font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Port d'Écoute</label>
                  <input
                    type="number"
                    value={masterConfig.serverPort}
                    onChange={(e) => setMasterConfig({ ...masterConfig, serverPort: Number(e.target.value) })}
                    className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-2 text-slate-200"
                    required
                  />
                </div>

                <div>
                  {/* Generated Xray profiles with TLS on TCP 443; native Shadowsocks TCP/UDP uses port 10050. */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Protocole Xray</label>
                  <select value={masterConfig.protocol} onChange={(e) => { const protocol = e.target.value; const transport = protocol === "shadowsocks" ? "native" : (masterConfig.transport === "native" || (protocol !== "vmess" && ["raw", "kcp"].includes(masterConfig.transport))) ? "ws" : masterConfig.transport; setMasterConfig({ ...masterConfig, protocol, transport }); }} className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-2 text-emerald-200">
                    <option value="vless">VLESS</option><option value="vmess">VMess</option><option value="trojan">Trojan</option><option value="shadowsocks">Shadowsocks AEAD</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Transport</label>
                  <select value={masterConfig.transport} onChange={(e) => setMasterConfig({ ...masterConfig, transport: e.target.value })} className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-2 text-emerald-200">
                    <option value="ws" disabled={masterConfig.protocol === "shadowsocks"}>WebSocket (WS)</option><option value="grpc" disabled={masterConfig.protocol === "shadowsocks"}>gRPC</option><option value="httpupgrade" disabled={masterConfig.protocol === "shadowsocks"}>HTTPUpgrade</option><option value="xhttp" disabled={masterConfig.protocol === "shadowsocks"}>XHTTP</option>
                    <option value="raw" disabled={masterConfig.protocol !== "vmess"}>RAW / TCP direct (VMess)</option>
                    <option value="kcp" disabled={masterConfig.protocol !== "vmess"}>mKCP / UDP (VMess)</option>
                    <option value="native" disabled={masterConfig.protocol !== "shadowsocks"}>TCP + UDP natifs (Shadowsocks)</option>
                  </select>
                </div>
                <div className="md:col-span-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-slate-400">
                  Les profils WS/gRPC/HTTPUpgrade/XHTTP passent par TLS sur TCP 443. VMess RAW utilise TCP 10060 et VMess mKCP utilise UDP 10061. Shadowsocks natif utilise TCP + UDP sur 10050. Ouvre les ports 10050/TCP+UDP, 10060/TCP et 10061/UDP dans le pare-feu. RAW/mKCP sont réservés à VMess pour ne pas exposer VLESS sans TLS ni Trojan sans couche TLS.
                </div>
                <label className="block text-slate-300 font-semibold mb-1">Chemin WebSocket (VLESS + WS)</label>
                  <input
                    type="text"
                    value={masterConfig.path}
                    readOnly
                    className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-2 text-slate-200"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">SNI Bug Host Maître</label>
                  <input
                    type="text"
                    value={masterConfig.sniHost}
                    onChange={(e) => setMasterConfig({ ...masterConfig, sniHost: e.target.value })}
                    className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-2 text-amber-300"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-slate-300 font-semibold mb-1">UUID Principal Xray / VLESS</label>
                  <input
                    type="text"
                    value={masterConfig.uuid}
                    onChange={(e) => setMasterConfig({ ...masterConfig, uuid: e.target.value })}
                    className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-2 text-indigo-300 font-mono"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-slate-300 font-semibold mb-1">Passphrase Secrète AES-256 (Chiffrement abess://)</label>
                  <input
                    type="text"
                    value={masterConfig.secretPassphrase}
                    onChange={(e) => setMasterConfig({ ...masterConfig, secretPassphrase: e.target.value })}
                    className="w-full bg-[#03060e] border border-emerald-900 rounded-lg px-3 py-2 text-purple-300 font-mono"
                    required
                  />
                </div>

                <div className="md:col-span-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={configSaving}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl text-xs flex items-center gap-2 shadow transition"
                  >
                    <Check className="w-4 h-4" />
                    <span>{configSaving ? 'Sauvegarde...' : 'Sauvegarder la Configuration Maître'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
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
      </main>

      {/* ========================================================================= */}
      {/* MODAL: CREATE RESELLER */}
      {/* ========================================================================= */}
      {resellerModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#060c18] border border-emerald-900 rounded-3xl p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-950">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                Créer un Nouveau Compte Revendeur
              </h3>
              <button onClick={() => setResellerModalOpen(false)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateReseller} className="space-y-3">
              <div>
                <label className="block text-slate-300 mb-1">Nom / Entreprise du Revendeur</label>
                <input
                  type="text"
                  value={newResellerName}
                  onChange={(e) => setNewResellerName(e.target.value)}
                  placeholder="ex: Distributeur Douala Pro"
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Email du Revendeur (Identifiant)</label>
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
                <label className="block text-slate-300 mb-1">Solde Initial Crédité (en Gigas - Go)</label>
                <input
                  type="number"
                  value={newResellerCredits}
                  onChange={(e) => setNewResellerCredits(Number(e.target.value))}
                  className="w-full bg-[#03060e] border border-emerald-950 rounded-xl px-3 py-2 text-cyan-300 font-bold"
                  min="0"
                />
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
                  Créer Revendeur
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
                Recharger le Solde
              </h3>
              <button onClick={() => setCreditingReseller(null)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            <p className="text-slate-300 text-xs">
              Revendeur : <strong className="text-white">{creditingReseller.name}</strong> ({creditingReseller.email})<br />
              Solde actuel : <strong className="text-cyan-300">{creditingReseller.credits} Go</strong>
            </p>

            <div>
              <label className="block text-slate-300 mb-1 font-bold">Montant à Ajouter (Gigas - Go)</label>
              <input
                type="number"
                value={creditAmount}
                onChange={(e) => setCreditAmount(Number(e.target.value))}
                className="w-full bg-[#03060e] border border-cyan-900 rounded-xl px-3 py-2 text-cyan-300 font-bold text-base"
                min="1"
              />
              <div className="flex gap-1.5 mt-2">
                {[50, 100, 250, 500].map((amt) => (
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
                Confirmer Recharge
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
                    placeholder="ABESS-XXXXXX"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setNewTokenCode('ABESS-' + Math.random().toString(36).substring(2, 8).toUpperCase())}
                    className="px-3 bg-slate-900 border border-slate-700 rounded-xl hover:text-white"
                  >
                    🎲
                  </button>
                </div>
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
                  disabled={tokenCreating}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-black font-black rounded-xl shadow"
                >
                  {tokenCreating ? 'Création...' : 'Valider & Déduire'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
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
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-emerald-950 bg-black px-4 py-3 text-center text-xs text-slate-500 font-mono">
        <p>
          AbessVpn Enterprise Server • Super Admin : <code className="text-slate-400">rigomanga4@gmail.com</code> • Moteur WebSocket sur <code className="text-emerald-400">/@abess237</code>
        </p>
      </footer>
    </div>
  );
}
