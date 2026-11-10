import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const base = new URL(process.env.CONTROL_API_BASE_URL || "");
if (
  base.protocol !== "https:" ||
  base.username ||
  base.password ||
  base.pathname !== "/" ||
  base.search ||
  base.hash
)
  throw new Error("HTTPS control-plane origin required");
const nodeId = process.env.VPN_NODE_ID;
const key = process.env.VPN_NODE_KEY;
if (!nodeId || !key) throw new Error("VPN_NODE_ID and VPN_NODE_KEY required");
const dir = process.env.SHARED_DIR || "/shared";
await fs.mkdir(dir, { recursive: true });
let running = true;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    running = false;
  });
async function call(route, body) {
  const response = await fetch(
    new URL(`/api/v1/nodes/${encodeURIComponent(nodeId)}/${route}`, base),
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok)
    throw new Error("Node authorization or control plane unavailable");
  return response.json();
}
let lastSuccess = Date.now();
while (running) {
  try {
    const config = await call("config");
    const serialized = JSON.stringify(config);
    const file = path.join(dir, "xray-config.json");
    const current = await fs.readFile(file, "utf8").catch(() => "");
    if (current !== serialized) {
      await fs.writeFile(file + ".agent.tmp", serialized, { mode: 0o640 });
      await fs.rename(file + ".agent.tmp", file);
    }
    const snapshot = JSON.parse(
      await fs
        .readFile(path.join(dir, "xray-stats.json"), "utf8")
        .catch(() => "null"),
    );
    const ready = Boolean(
      snapshot?.observedAt &&
      Date.now() - Date.parse(snapshot.observedAt) < 15000,
    );
    await call("heartbeat", {
      ready,
      version: "1",
      ...(snapshot ? { snapshot } : {}),
    });
    lastSuccess = Date.now();
    await fs.writeFile(
      path.join(dir, "xray-control-heartbeat"),
      JSON.stringify({ at: lastSuccess }),
      { mode: 0o640 },
    );
  } catch {
    console.error(
      "[NODE AGENT] Synchronization unavailable; no credentials logged.",
    );
  }
  if (Date.now() - lastSuccess > 60000)
    await fs.rm(path.join(dir, "xray-control-heartbeat"), { force: true });
  await delay(5000);
}
