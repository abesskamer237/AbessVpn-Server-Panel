> Le backend actuel importe les configurations de serveurs externes et ne crée aucun service SSH-WS. Voir [Serveurs externes](EXTERNAL_SERVERS.md). Les exemples de passerelle intégrée ci-dessous sont historiques.

# SSH-WS : référence X-net et intégration ABESS

## Ce qui est vérifiable

Le dépôt public `xpanel-cp/x-net`, révision `a21e289d11c95d001d40906d59df925cc8bf384e`, et l’archive fournie contiennent les mêmes scripts d’installation SSH. Le backend y est distribué sous forme compilée, sans le source du proxy. Aucune extraction de ce backend ni réutilisation de code propriétaire n’a été réalisée.

Les scripts `install/xnet-install-sshd.sh` et `install/xnet-ssh-apply` montrent :

- un service SSH réservé au WebSocket sur `127.0.0.1:2222` ;
- un proxy WS géré par le panel, avec un port public configurable (`websocket.listenPort`, valeur par défaut 8880) ;
- une entrée TLS de type payload/WS sur 2084, redirigée vers le proxy HTTP ;
- des sous-systèmes distincts pour SSH TCP, Dropbear et SSH TLS direct.

Ces fichiers ne donnent pas les identifiants, les réglages privés de l’ami ni toutes les règles de son proxy. ABESS implémente indépendamment le transport HTTP Upgrade suivi de SSH brut décrit par cette chaîne ; il ne prétend pas être une copie intégrale de X-net.

## Échange réseau ABESS

Le client SSH-WS envoie une seule requête HTTP :

```http
GET /ws-ssh HTTP/1.1
Host: hote-du-serveur
Upgrade: websocket
Connection: Upgrade

```

Le serveur répond `HTTP/1.1 101 Switching Protocols`, puis les deux côtés échangent directement les octets SSH. Ce mode n’ajoute ni `Sec-WebSocket-Key` ni trames RFC6455. Le client conserve la bannière SSH même si elle arrive dans le même paquet TCP que la réponse HTTP.

Le mode **WebSocket standard** reste disponible pour les anciens profils : il utilise les trames RFC6455. Le générateur les distingue explicitement.

| Choix du générateur | Valeur JSON | Port public | Transport des octets SSH |
|---|---|---:|---|
| SSH-WS HTTP | `ws` | 80 | HTTP Upgrade puis SSH brut |
| SSH-WS HTTP alternatif | `ws-alt` | 85 par défaut | HTTP Upgrade puis SSH brut |
| SSH-WS TLS | `wss-raw` | 443 | TLS vérifié, HTTP Upgrade puis SSH brut |
| SSH-WS TLS alternatif | `wss-raw-alt` | 2084 | TLS vérifié, HTTP Upgrade puis SSH brut |
| WebSocket standard TLS | `wss` / `wss-alt` | 443 / 2084 | TLS vérifié et trames WebSocket |
| SSH TCP | `tcp` | 2222 par défaut | SSH direct |

Le déploiement configure `SSH_WS_HOST` avec l’adresse du VPS pour les modes sans TLS : ils peuvent ainsi joindre directement l’origine, sans redirection HTTPS d’un CDN. Les variantes TLS utilisent le domaine du panel et son certificat. `SSH_WS_HOST` peut être ajusté dans `.env`.

`SSH_WS_PUBLIC_PORT=8880` remplace le port alternatif 85 si l’on souhaite le port public par défaut indiqué par X-net. Recréer les services avec `docker compose up -d` après une modification et ouvrir ce port chez l’hébergeur. L’API et le générateur affichent la valeur effectivement déployée.

## Utilisation

1. Installer ABESS VPN **2.5.4 ou supérieur**.
2. Dans **Comptes SSH**, créer un compte ou choisir un compte existant.
3. Sélectionner **SSH-WS · HTTP Upgrade brut — 85**, proposé par défaut (ou le port alternatif configuré). Il rejoint directement l’IP du VPS. Les variantes TLS 443/2084 restent disponibles lorsque le domaine et son proxy acceptent le transport brut.
4. Télécharger le JSON et l’importer dans l’APK. Il contient un mot de passe : le transmettre au seul client concerné.
5. Sélectionner le profil puis connecter. L’empreinte SHA-256 SSH est vérifiée dans tous les modes. Le certificat TLS est aussi vérifié lorsque TLS est utilisé.

En HTTP sans TLS, les en-têtes HTTP sont visibles sur le réseau ; le contenu du tunnel est chiffré et authentifié par SSH. Seul `/ws-ssh` accepte l’Upgrade sur le port 80 ; les autres URL redirigent vers HTTPS. Le port alternatif ne publie pas l’API d’administration. Caddy ne reçoit que le domaine et l’email de certificat, pas les secrets de la base ou la clé maître.

Les limites de compte, quota, expiration et connexions sont communes à tous les transports. SSH d’administration sur 22, paiements et licences VLESS sont indépendants. Aucun serveur Dropbear, SlowDNS ou UDPGW n’est ajouté par cette intégration. Le trafic utilisateur reste TCP avec DNS converti en TCP ; pas de tunnel UDP général.

## Preuves et limites

Les tests du panel font traverser le Caddyfile de production par du trafic SSH réel sur 80, 85, 443 et 2084. Ils vérifient le maintien des redirections HTTPS de l’API, les exports, les quotas et la révocation. Les tests du client Dart vérifient HTTP et TLS brut, le refus d’un HTTP 200, d’un mauvais certificat et d’une mauvaise clé SSH, ainsi que la chaîne réelle Xray → SOCKS Dart → SSH avec HTTP et DNS. Les anciens modes WebSocket encadrés sont aussi testés.

Les tests logiciels ne remplacent pas un essai sur le téléphone et le réseau mobile de l’utilisateur. La configuration personnelle de l’ami n’est pas accessible depuis le dépôt et n’a pas été présumée connue.

Le déploiement exige un Upgrade `101` et une bannière SSH à travers le port alternatif depuis le runner GitHub. Il contrôle aussi HTTP 80 et TLS 443 et signale leurs redirections/erreurs. Une redirection `301`/`308` ou une erreur `502` du CDN ne constitue pas un tunnel SSH-WS. Utiliser l’entrée directe validée plutôt que suivre une redirection. `SSH_WS_HOST` est régénéré avec l’adresse du VPS lors des déploiements pour éviter de conserver un ancien domaine derrière un CDN ; les autres paramètres opérationnels et secrets sont conservés.

Le workflow fixe `COMPOSE_FILE` sur le `docker-compose.yml` livré par le dépôt. Un ancien `compose.yaml`, un fichier de surcharge ou une ancienne sélection `COMPOSE_FILE` du VPS ne doit pas faire disparaître silencieusement les ports et variables SSH-WS. L’adresse de l’API active est comparée à celle du déploiement avant le contrôle réseau.
