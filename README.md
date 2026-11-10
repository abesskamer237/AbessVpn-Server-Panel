# ABESS VPN — panneau, licences et Xray

Control plane Node/Express, panneau React et data plane officiel Xray-core, avec HTTPS Caddy. Le client Android Flutter est maintenu dans [AbessVpn-Cyber](https://github.com/abesskamer237/AbessVpn-Cyber).

## Fonctions

- Administrateurs et hiérarchie de revendeurs, crédits, licences, renouvellements idempotents et quotas comptabilisés par Xray.
- PostgreSQL transactionnel, migration initiale des fichiers JSON existants et historique d’audit chaîné.
- Double authentification TOTP, codes de récupération à usage unique, sessions révocables, changement de mot de passe et cookie de panneau HttpOnly.
- Règlements **manuels** MTN MoMo / Orange Money, déclaration de référence, vérification par un administrateur et factures après confirmation.
- Sauvegardes AES-GCM, copie S3 optionnelle, supervision et alertes.
- Agent de nœud distant avec isolation des licences, rapprochement des compteurs et arrêt du moteur après perte prolongée du contrôle.

Les transports commercialisés sont **VLESS avec TLS** : WebSocket, gRPC, HTTPUpgrade et XHTTP. VMess, Trojan, Shadowsocks, WireGuard, SSH et mKCP ne sont pas provisionnés. VLESS/TCP sans TLS est désactivé par défaut ; TCP/10050 n’est pas exposé par le Compose sécurisé.

## Développement

Node.js 22.21+ et npm. Utiliser une base PostgreSQL jetable pour les tests de stockage.

```sh
npm ci
npm run lint
npm run build
npm run build:server
node scripts/test-security.mjs
node --import tsx scripts/test-platform.mjs
# TEST_DATABASE_URL doit désigner une base de test où créer/supprimer un schéma isolé.
node --import tsx scripts/test-postgres.mjs
npx playwright install chromium
npm run test:panel
# Docker : trafic VLESS réel dans un réseau de benchmark local isolé.
python3 scripts/test-xray-traffic.py
```

Pour démarrer : renseigner `VPN_DOMAIN`, `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD` (16 caractères minimum), `MASTER_SECRET` (32 caractères aléatoires minimum), `DATABASE_URL` et un `DATA_DIR` isolé, puis `npm run dev`. Ne pas réutiliser les données ou secrets de production dans les tests. Le mode JSON est réservé au développement ; en production, PostgreSQL est requis.

## Déploiement VPS

Ubuntu 22.04/24.04, Docker Engine et Compose, rsync, SSH et DNS public valide. Les ports TCP 80/443 doivent être disponibles pour Caddy ; le workflow refuse les conflits avec un service étranger. Ne pas supprimer les volumes existants.

Configurer dans GitHub Actions :

| Paramètre | Emplacement | Usage |
| --- | --- | --- |
| `VPS_HOST`, `VPS_USER` | Secrets | Destination SSH |
| `VPS_SSH_KEY` ou `VPS_PASSWORD`/`VPS_SSH_PASSWORD` | Secrets | Authentification SSH |
| `VPS_KNOWN_HOSTS` | Secret requis | Clé d’hôte SSH vérifiée |
| `VPN_DOMAIN`, `ADMIN_EMAIL`, `ACME_EMAIL` | Variables | Domaine public et administration |
| `ADMIN_INITIAL_PASSWORD`, `MASTER_SECRET` | Secrets optionnels | Générés lors du premier déploiement si absents, puis préservés |
| `ADMIN_NAME`, `VPS_PORT` | Variables optionnelles | Nom et port SSH |

Le workflow `Deploy ABESS VPN to VPS` valide puis déploie sur `main`. Les identifiants initiaux générés sont conservés dans `~/abessvpn-server/INITIAL_ADMIN_CREDENTIALS.txt`, mode 600 ; les enregistrer dans un gestionnaire sécurisé puis retirer ce fichier. Le `.env` du VPS conserve les clés et mots de passe PostgreSQL stables. Les options S3, MFA et alertes saisies sur le VPS sont préservées lors des déploiements suivants.

Le domaine du control plane ne remplit pas automatiquement les profils commerciaux. Configurer explicitement l’hôte public et le SNI corrects dans Infrastructure avant émission. Le SNI doit correspondre au domaine Caddy du contrôleur ou à celui d’un nœud enregistré.

Après déploiement, vérifier `/api/v1/ping`, les pages Sécurité/Exploitation et une connexion Android réelle. Un build réussi ou un ping prêt ne prouve pas, à lui seul, l’absence de fuite DNS/IPv6 ni un tunnel utilisable sur téléphone.

## Documentation opérationnelle

- [Exploitation, migration, restauration et nœuds distants](docs/OPERATIONS.md)
- [Procédure de règlement manuel](docs/MANUAL_PAYMENTS.md)
- [Audit et limites de validation](AUDIT.md)
- [Environnement cloud et certificats du proxy](docs/CLOUD_ENVIRONMENT.md)

La clé maître doit rester stable : une rotation nécessite une migration des liens, des secrets MFA et de l’audit PostgreSQL. Le script historique de rotation JSON ne doit pas être utilisé pour une installation PostgreSQL.

## Endpoints principaux

- `GET /api/v1/ping` : disponibilité du control plane et heartbeat Xray local.
- `POST /api/v1/auth/login`, `/logout`, `/password` : accès et sessions.
- `/api/v1/auth/security`, `/mfa/setup`, `/mfa/enable`, `/mfa/disable`, `/sessions/:id` : sécurité du compte.
- `POST /api/v1/auth/token`, `/auth/import-link` : licences mobiles ; la création commerciale demeure authentifiée dans le panneau.
- `POST /api/v1/client/availability`, `/client/telemetry` : disponibilité du nœud affecté et quotas autoritaires.
- `/api/v1/admin/tokens/:id/renew`, `/migrate-tls` : renouvellement et migration vers TLS.
- `/api/v1/payments/instructions` : numéros et bénéficiaires du règlement manuel.
- `/api/v1/commerce/orders`, `/orders/:id/submit`, `/confirm`, `/reject`, `/invoice` : demandes, vérification manuelle et factures. Aucune passerelle de paiement automatique.
- `/api/v1/admin/operations`, `/operations/backup`, `/operations/restore`, `/metrics` : exploitation protégée.
- `/api/v1/admin/nodes` et `/api/v1/nodes/:id/config`, `/heartbeat` : gestion des agents.

Les essais gratuits et l’émission de licences SSH restent désactivés. Aucun mécanisme ne doit afficher un paiement ou une connexion réussis sans confirmation du service réel.
