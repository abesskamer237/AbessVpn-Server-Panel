import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

export function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw Error('HTTPS origin required');
  return url;
}
export async function readSnapshot(env = process.env, request = fetch) {
  if (env.STATS_API_URL) {
    const url = new URL(env.STATS_API_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('HTTPS stats API required');
    const token = env.STATS_API_TOKEN_FILE ? (await fs.readFile(env.STATS_API_TOKEN_FILE, 'utf8')).trim() : '';
    const response = await request(url, {headers: token ? {Authorization: `Bearer ${token}`} : {},
      redirect: 'error', signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw Error('Stats API unavailable');
    return response.json();
  }
  if (!env.STATS_FILE) throw Error('STATS_FILE or STATS_API_URL required');
  return JSON.parse(await fs.readFile(env.STATS_FILE, 'utf8'));
}
export async function reportOnce(env = process.env, request = fetch) {
  const base = httpsOrigin(env.CONTROL_API_BASE_URL);
  if (!env.VPN_NODE_ID || !env.VPN_NODE_KEY) throw Error('Node credentials required');
  let snapshot;
  try {
    snapshot = await readSnapshot(env, request);
    const age = Date.now() - Date.parse(snapshot.observedAt);
    if (!snapshot.generation || !Array.isArray(snapshot.stat) || !Number.isFinite(age) || age < -5000 || age > 60000)
      throw Error('Stale or invalid stats');
  } catch { snapshot = undefined; }
  const response = await request(new URL(`/api/v1/nodes/${encodeURIComponent(env.VPN_NODE_ID)}/heartbeat`, base), {
    method: 'POST', headers: {Authorization: `Bearer ${env.VPN_NODE_KEY}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({ready: Boolean(snapshot), version: 'external-2', ...(snapshot ? {snapshot} : {})}),
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error('Heartbeat rejected');
}
async function main() {
  httpsOrigin(process.env.CONTROL_API_BASE_URL);
  if (!process.env.STATS_FILE && !process.env.STATS_API_URL) throw Error('STATS_FILE or STATS_API_URL required');
  let running = true;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { running = false; });
  while (running) {
    try { await reportOnce(); }
    catch { console.error('[NODE AGENT] Reporting unavailable.'); }
    if (running) await delay(5000);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {console.error('[NODE AGENT] Invalid configuration.'); process.exitCode = 1;});
}
