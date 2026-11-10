# ABESS VPN — Control plane, administration and Xray-core

ABESS VPN combines a Node.js/Express control plane, a React administration panel, an official Xray-core data plane, and Caddy for public HTTPS. The Docker Compose deployment runs the API, Xray, and Caddy as separate services. Xray is not exposed directly to the public Internet; Caddy terminates TLS and proxies the configured WebSocket path to the internal VLESS inbound.

## Status and architecture

- **Control plane:** authentication, reseller accounts, per-licence UUIDs, encrypted `abess://` links, expiry, device limits, and licence administration.
- **Xray-core:** le control plane provisionne actuellement **VLESS uniquement**, avec WebSocket, gRPC, HTTPUpgrade, XHTTP et un profil direct TCP sur le port 10050. VMess, Trojan, Shadowsocks, WireGuard et mKCP ne sont pas provisionnés par cette version du serveur. Les mentions restantes dans certaines interfaces ou anciens profils ne constituent pas une prise en charge active.
- **Quota enforcement:** the API reads Xray's real user counters and disables a licence in Xray when it expires or exhausts its quota. Client-submitted byte counts are not treated as authoritative.
- **HTTPS:** Caddy obtient et renouvelle le certificat de `VPN_DOMAIN`. TLS termine sur TCP 443. Les profils VLESS WebSocket sont relayés vers le service Xray interne ; le profil VLESS direct TCP utilise le port 10050. Vérifiez les transports sur un véritable client Android avant de les commercialiser.
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

The repository includes `.github/workflows/deploy-vps.yml`. It validates the code, panel, Docker images, and Compose configuration before deploying over SSH. Deployment can be started manually from Actions, and pushes to `main` now trigger the same workflow. The workflow deliberately stops before modifying services if Docker/Compose cannot be used or if an unrelated service is listening on ports 80/443.

### 1. Prepare the VPS

Use Ubuntu 24.04 or 22.04, install Docker Engine and the Docker Compose plugin using Docker's official Ubuntu instructions, and verify `docker info` and `docker compose version` work for your deployment user. Install `rsync` and `openssh-server` as well.

The deployment SSH user must have permission to run Docker without an interactive sudo prompt. Docker group access is effectively root-equivalent, so use a dedicated deployment account if possible. The workflow supports either a dedicated SSH key (`VPS_SSH_KEY`) or password authentication (`VPS_SSH_PASSWORD` or `VPS_PASSWORD`) stored as a GitHub Actions secret; a key is preferable, but is not mandatory. Never put the VPS password in the repository or in chat. Do not remove existing containers or Docker volumes as part of the setup.

Ensure incoming TCP ports **80 and 443** are available for Caddy and allowed through the VPS/provider firewall. For the current VLESS direct-TCP profile, also allow **TCP 10050**. No UDP listener is provisioned by this release. Port 22 (or your custom SSH port) must be reachable from GitHub-hosted runners. If an existing Nginx, Caddy, x-ui, or other service already owns 80/443, this workflow intentionally aborts; move that service to another port or arrange an explicit reverse-proxy integration before deploying.

### 2. Point your domain to the VPS

Create an `A` record for a dedicated hostname such as `vpn.example.com` pointing to the public IPv4 address of the VPS. If you have an `AAAA` record, ensure it points to a working public IPv6 address or remove the incorrect record. For the initial certificate issuance, avoid a DNS proxy mode that prevents public access to the required ports. Caddy needs public reachability on 80 and 443.

### 3. Configure GitHub Actions secrets and variables

Important: `VPN_DOMAIN` is the public hostname used by Caddy and the API; it is **not** copied automatically into the VPN profile Host or SNI. After the first deployment, sign in to the Super Admin panel and configure the selected protocol's **public host** and **TLS SNI** in the infrastructure tab before issuing licences. With the current single-site Caddy configuration, the profile host must normally be the same hostname as `VPN_DOMAIN`, and DNS must point to this VPS; the SNI must be covered by the certificate Caddy serves. If you need a different public hostname, configure its DNS and add it to Caddy's site/certificate configuration too. The VPN profile Host and SNI start empty and are not populated from any demo or development address; set them explicitly in the infrastructure panel.

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

## Protocoles provisionnés

Le control plane actuel provisionne **VLESS uniquement**. Les transports gérés par les profils serveur sont WebSocket, gRPC, HTTPUpgrade, XHTTP et TCP direct. Le chemin historique `/@abess237` reste utilisé pour VLESS + WS. Le profil TCP direct utilise le port TCP 10050.

VMess, Trojan, Shadowsocks, WireGuard, mKCP/UDP et TUN ne sont pas provisionnés par cette version du serveur, même si certains parseurs/importeurs Android ou anciens fichiers du dépôt peuvent reconnaître ces formats. Ne crée pas de licences commerciales pour ces protocoles depuis le panneau.

**SSH :** les anciennes licences SSH sont conservées pour consultation si leurs paramètres existent, mais l'émission de nouvelles licences SSH et la création de comptes Linux sont suspendues. Le déploiement Docker ne provisionne pas de comptes SSH sur l'hôte et aucun mot de passe SSH n'est écrit dans `/etc/ssh/vpn_users.db`. Pour réactiver SSH, il faudra concevoir un provisionneur hôte dédié, authentifié et isolé du conteneur API.

La validation d'une configuration Xray par CI ne remplace pas un test de connexion réel depuis Android.

## Gestion commerciale à distance via Bot Telegram

Le serveur intègre un bot Telegram complet pour administrer, superviser et commercialiser votre infrastructure VPN en direct depuis votre smartphone :

### Configuration
Ajoutez ces variables dans votre fichier `.env` sur le serveur :
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_ADMIN_IDS=123456789,987654321
```
Seuls les identifiants listés dans `TELEGRAM_ADMIN_IDS` sont autorisés. La commande `/login` par mot de passe partagé est désactivée. Ajoutez explicitement les identifiants Telegram autorisés dans l'environnement du serveur, puis redémarrez le conteneur API.

### Fonctionnalités du Bot
- 📊 **Tableau de bord en direct (`/stats`) :** Uptime, CPU, RAM, statut Xray, clients actifs, bande passante consommée vs allouée.
- 🎟️ **Création de Vouchers / Tickets (`/create`) :** Packs rapides (Test 24h, Semaine 10 Go, Mensuel VIP 50 Go, Illimité 150 Go) avec génération et envoi immédiat du QR Code image, du lien `abess://` et du lien V2Ray universel.
- 📦 **Génération de Lots (Batch / Grossiste) (`/batch`) :** Création instantanée de 5 à 200 vouchers avec export automatique d'un fichier CSV prêt à être distribué aux revendeurs ou imprimé.
- 👥 **Gestion du Parc Clients (`/search`, `/reset`) :** Consultation paginée des fiches clients, ajout de quota (+10 Go), prolongation (+7j, +30j), suspension et réinitialisation en 1 clic des appareils liés (Unbind HWID).
- ⚙️ **Supervision Xray (`/xray`, `/reload`) :** Contrôle et rechargement de la configuration VLESS provisionnée par le serveur.
- 💾 **Sauvegarde Système 1-Clic (`/backup`) :** Téléchargement instantané d'une archive JSON complète de la base de données directement dans la conversation Telegram.
- ⚠️ **Alertes Automatiques Proactives :** Notification immédiate des administrateurs dès qu'un utilisateur atteint 90% ou 100% de son quota, ou arrive à expiration.
