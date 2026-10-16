# ABESS VPN — Control plane, administration and Xray-core

ABESS VPN combines a Node.js/Express control plane, a React administration panel, an official Xray-core data plane, and Caddy for public HTTPS. The Docker Compose deployment runs the API, Xray, and Caddy as separate services. Xray is not exposed directly to the public Internet; Caddy terminates TLS and proxies the configured WebSocket path to the internal VLESS inbound.

## Status and architecture

- **Control plane:** authentication, reseller accounts, per-licence UUIDs, encrypted `abess://` links, expiry, device limits, and licence administration.
- **Xray-core:** the API writes `data/xray-config.json` from active licences. Xray-core reads this generated configuration and accounts uplink/downlink traffic for each VLESS user.
- **Quota enforcement:** the API reads Xray's real user counters and disables a licence in Xray when it expires or exhausts its quota. Client-submitted byte counts are not treated as authoritative.
- **HTTPS:** Caddy automatically obtains and renews the certificate for `VPN_DOMAIN`. The public VLESS path is `/@abess237`; TLS is terminated at Caddy and the private Caddy-to-Xray hop uses WebSocket on the internal Docker network.
- **No sample production credentials:** the first boot requires an administrator email/password in environment variables. The admin password is stored with scrypt hashing. The master encryption secret must remain stable or previously issued encrypted links can no longer be decrypted.

The health route `GET /api/v1/ping` only reports `dataPlane: "ready"` after the Xray sidecar has started and answered its local stats API. The watcher validates every generated configuration before replacing the active Xray process.

## Local development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run lint
npm run build
npm run dev
```

The local API listens on port 3000 by default. In non-production mode Vite serves the admin panel. To start with an isolated, disposable store you must still provide `VPN_DOMAIN`, `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD` (at least 16 characters), and `MASTER_SECRET` (at least 32 random characters). The production Docker deployment additionally requires DNS and public ports 80 and 443.

## Deploy to an Ubuntu VPS using GitHub Actions

The repository includes `.github/workflows/deploy-vps.yml`. It first type-checks and builds the panel, builds both Docker images, checks the Compose configuration, and then performs an SSH deployment. The workflow deliberately stops before modifying services if Docker/Compose cannot be used or if an unrelated service is listening on ports 80/443.

### 1. Prepare the VPS

Use Ubuntu 24.04 or 22.04, install Docker Engine and the Docker Compose plugin using Docker's official Ubuntu instructions, and verify `docker info` and `docker compose version` work for your deployment user. Install `rsync` and `openssh-server` as well.

The deployment SSH user must have permission to run Docker without an interactive sudo prompt. Docker group access is effectively root-equivalent; use a dedicated deployment account and a dedicated SSH key. Do not remove existing containers or Docker volumes as part of the setup.

Ensure incoming TCP ports **80 and 443** are available for Caddy and are allowed through the VPS/provider firewall. Port 22 (or your custom SSH port) must be reachable from GitHub-hosted runners. If an existing Nginx, Caddy, x-ui, or other service already owns 80/443, this workflow intentionally aborts; move that service to another port or arrange an explicit reverse-proxy integration before deploying.

### 2. Point your domain to the VPS

Create an `A` record for a dedicated hostname such as `vpn.example.com` pointing to the public IPv4 address of the VPS. If you have an `AAAA` record, ensure it points to a working public IPv6 address or remove the incorrect record. For the initial certificate issuance, avoid a DNS proxy mode that prevents public access to the required ports. Caddy needs public reachability on 80 and 443.

### 3. Configure GitHub Actions secrets and variables

Open **Settings → Secrets and variables → Actions** in this repository.

Create these **repository secrets**:

| Secret | Value |
| --- | --- |
| `VPS_HOST` | VPS public IPv4 or SSH hostname |
| `VPS_USER` | Dedicated SSH deployment username |
| `VPS_SSH_KEY` | Private half of a dedicated SSH key; paste the full multiline private key here only |
| `VPS_KNOWN_HOSTS` | Verified SSH host-key line for the VPS (not an unchecked fingerprint) |
| `ADMIN_INITIAL_PASSWORD` | New strong administrator password, 16+ characters |
| `MASTER_SECRET` | Random stable secret, 32+ characters |

Create these **repository variables**:

| Variable | Value |
| --- | --- |
| `VPN_DOMAIN` | Dedicated domain only, for example `vpn.example.com`; no scheme, port or path |
| `ADMIN_EMAIL` | Initial administrator's email |
| `ACME_EMAIL` | Email used for HTTPS certificate notifications; may match the admin email |
| `ADMIN_NAME` | Optional administrator display name |
| `VPS_PORT` | Optional SSH port; defaults to `22` |

Generate secrets locally; do not paste them into a chat, source code, workflow file, or commit. For example, `openssl rand -hex 32` can generate a 32-byte random master secret. Generate a dedicated Ed25519 SSH key, add its **public** key to the deployment account's `~/.ssh/authorized_keys`, and store the **private** key in `VPS_SSH_KEY`. Obtain the host-key line with `ssh-keyscan`, verify the fingerprint against the VPS/provider through a trusted channel, then store the verified line in `VPS_KNOWN_HOSTS`.

The administrator password is used only when the persistent user store is first created; changing the GitHub secret later does not reset the existing admin password. Keep `MASTER_SECRET` stable after issuing encrypted links—rotating it requires a planned migration of existing links.

**Also point the Android build at the same domain:** in the separate `abesskamer237/AbessVpn-Cyber` repository, add the repository variable `VPN_DOMAIN` with the same hostname. Its APK workflow compiles this value as `ABESS_API_BASE_URL=https://VPN_DOMAIN`. After setting the variable, run **Actions → Build APK Release (68MB Universal) → Run workflow** to produce an APK configured for the VPS. Without that variable, the APK keeps its legacy fallback API hosts.

### 4. Launch the deployment

1. Open the repository's **Actions** tab.
2. Select **Deploy ABESS VPN to VPS**.
3. Click **Run workflow** on `main`.
4. Wait for the validation and deploy jobs to finish.

On success, `https://VPN_DOMAIN/api/v1/ping` should return JSON with `"dataPlane":"ready"`. You can inspect the containers over SSH with:

```bash
cd ~/abessvpn-server
docker compose ps
docker compose logs --tail=100 api xray caddy
```

A successful container build is not by itself proof that Internet traffic traverses the VPN. After deployment, test from the Android app: import a newly generated licence, connect, verify that the device's public egress IP changes, browse several HTTPS sites, and check that Xray counters and the licence quota increase. Also verify expiration and quota exhaustion disconnect the client.

## API endpoints used by the mobile app

- `POST /api/v1/auth/token` — validate a licence, register the device, and return the per-licence VLESS UUID and endpoint.
- `POST /api/v1/auth/import-link` — decrypt a panel-issued `abess://` link server-side and validate it as a licence.
- `GET /api/v1/ping` — control-plane health and Xray readiness.
- `POST /api/v1/client/telemetry` — return authoritative Xray-accounted usage and licence status.
- `GET /api/v1/speedtest/download` and `POST /api/v1/speedtest/upload` — bounded HTTP throughput probes.

Licence issuance stays in the authenticated administration/reseller panel. Public mobile token creation is denied, and trial issuance remains disabled until the real data plane is ready.

## Official references

- Docker Engine installation for Ubuntu: https://docs.docker.com/engine/install/ubuntu/
- Xray-core VLESS inbound: https://xtls.github.io/en/config/inbounds/vless.html
- Xray-core WebSocket transport: https://xtls.github.io/en/config/transports/websocket.html
- Caddy automatic HTTPS: https://caddyserver.com/docs/automatic-https
