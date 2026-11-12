# ABESS : une seule offre VPN, SSH sur WebSocket sécurisé (SSH-WSS)

## Source de référence
Ce projet suit les objectifs du document utilisateur **GUIDE_DOMAINE_AWS_XNET_GATEWAY.txt**, principalement les sections 1 (DNS), 3 (CloudFront), 4 (VPS), 6 (HTTPS/WSS), 7.1 (utilisateur SSH) et 8 (tests). Il n'installe PAS les binaires propriétaires du panneau X-NET ni ses autres protocoles.

## Architecture de production actuelle
- Port public **443/tcp** : Caddy avec un certificat TLS valide, panneau web et `/ssh-ws/<secret-individuel>`.
- Port public **80/tcp** : validation ACME et redirection HTTPS administrée par Caddy.
- Port **22/tcp** : administration du VPS uniquement, ne jamais supprimer sans un autre accès.
- Service OpenSSH SSH-WS isolé : **127.0.0.1:2222**, non exposé au public.
- Passerelle SSH-WS : socket Unix accessible à Caddy avec droits de groupe ; elle authentifie le secret client WebSocket, attribue une adresse source bouclée spécifique à la licence et applique quota/sessions.
- Agent SSH-WS : rapproche les licences du panneau des comptes Linux, dates, quotas et politiques.
- Base PostgreSQL : utilisateurs administratifs, revendeurs, crédits, licences, journaux et état. Ces données sont **utiles** et ne doivent pas être effacées automatiquement.
- Mode de production `SSH_WSS_ONLY=true` : endpoints VLESS/VMess/Trojan/profils multi-protocoles et abonnements historiques désactivés avec HTTP 410. L'ancien code de migration et les archives restent accessibles uniquement hors production pour une reprise contrôlée.

## Ce qui est retiré des menus et de la création
Aucune création de VLESS, VMess, Trojan, WireGuard, SlowDNS, Dropbear, UDPGW, connexion SSH brute, SSH-WS sans TLS ni import « fournisseur »; aucune liaison multi-variantes Xray, QR VLESS, payload pour autres transports. Le port 7300 UDPGW, 8080 et les ports sing-box/Xray ne sont pas nécessaires au déploiement minimal ABESS.

La configuration SSH-WSS qu'on exporte contient : destination `host`, SNI, port **443**, chemin unique, identifiant SSH, mot de passe, empreinte Ed25519. Le client doit réellement prendre en charge les trames WebSocket RFC 6455 et y transporter SSH. Un simple payload HTTP `Upgrade` ne suffit pas à garantir la compatibilité avec toutes les applications.

## CloudFront AWS — option distincte, non provisionnée ici
CloudFront sait relayer WebSocket en **HTTP/1.1** avec les en-têtes requis (par exemple `Sec-WebSocket-Key`, `Sec-WebSocket-Version`), une politique de cache désactivé et un domaine d'origine HTTPS/TLS vérifié. Une distribution **appartenant au propriétaire du VPS** peut servir de CDN. Le domaine `dxxxx.cloudfront.net` fourni par AWS **n'est pas un host de domain-fronting universel**. Un `Host` et un SNI incompatibles peuvent être refusés (HTTP 421) ; ne jamais supposer que le CDN d'un tiers peut servir de tunnel.

Ne pas créer de distribution AWS ou de frais sans accès AWS autorisé. Vérifier facturation, comportement des connexions longues et débit réel avant d'activer une passerelle CDN en production.

## Réduction de charge et données à préserver
1. **Supprimer du paquet web les écrans multi-protocoles** : l'application principale est maintenant réduite à SSH-WSS, revendeurs/crédits, sécurité, exploitation et la configuration des comptes gérés.
2. **Désactiver les APIs historiques** avec HTTP 410 au lieu de laisser créer des licences de protocoles supprimés.
3. **Ne jamais exécuter** `docker compose down -v`, `docker volume prune` ou `docker system prune --volumes` : cela détruirait les données.
4. Sauvegarder la base PostgreSQL et les fichiers de configuration (et vérifier leur restauration) avant de purger les comptes ou licences historiques. Les crédits, transactions et journaux ne sont pas des données inutiles.
5. Nettoyer seulement les caches de build anciens et les fichiers d'installation temporaires identifiés ; ne pas toucher aux volumes persistants ni aux états SSH-WS.
6. Après le redéploiement, vérifier les services `abess-ssh-ws-sshd`, `abess-ssh-ws-gateway`, `abess-ssh-ws-reconciler`, la santé Caddy/API, puis un compte client autorisé sur WSS.

## Critères d'acceptation
- Un seul protocole client dans le panneau et dans la création de licences : SSH-WSS.
- Appels API des anciennes licences : 410 (mode de production).
- Secret WSS personnel, authentification SSH, empreinte vérifiée.
- Quota mesuré en octets SSH des deux sens et limites de **sessions WebSocket** effectivement appliquées.
- Comptes, revendeurs, crédits, sécurité, sauvegardes et journaux existants conservés.
- Aucun port SSH-WS interne exposé à Internet.
