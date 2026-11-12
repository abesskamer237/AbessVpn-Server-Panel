# ABESS SSH-WS administré : installation, sécurité et exploitation

Cette première intégration ajoute **SSH over WebSocket RFC 6455** (flux binaire)
sur un serveur OpenSSH dédié, et la création/suspension automatique de comptes
SSH sur **les VPS que l'administrateur a explicitement autorisés**.

**Cette modification GitHub n'installe et ne déploie RIEN sur un VPS.**
Le script `scripts/install-ssh-ws.sh` doit être exécuté manuellement, dans
un checkout sûr du dépôt sur le VPS, lorsque l'opérateur le décidera.
Le workflow GitHub `deploy-vps.yml` reste strictement manuel
(`workflow_dispatch`) et n'installe aucun de ces services.

## Architecture

```text
Client SSH sur WebSocket (WSS) :443 /ssh-ws
       |
       v
Caddy (HTTPS, certificat public valide)
       |
       v
127.0.0.1:2080  -- WebSocket binaire, sans compression --> 127.0.0.1:2222
       |                                               OpenSSH dédié
       |
        Le trafic SSH et le chiffrement de SSH restent dans SSH.

Agent root isolé sur VPS -- HTTPS sortant --> panneau /api/v1/nodes/ID/ssh-ws
        - récupère les comptes désirés pour CE SEUL VPS
        - crée les utilisateurs `abv_...` dans le groupe `abessvpn`
        - verrouille et termine les sessions des comptes suspendus/expirés
        - accuse réception du résultat au panneau
```

Le pont est volontairement non privilégié : il n'écoute que sur 127.0.0.1,
n'accepte aucun hôte TCP fourni par l'appelant et se connecte uniquement au
SSH local. Le service SSH dédié écoute sur 127.0.0.1:2222 et ne modifie pas le
`sshd` public déjà présent. Il refuse le shell/SFTP, les sessions utilisateur,
le transfert d'agent et autorise seulement le forwarding TCP local (`ssh -D`).
Les utilisateurs administrés ont un shell `nologin`.

**Cette version prend en charge les clients qui parlent du vrai protocole
WebSocket RFC 6455 en binaire. Les modes raw HTTP Upgrade/payload personnalisé
ne sont PAS interchangeables.** Les clients doivent également vérifier
l'empreinte de la clé hôte SSH.

## Pré-requis sur le VPS (installation manuelle future)

- Linux Debian/Ubuntu avec `openssh-server` et une clé SSH Ed25519 valide
- Node.js 22+ et le dépôt dans `/opt/abess-panel` (accessible à l'utilisateur
  système de la passerelle), suivi de `npm ci`
- Caddy (ou autre proxy WSS compatible) et un vrai domaine TLS
- Un VPS enregistré dans **Exploitation**, avec ID et clé d'agent uniques
- Clé d'agent dans un fichier **root-only** déjà présent sur le VPS ;
  jamais committée et jamais affichée dans une commande partagée
- L'accès SSH administrateur existant doit être testé et conservé séparément

L'opérateur disposant d'un accès root pourra ensuite lancer, à titre
d'exemple et après avoir préparé son fichier de clé :

```bash
cd /opt/abess-panel
sudo env CONTROL_API_BASE_URL=https://panel.example.test \
  VPN_NODE_ID=<uuid_du_vps_enregistre> \
  VPN_NODE_KEY_FILE=/root/abess-node-key \
  bash scripts/install-ssh-ws.sh
```

Ce script est **operator-only** : il crée un groupe et un utilisateur système,
un `sshd` dédié et trois unités systemd. Il n'édite pas le
`/etc/ssh/sshd_config` historique et ne modifie pas le Caddy existant.
Il valide la configuration OpenSSH avant démarrage. Examiner le script avant
exécution, prendre une sauvegarde et programmer une fenêtre de maintenance.

### Exemple Caddy — fichier à intégrer MANUELLEMENT

```caddyfile
ssh.example.test {
  handle /ssh-ws {
    reverse_proxy 127.0.0.1:2080 {
      stream_close_delay 5m
    }
  }
  respond 404
}
```

Utiliser **le vrai domaine du VPS**, un certificat TLS vérifié et le chemin
`/ssh-ws`. Ne pas ouvrir 2080 ou 2222 sur Internet. Si le panneau utilise
déjà Caddy sur le même hôte, fusionner cette route dans sa configuration
avec précaution, sans supprimer les routes du panneau.

L'installation affiche l'empreinte SSH Ed25519 à vérifier **indépendamment**.
Dans **Comptes SSH**, l'administrateur sélectionne ensuite le VPS, saisit
l'empreinte `SHA256:...`, le SNI WSS, le port public (souvent 443) et le
chemin, puis clique sur **Activer SSH-WS**.

## Parcours revendeur

1. Le revendeur choisit **Créer un client SSH-WS administré**.
2. Le panneau génère un identifiant `abv_...` et un mot de passe fort,
   attribue les crédits et enregistre un compte en état `pending`.
3. L'agent VPS effectue `GET /api/v1/nodes/ID/ssh-ws/desired` avec la clé
   unique du nœud et réconcilie uniquement les utilisateurs du groupe prévu.
4. L'agent signale `active`, `blocked` ou `error` par
   `POST /api/v1/nodes/ID/ssh-ws/status`.
5. Le revendeur ne peut exporter les secrets clients qu'une fois le compte
   confirmé actif et l'agent de contrôle récent.
6. Une suspension ou expiration devient un verrouillage sur le VPS au cycle
   suivant (environ 10 s en conditions normales). Les sessions actives de
   ce compte sont également terminées.

En cas de coupure durable avec le panneau, l'agent passe en mode
**fail-closed** après 10 minutes et révoque les comptes suivis localement.
Les dates d'expiration déjà mémorisées restent également respectées.

## Stabilité et performance

- `perMessageDeflate: false` : pas de surcharge CPU/zlib sur du trafic SSH
  déjà chiffré
- `createWebSocketStream` avec gestion de la contre-pression réseau et
  tampon de 64 Kio
- `TCP_NODELAY`, keepalive TCP et ping/pong WebSocket toutes les 30 s
- 10 s maximum de connexion initiale à OpenSSH local
- plafond de connexions simultanées configurable, valeur initiale 512
- service systemd relancé en cas de panne et séparé du panneau/API
- TLS/WSS à configurer uniquement sur Caddy, côté domaine public

Le débit dépend du VPS, du réseau, du certificat TLS et du client SSH :
ces optimisations **ne garantissent pas une vitesse Internet précise**.

## Limites vérifiables avant exploitation commerciale

**Très important : les quotas en Go et `maxConnections` sont encore des
paramètres commerciaux, pas des garanties techniques.** La première version
du provisionneur applique effectivement création, verrouillage, expiration,
suspension et fermeture des sessions, mais ne dispose pas encore d'un compteur
octets SSH fiable par utilisateur ni d'un limiteur strict de connexions.
Ne promettre ni débit illimité ni blocage automatique à N Go tant qu'une
mesure/limitation fiable sur le VPS n'est pas intégrée et testée.

Le compte `managed` n'existe que sur un VPS expressément autorisé ;
l'importation d'un compte acheté chez un fournisseur reste **inventory-only**.

L'agent privilégie la sécurité : il ne doit **jamais** adopter un utilisateur
système préexistant, ni exécuter de shell depuis des paramètres fournis par
l'API. Les commandes sont limitées à useradd/chpasswd/usermod et une
termination des processus de l'UID du compte géré, avec validation stricte.

## Contrôles et diagnostic

```bash
systemctl status abess-ssh-ws-sshd abess-ssh-ws-gateway abess-ssh-ws-reconciler
curl --silent http://127.0.0.1:2080/healthz
ss -ltn | grep -E ':(2080|2222)'
journalctl -u abess-ssh-ws-gateway --no-pager -n 50
journalctl -u abess-ssh-ws-reconciler --no-pager -n 50
```

Pour tester localement le code sans VPS, exécuter :
`node scripts/test-ssh-ws.mjs` ; l'intégration backend est vérifiée par
`node --import tsx scripts/test-external-backend.mjs`.

Avant déploiement réel : tests d'un client WSS indépendant, contrôles
SSH fingerprint, charge et latence, reconnexion, coupure de l'agent, expiration,
suspension et **révocation des connexions déjà établies**.
