# Environnement ABESS VPN

Dépôts existants : `/workspace/AbessVpn-Server-Panel` et `/workspace/AbessVpn-Cyber`. Les tâches cloud sont isolées : réutiliser ces dépôts ; ne pas créer de worktree sauf demande explicite.

Node 24.22.1/npm 11.9.0 et Docker disponibles. Les dépendances npm des deux dépôts ont été installées par `npm ci`. Les builds TypeScript/React et les tests serveur fonctionnent. Consulter les fichiers AUDIT.md des deux dépôts.

## Réinstallation et validation serveur

```sh
cd /workspace/AbessVpn-Server-Panel
npm ci
npm run lint
npm run build
npm run build:server
node scripts/test-security.mjs
node scripts/rotate-master-secret.mjs --self-test
```

Pour lancer le serveur, fournir VPN_DOMAIN, ADMIN_EMAIL, ADMIN_INITIAL_PASSWORD (16 caractères minimum), MASTER_SECRET (32 caractères minimum) et DATA_DIR via la configuration sécurisée. Utiliser un stockage isolé pour le développement, sans réutiliser des données ou identifiants de production. Lancer `npm run dev` depuis le dépôt serveur, puis vérifier `/api/v1/ping` par une requête HTTP locale et la connexion dans le navigateur. Sans sidecar Xray actif, `dataPlane` doit rester `not-ready`. Redémarrer les services dans les nouvelles tâches : les processus ne sont pas persistants.

Ne pas lancer le backend Node du dépôt Cyber : il est retiré volontairement.

## Construction API dans ce cloud

`bash scripts/build-cloud-api.sh` reproduit le build API vérifié en montant le certificat du proxy avec BuildKit. Le Dockerfile du dépôt reste utilisable hors de ce proxy ; aucun contournement TLS n’est ajouté. Caddy et les configurations du binaire officiel Xray ont aussi été validés.

## Blocages

- Ajouter `storage.googleapis.com` aux destinations autorisées dans les paramètres cloud pour installer Flutter 3.41.0 et exécuter les tests Android.
- Ajouter `dl-cdn.alpinelinux.org` pour construire le sidecar Xray Alpine. Conserver les destinations réseau existantes et la vérification TLS.
- Installer/configurer le SDK Android pour compiler l'APK ; utiliser les secrets de signature existants pour les releases, jamais des valeurs dans le dépôt.
- L'outil de brouillon cloud renvoie INVALID_ARGUMENT à la lecture et à la sauvegarde. Les instructions ci-dessus sont enregistrées sur disque uniquement ; aucune publication de configuration cloud n'est confirmée.

Après déblocage, relancer les commandes affectées et les tests réels Android/Xray. L'environnement complet Android + sidecars n'est pas encore déclaré prêt.
