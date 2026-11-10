import { useEffect, useState } from "react";
import {
  Copy,
  Download,
  RefreshCw,
  Terminal,
  Trash2,
  ShieldCheck,
} from "lucide-react";
export function SshCenter({ token }: { token: string }) {
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  const [quotaGb, setQuota] = useState(10);
  const [connections, setConnections] = useState(1);
  const [selected, setSelected] = useState("");
  const [transport, setTransport] = useState("wss-raw");
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
  return (
    <section className="space-y-6" aria-label="Comptes SSH">
      <div className="rounded-2xl border border-emerald-500/20 bg-slate-900/60 p-6 flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex gap-2 items-center">
            <Terminal className="text-emerald-400" />
            Comptes et tunnels SSH
          </h2>
          <p className="text-sm text-slate-400 mt-2">
            SSH TCP · SSH-WS HTTP Upgrade · WS avec TLS · quotas et expiration
            contrôlés par la passerelle dédiée.
          </p>
        </div>
        <span className={state?.ready ? "text-emerald-400" : "text-amber-400"}>
          {state?.ready
            ? "● Passerelle opérationnelle"
            : "● Passerelle indisponible"}
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
      <form
        className="rounded-2xl border border-slate-700 p-5 grid sm:grid-cols-2 lg:grid-cols-6 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            const a = await call("/accounts", {
              username,
              label,
              days,
              quotaGb,
              maxConnections: connections,
            });
            setSelected(a.id);
            setUsername("");
            setLabel("");
            setConfig(null);
          });
        }}
      >
        <label className="text-sm">
          Utilisateur
          <input
            aria-label="Utilisateur SSH"
            required
            pattern="[a-z][a-z0-9_-]{2,31}"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg p-2"
          />
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
          disabled={busy || !state?.ready}
          className="self-end bg-emerald-500 text-slate-950 font-bold rounded-lg p-2 disabled:opacity-40"
        >
          Créer le compte
        </button>
      </form>
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
                            : "Actif"}
                    </td>
                    <td className="p-3">
                      {(a.usedBytes / 1e9).toFixed(3)} /{" "}
                      {(a.quotaBytes / 1e9).toFixed(2)} Go
                    </td>
                    <td className="p-3">
                      {a.online} / {a.maxConnections}
                    </td>
                    <td className="p-3">
                      {new Date(a.expiresAt).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="p-3 flex flex-wrap gap-3">
                      <button
                        onClick={() => {
                          setSelected(a.id);
                          setConfig(null);
                        }}
                      >
                        Configurer
                      </button>
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
                      <button
                        aria-label={"Supprimer " + a.username}
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "Supprimer ce compte et couper ses tunnels SSH ?",
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
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {state?.accounts.length === 0 && (
          <p className="text-slate-400 p-4 text-center">
            Aucun compte SSH. Créez votre premier client ci-dessus.
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
              <option value="ws">SSH-WS · HTTP Upgrade brut — 80</option>
              <option value="ws-alt">
                SSH-WS · HTTP Upgrade brut — {state?.ports.wsAlt || 85}
              </option>
              <option value="wss-raw">
                SSH-WS + TLS · HTTP Upgrade brut — 443
              </option>
              <option value="wss-raw-alt">
                SSH-WS + TLS · HTTP Upgrade brut — 2084
              </option>
              <option value="wss-alt">WebSocket standard + TLS — 2084</option>
              <option value="wss">WebSocket standard + TLS — 443</option>
              <option value="tcp">
                SSH direct TCP — {state?.ports.tcp || 2222}
              </option>
            </select>
          </label>
          <p className="text-sm text-slate-400">
            TLS 443 est recommandé. Les modes HTTP nécessitent un accès direct
            sans redirection HTTPS du domaine ou du CDN.
          </p>
          <p className="text-sm text-slate-400">
            Serveur :{" "}
            {(transport === "tcp" ||
            transport === "ws" ||
            transport === "ws-alt"
              ? state?.wsHost
              : state?.host) || "…"}{" "}
            · chemin : /ws-ssh · SNI TLS : nom du serveur. Vérification du
            certificat obligatoire. SSH TCP reste chiffré par SSH.
          </p>
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
          <p className="text-xs text-slate-400 flex gap-2">
            <ShieldCheck className="shrink-0" size={16} />
            Passerelle indépendante du SSH administrateur. Aucun shell système
            ni accès au réseau privé. TCP uniquement : UDP, SlowDNS, serveur
            Dropbear ne sont pas inclus. Import direct dans ABESS VPN 2.5.0 ou
            supérieur.
          </p>
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
