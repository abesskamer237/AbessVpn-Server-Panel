# Comptes SSH externes

Le panneau importe désormais des accès SSH existants et ne crée plus de passerelle ou de compte système. Voir [Serveurs externes](EXTERNAL_SERVERS.md#comptes-ssh-existants) pour l’import, le suivi et l’export.

Les instructions historiques ci-dessous décrivent l’ancienne passerelle intégrée et ne s’appliquent plus au backend actuel.

> Pour le mode SSH-WS HTTP Upgrade brut ajouté en 2.5.4 (80/85 et TLS 443/2084), suivre [le guide SSH-WS](SSH_WS_COMPATIBILITY.md). Les modes WebSocket TLS historiques ci-dessous restent compatibles.

# Comptes SSH ABESS

L’implémentation indépendante utilise le protocole SSH 2 avec `ssh2`, sans reprendre le code propriétaire X-net. Elle ne crée pas d’utilisateurs Linux et ne modifie jamais le SSH d’administration. Le service tourne sans root, sans capacités Linux et sans accès au socket Docker.

## Créer une configuration

1. Ouvrir **Comptes SSH** comme Super Admin et attendre « Passerelle opérationnelle ».
2. Créer un utilisateur (3 à 32 caractères), une durée, un quota et une limite de connexions SSH simultanées.
3. Choisir le compte dans le générateur, puis **SSH WebSocket + TLS — 443** (recommandé), **2084**, ou **SSH direct TCP — 2222**.
4. Afficher les paramètres et télécharger le fichier JSON. Il contient un mot de passe et doit être transmis de manière privée.
5. Dans **ABESS VPN 2.5.4+**, importer le fichier `.json` ou coller le JSON dans l’import, sélectionner le profil puis connecter.

Le mot de passe est généré aléatoirement et chiffré dans PostgreSQL. Le vérificateur scrypt, jamais le mot de passe clair, est projeté vers la passerelle. Les listes ne retournent ni le mot de passe ni le vérificateur. Chaque export d’identifiants est audité.

## Réseau

- SSH direct : port public `${SSH_TCP_PORT:-2222}` (modifiable dans `.env`). Le protocole SSH chiffre lui-même le tunnel.
- WebSocket avec TLS : domaine du panel, port 443 ou 2084, chemin `/ws-ssh`, SNI identique au domaine et certificat vérifié.
- Ouvrir 2222/TCP et 2084/TCP chez l’hébergeur si ces transports sont utilisés. Le port 443 reste le plus compatible avec les CDN ; 2084 nécessite habituellement un accès DNS direct, sans proxy CDN.
- Le générateur affiche les paramètres réellement utilisés. Aucun SNI tiers, certificat non vérifié ou charge HTTP injectée vers un service tiers n’est nécessaire.
- La passerelle accepte le WebSocket standard encadré et le tunnel HTTP Upgrade brut utilisés par différents clients SSH. Le JSON n’est pas un fichier propriétaire `.hc`/`.ehi`.

## APK

Le client DartSSH2 vérifie l’empreinte SHA-256 exportée. Un changement de clé exige de réexporter le profil après vérification par l’administrateur. Les identifiants importés suivent le stockage chiffré des profils. Un proxy SOCKS local authentifié relie le moteur Android Xray au tunnel SSH. Les sockets de l’APK sont exclus du VPN pour éviter que le transport SSH se redirige vers lui-même ; les autres applications passent dans le VPN.

Le mode SSH transporte TCP. Le DNS UDP du VPN est converti en DNS TCP à travers SSH ; les autres flux UDP sont bloqués, sans sortie directe. Ce n’est pas WireGuard ni un tunnel UDP. Une interruption SSH arrête le moteur VPN. Pour empêcher Android de reprendre le trafic hors VPN après son arrêt, activer les options système VPN permanent et blocage sans VPN.

## Contrôles et limites

Les limites portent sur les connexions SSH authentifiées, pas sur des appareils attestés. Chaque connexion permet jusqu’à 32 canaux TCP. Les destinations privées, locales, multicast et métadonnées cloud sont refusées, y compris les adresses IPv6 mappées et les résolutions DNS privées. La passerelle épingle l’adresse résolue avant connexion pour éviter une seconde résolution.

La suspension, suppression, expiration et l’épuisement du quota coupent les connexions. Le contrôleur publie toutes les 5 secondes, la passerelle vérifie toutes les secondes et ferme les tunnels après 30 secondes sans contrôle valide. La consommation est persistée chaque seconde dans `ssh_data`, puis réconciliée avec PostgreSQL par maximum monotone ; un arrêt brutal peut perdre jusqu’à une seconde de comptage local non réconcilié. Le quota compte les données TCP traitées, pas tous les en-têtes réseau.

Les volumes `ssh_control` et `ssh_data` sont séparés des données privées de l’API. Les comptes et secrets chiffrés sont inclus dans les sauvegardes de la plateforme. Le workflow crée aussi une archive chiffrée de `ssh_data` avant les déploiements suivants. Sauvegarder séparément ce volume hors du VPS pour conserver la clé d’hôte et le dernier journal de consommation. Ne jamais changer `MASTER_SECRET` sans migration dédiée.

Cette livraison ne fournit pas de serveur Dropbear, SlowDNS, stunnel direct, UDPGW, SSH distant multi-nœuds, renouvellement commercial automatique ni attestation d’appareil. Elle fournit les mêmes familles de protocole SSH TCP et WebSocket/TLS, pas l’ensemble des sous-systèmes X-net.

## Vérification

`SSH_TEST_IMAGE=abessvpn-api:audit bash scripts/test-ssh-docker.sh` teste le trafic SSH réel, TCP, HTTP Upgrade brut, WebSocket encadré et le Caddyfile de production en WSS sur 443/2084 avec certificat de test vérifié, l’authentification, le stockage chiffré, l’isolation privée, le refus des commandes, la suspension, les connexions simultanées, le quota, le redémarrage et le contrôle périmé. Le réseau Docker est isolé et sans accès Internet. Les deux workflows du panel exécutent ce test avant le déploiement.

La compilation et les essais logiciels ne remplacent pas la recette Android sur téléphone (DNS, IPv6, changement de réseau, veille et arrêt du service).
