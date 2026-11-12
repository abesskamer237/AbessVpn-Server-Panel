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
Client SSH sur WebSocket (WSS) :443 /ssh-ws/<secret-client-unique>
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
  handle /ssh-ws/* {
    reverse_proxy 127.0.0.1:2080 {
      stream_close_delay 5m
    }
  }
  respond 404
}
```

Utiliser **le vrai domaine du VPS**, un certificat TLS vérifié et le chemin
`/ssh-ws/<secret-client>` (et non le chemin générique). Ne pas ouvrir 2080 ou 2222 sur Internet. Si le panneau utilise
déjà Caddy sur le même hôte, fusionner cette route dans sa configuration
avec précaution, sans supprimer les routes du panneau.

L'installation affiche l'empreinte SSH Ed25519 à vérifier **indépendamment**.
Dans **Comptes SSH**, l'administrateur sélectionne ensuite le VPS, saisit
l'empreinte `SHA256:...`, le SNI WSS, le port public (souvent 443) et le
chemin, puis clique sur **Activer SSH-WS**.

## Parcours revendeur

1. Le revendeur choisit **Créer un client SSH-WS administré**.
2. Le panneau génère un identifiant `abv_...`, un mot de passe fort et **un secret WebSocket de 256 bits** réservé à ce compte,
   attribue les crédits et enregistre un compte en état `pending`.
3. L'agent VPS effectue `GET /api/v1/nodes/ID/ssh-ws/desired` avec la clé
   unique du nœud et réconcilie uniquement les utilisateurs du groupe prévu.
4. L'agent publie la politique locale (quota octets, secret hashé et nombre de sessions), puis attend la confirmation de la passerelle et signale `active`, `blocked` ou `error` ainsi que les octets réels et sessions par `POST /api/v1/nodes/ID/ssh-ws/status`.
5. Le revendeur ne peut exporter les secrets clients qu'une fois le compte
   confirmé actif et l'agent de contrôle récent.
6. Une suspension ou expiration verrouille l'accès SSH et la passerelle ferme les WebSockets du compte lors de l'actualisation de la politique ; les anciennes sessions SSH du compte sont également terminées.
7. La consommation des octets en montée et descente est cumulée ; le quota bloque les nouveaux octets dès que la limite est atteinte. Les sessions WebSocket simultanées sont plafonnées par compte, indépendamment du nombre de connexions globales du VPS.

En cas de coupure durable avec le panneau, l'agent passe en mode
**fail-closed** après 10 minutes et révoque les comptes suivis localement.
Les dates d'expiration déjà mémorisées restent également respectées.

## Quotas réels et limite de connexions simultanées

La passerelle refuse désormais **toute connexion sur le chemin générique**
`/ssh-ws` et exige le chemin privé `/ssh-ws/<secret>` retourné par l'export
authentifié du compte. Le secret n'apparaît pas dans les listes ou l'inventaire
public du panneau. Le client doit être compatible WebSocket RFC6455 **binaire**
et importer le chemin exact. Faire attention aux logs du proxy : ne jamais
journaliser le chemin complet ni le communiquer sur un groupe public.

- **Quota Go :** `quotaBytes` représente le total octets utiles transportés
  entre SSH et WebSocket dans **les deux sens** ; 1 Go = 1024³ octets. Cela
  comprend les octets du protocole SSH, pas l'en-tête WebSocket/TLS/IP.
- **Connexions simultanées :** `maxConnections` est le nombre de *sessions
  WebSocket établies avec le même secret*, pas le nombre de canaux TCP,
  d'appareils identifiables ou de connexions Internet à l'intérieur de SSH.
- **Durabilité :** la passerelle réserve à l'avance des blocs de 256 Kio et
  effectue `fsync` avant de transférer ces octets. Les octets non utilisés
  sont restitués si la session se ferme proprement. Après un arrêt brutal,
  un solde réservé non utilisé peut rester facturé (jusqu'à 256 Kio par
  compte). Un redémarrage ne remet donc pas le compteur à zéro.
- **Concurrence :** toutes les sessions du même compte utilisent le *même*
  compteur en mémoire dans **un processus unique par VPS**. Ne pas lancer
  deux instances de cette passerelle avec la même politique/les mêmes
  utilisateurs : le comptage partagé n'est pas distribué.
- **Comptage vers le panneau :** la passerelle écrit un fichier de métriques
  local ; l'agent root le lit après avoir vérifié la génération de politique
  appliquée, puis transmet des octets cumulés monotones et le nombre de
  WebSockets ouverts par la clé privée du VPS.
- **Sécurité :** la création ou l'authentification SSH conserve son propre
  mot de passe. Le secret du chemin ne remplace pas l'authentification SSH ;
  il associe le trafic du WebSocket au quota d'un compte.
- **Coupure du panneau :** l'agent protège aussi les dates d'expiration
  en local, et la passerelle refuse les politiques devenues trop anciennes.

**Migration impérative :** les anciens comptes SSH-WS administrés sans secret
WebSocket dédié ne peuvent pas être utilisés tels quels. Ne pas réactiver
le chemin commun pour assurer leur compatibilité ; provisionner de nouveaux
comptes ou mettre en place une migration de secrets sécurisée.

## Stabilité et performance

- `perMessageDeflate: false` : pas de surcharge CPU/zlib sur du trafic SSH
  déjà chiffré
- `createWebSocketStream` avec gestion de la contre-pression réseau et
  tampon de 64 Kio
- `TCP_NODELAY`, keepalive TCP et ping/pong WebSocket toutes les 30 s
- 10 s maximum de connexion initiale à OpenSSH local
- plafond global de connexions configuré à 512 initialement, et plafond strict par compte de 1 à 10 WebSockets
- journal de consommation durcie sur disque avec synchronisation préalable des réservations
- politique partagée en lecture seule par le processus non privilégié
- service systemd relancé en cas de panne et séparé du panneau/API
- TLS/WSS à configurer uniquement sur Caddy, côté domaine public

Le débit dépend du VPS, du réseau, du certificat TLS et du client SSH :
ces optimisations **ne garantissent pas une vitesse Internet précise**.

## Limites vérifiables avant exploitation commerciale

**Les quotas d'octets et les plafonds de WebSockets sont maintenant
appliqués par la passerelle locale** pour les comptes SSH-WS administrés.
Les comptes SSH importés d'un fournisseur non géré restent commerciaux
seulement. Cette intégration ne constitue PAS une preuve de comportement
sur ton vrai VPS : aucune installation, aucune mesure réseau réelle ni
validation d'un client VPN tiers n'a encore été effectuée.

Le débit maximal, la stabilité sur 24–72 h, l'impact des réservations durables
sur le stockage et la configuration TLS sont à mesurer en conditions réelles
avant d'annoncer une performance commerciale. Les comptes utilisant des
technologies autres que WebSocket binaire RFC6455 ne sont pas couverts.

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


## Binding SSH → licence (sécurité anti-contournement)

Le WebSocket possède un jeton aléatoire et un quota propre. Pour empêcher un
client qui connaît deux mots de passe SSH de faire passer l'identité SSH B
par le tunnel WebSocket A, chaque licence possède désormais une adresse source
loopback **stable et non réutilisée** de la plage `127.120.0.1–127.120.255.254`.

La passerelle se connecte à OpenSSH en définissant cette adresse comme source.
L'agent écrit une liste `AllowUsers utilisateur@127.120.x.y` dans le fichier
`/etc/abess-ssh-ws/allowed-users.conf`, vérifie la syntaxe avec `sshd -t`
et recharge uniquement le daemon SSH dédié. Une adresse source ne peut
correspondre à deux licences dans le même instant. Si aucune licence n'est
autorisée, la liste refuse **tous** les utilisateurs.

Important : les environnements Linux doivent accepter les connexions venant
de ces adresses loopback 127/8 (configuration Linux standard). Cela ne fonctionne
pas tel quel sur Windows ou sur un VPS dont la politique réseau interdit 127/8.
Le trafic passant *hors* de cette passerelle (accès OpenSSH via un autre port,
proxy distinct, comptes du fournisseur externe) n'est pas automatiquement
comptabilisé : ne pas exposer le port SSH dédié à Internet.

## Comment interpréter le quota

Le quota inclut **les octets du flux SSH chiffré dans les deux sens**, au point
de passage SSH-WS. Il ne compte pas nécessairement les mêmes octets qu'un
opérateur télécom, ni les en-têtes TLS/WebSocket ou tous les octets TCP/IP.
Les réservations disque sont durables et peuvent surfacturer des octets non
consommés si le processus tombe brutalement ; elles empêchent en revanche
la remise à zéro gratuite d'un quota après crash.

Une seule instance de la passerelle doit gérer chaque journal de quotas :
ne pas démarrer plusieurs passerelles avec des journaux différents pour le
même VPS, au risque de contourner les plafonds de sessions et d'octets.

## Benchmark reproductible avant la mise en production

```bash
# Banc d'essai CI / machine de développement : boucle locale seulement
node scripts/benchmark-ssh-ws.mjs
```

Il évalue 1, 4 puis 12 connexions concurrentes, transfère des blocs binaires
dans un faux service SSH en écho et affiche débit utile agrégé (MiB/s),
latence médiane et P95. Ces valeurs sont **synthétiques**, pas celles d'un VPS
ni d'une application VPN réelle.

Sur un VPS de **préproduction seulement**, lorsque l'installation sera
autorisée, compléter avec une matrice de mesure :
- SSH-WS via certificat TLS valide, application SSH-WS tierce réellement
  compatible et empreinte SSH vérifiée.
- Essais 1, 5, 10, 25 clients, débit descendant/montant par client.
- Latences p50/p95, CPU, RSS, charge du daemon OpenSSH et erreurs WebSocket.
- Coupure du panneau 10 minutes, expiration, suspension, franchissement
  du quota, redémarrage de la passerelle et du VPS.
- Test d'usurpation : se connecter en WSS avec le secret A et essayer
  l'utilisateur/mot de passe SSH B — **doit échouer**.
- Confirmer l'absence de débordement de `maxConnections` en tenant des
  connexions simultanées ouvertes.
- Examiner la consommation après redémarrage et la cohérence avec les
  octets transférés sur le flux SSH.

Ne valider commercialement la capacité et le débit qu'une fois ces tests
effectués sur **le vrai VPS et la vraie application VPN**.
