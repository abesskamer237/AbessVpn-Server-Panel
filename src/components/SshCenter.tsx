import { useEffect, useState } from "react";
import {
  Copy,
  Download,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react";
import { RenewLicence } from './RenewLicence';
export function SshCenter({ token, isAdmin = true }: { token: string; isAdmin?: boolean }) {
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [renewId, setRenewId] = useState<string | null>(null);
  const [resellerId, setResellerId] = useState('');
  const [mode, setMode] = useState('tcp');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [payload, setPayload] = useState('');
  const [path, setPath] = useState('/ws-ssh');
  const [sni, setSni] = useState('');
  const [importJson, setImportJson] = useState("");
  const [host, setHost] = useState('');
  const [nodeId, setNodeId] = useState("");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  const [quotaGb, setQuota] = useState(10);
  const [connections, setConnections] = useState(1);
  const [selected, setSelected] = useState("");
  const [transport, setTransport] = useState("ws-alt");
  const [config, setConfig] = useState<any>(null);
  const [search, setSearch] = useState("");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  async function call(route = "", body?: unknown, method?: string) {
    const r = await fetch("/api/v1/admin/ssh" + route, {
      method: method || (body ? "POST" : "GET"),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const v = await r.json().catch(() => ({}));
      throw new Error(v.error || "Opération SSH refusée.");
    }
    return r.status === 204 ? null : r.json();
  }
  async function refresh() {
    setState(await call());
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(
      () => void refresh().catch((e) => setError(e.message)),
      5000,
    );
    return () => clearInterval(timer);
  }, []);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `abess-ssh-${config.username}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const selectedAccount = state?.accounts.find((a: any) => a.id === selected);
  return (
    <section className="space-y-6" aria-label="Comptes SSH">
      <div className="rounded-2xl border border-emerald-500/20 bg-slate-900/60 p-6 flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex gap-2 items-center">
            <Terminal className="text-emerald-400" />
            Comptes et tunnels SSH
          </h2>

        </div>
        <span className={state?.ready ? "text-emerald-400" : "text-amber-400"}>
          {state?.ready
            ? "● Suivi connecté"
            : "● Sans suivi distant"}
        </span>
        <button
          onClick={() => void action(refresh)}
          disabled={busy}
          className="flex gap-2 items-center"
        >
          <RefreshCw size={16} />
          Actualiser
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-950/40 text-red-300 p-4">
          {error}
        </p>
      )}
      {isAdmin && <form
        className="rounded-2xl border border-slate-700 p-5 grid sm:grid-cols-2 lg:grid-cols-6 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            const a = await call("/accounts", {
              config: importJson.trim() ? JSON.parse(importJson) : {host:host.trim(),
                transport:mode,port,username,password,fingerprint,payload:['tcp','ws','ws-alt','wss-raw','wss-raw-alt'].includes(mode)?payload||undefined:undefined,path,tls:mode.startsWith('wss'),sni},
              resellerId: resellerId || undefined,
              nodeId:nodeId||undefined,
              label,
              days,
              quotaGb,
              maxConnections: connections,
            });
            setSelected(a.id);
            setTransport(a.connection?.transport || "tcp");
            setImportJson(""); setPassword(""); setPayload("");
            setLabel("");
            setConfig(null);
          });
        }}
      >
        <label className="text-sm">
          Serveur
          <select aria-label="Serveur SSH" value={nodeId} onChange={e => {setNodeId(e.target.value);setHost(state?.nodes.find((n:any)=>n.id===e.target.value)?.host||'');}} className="w-full bg-slate-950 p-2">
            <option value="">—</option>
            {state?.nodes?.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Hôte<input aria-label="Hôte SSH" value={host} onChange={e=>{setHost(e.target.value);setNodeId('');}} className="w-full bg-slate-950 p-2" /></label>
        <label className="text-sm">Revendeur
          <select aria-label="Revendeur SSH" value={resellerId} onChange={e=>setResellerId(e.target.value)} className="w-full bg-slate-950 p-2">
            <option value="">—</option>{state?.resellers?.map((r:any)=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Mode
          <select aria-label="Mode SSH" value={mode} onChange={e=>setMode(e.target.value)} className="w-full bg-slate-950 p-2">
            {['tcp','ws','ws-alt','ws-framed','wss-raw','wss-raw-alt','wss','wss-alt'].map(m=><option key={m} value={m}>{m.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="text-sm">Port<input aria-label="Port SSH" type="number" min={1} max={65535} value={port} onChange={e=>setPort(Number(e.target.value))} className="w-full bg-slate-950 p-2" /></label>
        <label className="text-sm">Utilisateur<input aria-label="Utilisateur SSH" value={username} onChange={e=>setUsername(e.target.value)} className="w-full bg-slate-950 p-2" /></label>
        <label className="text-sm">Mot de passe<input aria-label="Mot de passe SSH" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full bg-slate-950 p-2" /></label>
        <label className="text-sm">Empreinte SHA-256<input aria-label="Empreinte SSH" value={fingerprint} onChange={e=>setFingerprint(e.target.value)} className="w-full bg-slate-950 p-2" /></label>
        <label className="text-sm">Chemin<input aria-label="Chemin SSH" value={path} onChange={e=>setPath(e.target.value)} className="w-full bg-slate-950 p-2" /></label>
        <label className="text-sm">SNI<input aria-label="SNI SSH" value={sni} onChange={e=>setSni(e.target.value)} className="w-full bg-slate-950 p-2" /></label>
        {['tcp','ws','ws-alt','wss-raw','wss-raw-alt'].includes(mode) && <label className="text-sm sm:col-span-2">Payload<textarea aria-label="Payload SSH" value={payload} onChange={e=>setPayload(e.target.value)} className="w-full bg-slate-950 p-2" /></label>}
        <label className="text-sm">
          Configuration JSON
          <textarea aria-label="Configuration SSH JSON" value={importJson} onChange={e => setImportJson(e.target.value)} className="w-full bg-slate-950 p-2" />
        </label>
        <label className="text-sm">
          Nom du client
          <input
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg p-2"
          />
        </label>
        <label className="text-sm">
          Durée (jours)
          <input
            type="number"
            min={1}
            max={366}
            required
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg p-2"
          />
        </label>
        <label className="text-sm">
          Quota (Go)
          <input
            type="number"
            min={0.01}
            max={100000}
            step={0.01}
            required
            value={quotaGb}
            onChange={(e) => setQuota(Number(e.target.value))}
            className="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg p-2"
          />
        </label>
        <label className="text-sm">
          Connexions simultanées
          <input
            type="number"
            min={1}
            max={10}
            required
            value={connections}
            onChange={(e) => setConnections(Number(e.target.value))}
            className="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg p-2"
          />
        </label>
        <button
          disabled={busy || (!importJson && (!host.trim() || !username || !password || !fingerprint))}
          className="self-end bg-emerald-500 text-slate-950 font-bold rounded-lg p-2 disabled:opacity-40"
        >
          Importer le compte
        </button>
      </form>}
      {renewId && <RenewLicence id={renewId} token={token} endpoint={`/api/v1/admin/ssh/accounts/${renewId}/renew`} onClose={()=>setRenewId(null)} onSuccess={()=>void refresh()} />}
      <div className="rounded-2xl border border-slate-700 p-5 space-y-4">
        <input
          type="search"
          aria-label="Rechercher un compte SSH"
          placeholder="Rechercher un utilisateur ou un client…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-slate-950 rounded-lg border border-slate-700 p-3"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-slate-400">
              <tr>
                {[
                  "Utilisateur",
                  "État",
                  "Trafic / quota",
                  "En ligne",
                  "Expiration",
                  "Actions",
                ].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state?.accounts
                .filter((a: any) =>
                  `${a.username} ${a.label}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((a: any) => (
                  <tr key={a.id} className="border-t border-slate-800">
                    <td className="p-3">
                      <strong>{a.username}</strong>
                      <div className="text-slate-400">{a.label}</div>
                    </td>
                    <td className="p-3">
                      {!a.enabled
                        ? "Suspendu"
                        : Date.parse(a.expiresAt) <= Date.now()
                          ? "Expiré"
                          : a.usedBytes >= a.quotaBytes
                            ? "Quota épuisé"
                            : a.trafficVerified ? "Actif" : "Importé"}
                    </td>
                    <td className="p-3">
                      {a.trafficVerified ? (a.usedBytes / 1024 ** 3).toFixed(3) : "—"} /{" "}
                      {(a.quotaBytes / 1024 ** 3).toFixed(2)} Go
                    </td>
                    <td className="p-3">
                      {a.online ?? "—"} / {a.maxConnections}
                    </td>
                    <td className="p-3">
                      {new Date(a.expiresAt).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="p-3 flex flex-wrap gap-3">
                      <button
                        onClick={() => {
                          setSelected(a.id);
            setTransport(a.connection?.transport || "tcp");
                          setConfig(null);
                        }}
                      >
                        Configurer
                      </button>
                      <button disabled={busy || !a.enabled} onClick={()=>setRenewId(a.id)}>Renouveler</button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await call(
                              "/accounts/" + a.id,
                              { enabled: !a.enabled },
                              "PATCH",
                            );
                            setConfig(null);
                          })
                        }
                      >
                        {a.enabled ? "Suspendre" : "Réactiver"}
                      </button>
                      {isAdmin && <button
                        aria-label={"Supprimer " + a.username}
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "Supprimer ce compte du panneau ?",
                            )
                          )
                            void action(async () => {
                              await call(
                                "/accounts/" + a.id,
                                undefined,
                                "DELETE",
                              );
                              setConfig(null);
                              setSelected("");
                            });
                        }}
                      >
                        <Trash2 size={16} />
                      </button>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {state?.accounts.length === 0 && (
          <p className="text-slate-400 p-4 text-center">
            Aucun compte SSH.
          </p>
        )}
      </div>
      <div className="rounded-2xl border border-slate-700 p-6 grid lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="font-bold">Générateur de configuration SSH</h3>
          <label className="block text-sm">
            Compte
            <select
              aria-label="Compte à configurer"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                const account = state?.accounts.find((a: any) => a.id === e.target.value);
                if (account?.connection) setTransport(account.connection.transport);
                setConfig(null);
              }}
              className="mt-2 w-full bg-slate-950 border border-slate-700 rounded-lg p-3"
            >
              <option value="">Choisir un compte</option>
              {state?.accounts.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Transport
            <select
              aria-label="Transport SSH"
              value={transport}
              onChange={(e) => {
                setTransport(e.target.value);
                setConfig(null);
              }}
              className="mt-2 w-full bg-slate-950 border border-slate-700 rounded-lg p-3"
            >
              {['tcp', 'ws', 'ws-alt', 'ws-framed', 'wss-raw', 'wss-raw-alt', 'wss', 'wss-alt']
                .filter(mode => !selectedAccount?.connection || selectedAccount.connection.transport === mode)
                .map(mode => <option key={mode} value={mode}>{mode.toUpperCase()}{selectedAccount?.connection?.hasPayload ? ' + PAYLOAD' : ''}{selectedAccount?.connection ? ` · ${selectedAccount.connection.port}` : ''}</option>)}
            </select>
          </label>
          <p className="text-sm text-slate-400">{selectedAccount?.connection?.host || '…'} · {selectedAccount?.connection?.path || '—'}</p>
          <button
            disabled={busy || !selected}
            onClick={() =>
              void action(async () =>
                setConfig(
                  await call("/accounts/" + selected + "/config", {
                    transport,
                  }),
                ),
              )
            }
            className="rounded-lg bg-emerald-500 text-slate-950 p-3 font-bold disabled:opacity-40"
          >
            Afficher les paramètres et identifiants
          </button>
          <p className="text-xs text-amber-300">
            L’export contient un mot de passe. Partagez-le uniquement avec le
            client concerné. Ce fichier JSON décrit les paramètres ; ce n’est
            pas un fichier propriétaire .hc/.ehi.
          </p>
        </div>
        <div className="min-w-0 space-y-3">
          {config ? (
            <>
              <pre className="whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-4 text-xs max-h-96 overflow-auto">
                {JSON.stringify(config, null, 2)}
              </pre>
              <div className="flex gap-4">
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(JSON.stringify(config, null, 2))
                      .catch(() =>
                        setError(
                          "Copie indisponible. Utilisez le téléchargement.",
                        ),
                      )
                  }
                  className="flex gap-2 items-center"
                >
                  <Copy size={16} />
                  Copier
                </button>
                <button onClick={download} className="flex gap-2 items-center">
                  <Download size={16} />
                  Télécharger
                </button>
                <button onClick={() => setConfig(null)}>Masquer</button>
              </div>
            </>
          ) : (
            <p className="text-slate-500 p-6">
              Sélectionnez un compte et un transport pour générer ses paramètres
              de connexion.
            </p>
          )}
          {state?.fingerprint && (
            <p className="text-xs break-all text-slate-400">
              Empreinte de la clé SSH : {state.fingerprint}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
