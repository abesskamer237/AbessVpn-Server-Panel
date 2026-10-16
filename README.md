# ABESS VPN — Control plane, administration and Xray-core

ABESS VPN combines a Node.js/Express control plane, a React administration panel, an official Xray-core data plane, and Caddy for public HTTPS. The Docker Compose deployment runs the API, Xray, and Caddy as separate services. Xray is not exposed directly to the public Internet; Caddy terminates TLS and proxies the configured WebSocket path to the internal VLESS inbound.

## Status and architecture

- **Control plane:** authentication, reseller accounts, per-licence UUIDs, encrypted `abess://` links, expiry, device limits, and licence administration.
- **Xray-core:** the API writes `data/xray-config.json` from active licences. VLESS, VMess and Trojan support WebSocket, gRPC, HTTPUpgrade and XHTTP through HTTPS/TCP 443. VMess additionally supports direct RAW/TCP (port 10060) and mKCP/UDP (port 10061). Shadowsocks AEAD uses its native TCP+UDP listener on port 10050 so UDP is not accidentally routed through the HTTP-only reverse proxy. RAW/mKCP are restricted to VMess to avoid exposing VLESS without transport encryption or Trojan without TLS.
- **Quota enforcement:** the API reads Xray's real user counters and disables a licence in Xray when it expires or exhausts its quota. Client-submitted byte counts are not treated as authoritative.
- **HTTPS:** Caddy automatically obtains and renews the certificate for `VPN_DOMAIN`. TLS terminates at Caddy on TCP 443; path routes forward supported profile traffic to private Xray inbounds. Native Shadowsocks TCP/UDP is separately published on port 10050. VMess RAW/TCP and mKCP/UDP are exposed on ports 10060/TCP and 10061/UDP respectively.
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

The deployment SSH user must have permission to run Docker without an interactive sudo prompt. Docker group access is effectively root-equivalent, so use a dedicated deployment account if possible. The workflow supports either a dedicated SSH key (`VPS_SSH_KEY`) or password authentication (`VPS_SSH_PASSWORD` or `VPS_PASSWORD`) stored as a GitHub Actions secret; a key is preferable, but is not mandatory. Never put the VPS password in the repository or in chat. Do not remove existing containers or Docker volumes as part of the setup.

Ensure incoming TCP ports **80 and 443** are available for Caddy and allowed through the VPS/provider firewall. To use every exposed transport, also allow **TCP 10050**, **UDP 10050**, **TCP 10060**, and **UDP 10061**. Port 22 (or your custom SSH port) must be reachable from GitHub-hosted runners. If an existing Nginx, Caddy, x-ui, or other service already owns 80/443, this workflow intentionally aborts; move that service to another port or arrange an explicit reverse-proxy integration before deploying.

### 2. Point your domain to the VPS

Create an `A` record for a dedicated hostname such as `vpn.example.com` pointing to the public IPv4 address of the VPS. If you have an `AAAA` record, ensure it points to a working public IPv6 address or remove the incorrect record. For the initial certificate issuance, avoid a DNS proxy mode that prevents public access to the required ports. Caddy needs public reachability on 80 and 443.

### 3. Configure GitHub Actions secrets and variables

Important: `VPN_DOMAIN` is the public hostname used by Caddy and the API; it is **not** copied automatically into the VPN profile Host or SNI. After the first deployment, sign in to the Super Admin panel and configure the selected protocol's **public host** and **TLS SNI** in the infrastructure tab before issuing licences. With the current single-site Caddy configuration, the profile host must normally be the same hostname as `VPN_DOMAIN`, and DNS must point to this VPS; the SNI must be covered by the certificate Caddy serves. If you need a different public hostname, configure its DNS and add it to Caddy's site/certificate configuration too. Old temporary development hosts are cleared from the saved master configuration and are not accepted.

Open **Settings → Secrets and variables → Actions** in this repository.

Create these **repository secrets**:

| Secret | Value |
| --- | --- |
| `VPS_HOST` | VPS public IPv4 or SSH hostname |
| `VPS_USER` | Dedicated SSH deployment username |
| `VPS_SSH_KEY` | Optional; recommended private half of a dedicated SSH key |
| `VPS_PASSWORD` or `VPS_SSH_PASSWORD` | Password for the SSH deployment user; either name is accepted |
| `VPS_KNOWN_HOSTS` | Optional but recommended: verified SSH host-key line for the VPS (not an unchecked fingerprint) |
| `ADMIN_INITIAL_PASSWORD` | Optional. If omitted, the workflow generates a strong password and places it in a protected credentials file on the VPS after first deployment. |
| `MASTER_SECRET` | Optional. If omitted, the workflow generates a random 32-byte secret and stores it in the VPS `.env` file. |

Create these **repository variables**:

| Variable | Value |
| --- | --- |
| `VPN_DOMAIN` | Dedicated domain only, for example `vpn.example.com`; no scheme, port or path |
| `ADMIN_EMAIL` | Initial administrator's email |
| `ACME_EMAIL` | Email used for HTTPS certificate notifications; may match the admin email |
| `ADMIN_NAME` | Optional administrator display name |
| `VPS_PORT` | Optional SSH port; defaults to `22` |

Do not paste secrets into chat, source code, workflow files, or commits. For password-based VPS access, save your existing SSH login password as the GitHub secret `VPS_PASSWORD` or `VPS_SSH_PASSWORD`; the workflow already supports this, so an SSH key is not mandatory (a dedicated Ed25519 key is safer). If `VPS_KNOWN_HOSTS` is absent, the workflow discovers the SSH host key using `ssh-keyscan`; for stronger first-connection protection, verify its fingerprint through the Contabo console/provider support and set `VPS_KNOWN_HOSTS`.

The `ADMIN_INITIAL_PASSWORD` and `MASTER_SECRET` secrets are optional. If they are absent, the workflow generates them with cryptographically secure randomness. On a **first deployment**, the generated administrator email/password is saved in `~/abessvpn-server/INITIAL_ADMIN_CREDENTIALS.txt` on the VPS with owner-only permissions; after the successful deployment, connect to the VPS and read that file, then save the password in a password manager and delete the file. The generated master secret is saved in `~/abessvpn-server/.env` with mode `600`. The workflow preserves both values across later deployments, so existing accounts and encrypted `abess://` links continue to work. Back up `.env` securely and do not rotate `MASTER_SECRET` after links have been issued. Changing `ADMIN_INITIAL_PASSWORD` later does not reset an administrator already stored in the persistent user database.

**Configure the Android build too:** in `abesskamer237/AbessVpn-Cyber`, add the repository variable `VPN_DOMAIN` with the same control-plane hostname (for example `panneau.pagnol.xyz`). The build compiles `ABESS_API_BASE_URL=https://VPN_DOMAIN`; if the variable is missing, the workflow stops instead of using obsolete demo hosts. Then run **Actions → Build APK Release (68MB Universal) → Run workflow** to build an APK bound to this server.

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

## Multi-protocol Xray profiles

The panel supports **VLESS, VMess, Trojan and Shadowsocks AEAD** with **WebSocket, gRPC, HTTPUpgrade and XHTTP** transports. Caddy terminates TLS on public TCP 443 and routes each HTTP-based profile to a private Xray inbound.

**Native TCP/UDP:** Shadowsocks also has a dedicated listener on port `10050` for both TCP and UDP. Permit TCP and UDP 10050 in the VPS/provider firewall when that profile is selected. This native mode does not use the public HTTPS certificate.

mKCP is enabled only for VMess on UDP 10061, and Shadowsocks uses its native TCP+UDP listener on port 10050. Hysteria/QUIC, WireGuard and TUN are not enabled in this release because they require their own protocol-specific configuration and client compatibility. Native UDP cannot be forwarded through the ordinary HTTP reverse proxy. The Android app's local SOCKS inbound has UDP enabled, which is separate from a native public UDP listener.

The legacy path `/@abess237` remains for VLESS + WS. Other HTTP-carried profiles use `/@abess237/<protocol>/<transport>`. A successful compile or Xray config validation does not replace a real Android connection test for every combination.
