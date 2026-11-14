# Audit et refonte — 14 novembre 2026 (version 3.0.0)

Audit complet du panneau, de l’API et du bot Telegram, en production `SSH_WSS_ONLY=true` avec PostgreSQL.

**Périmètre gelé, non modifié :** le moteur SSH-WSS (`scripts/ssh-ws-*`, `install-ssh-ws.sh`, `ssh-ws-postdeploy.sh`, `ssh-ws-passive-traffic.py`), le `Caddyfile`, `docker-compose.yml` et le workflow de déploiement. Le contrat du réconciliateur (`/nodes/:id/ssh-ws/desired` et `/status`) est conservé à l’identique ; il a seulement été rendu plus tolérant.

## Corrections — disponibilité et moteur

| Gravité | Constat | Correction |
| --- | --- | --- |
| Haute | Une requête `Upgrade` non WebSocket lisait le stockage hors transaction et arrêtait le processus API. | Le gestionnaire ferme la connexion sans lire le stockage. |
| Haute | Le bot Telegram gardait le verrou global PostgreSQL pendant ses appels réseau, sans délai maximal. Le panneau et le réconciliateur pouvaient être bloqués, puis les comptes désactivés après 10 min. | Les messages sont mis en file et envoyés seulement après le commit. Délai de 15 s par appel. |
| Haute | Un compteur `online` ou `activeSessions` supérieur à 10 faisait rejeter tout le rapport `/ssh-ws/status`. Au bout de 10 min, le nœud se fermait par sécurité. | Valeurs acceptées jusqu’à la borne du réconciliateur (5000), puis ramenées à 10 côté panneau. |
| Haute | Un mot de passe illisible faisait échouer tout le manifeste `/desired` d’un nœud. | Seul le compte concerné est désactivé. |
| Moyenne | Les routes retirées et les routes sans état ouvraient une transaction globale. | Le filtre des routes retirées passe avant le stockage ; `time`, `countries`, `payments/instructions` et `speedtest` n’ouvrent plus de transaction. |
| Moyenne | `/app` échouait toujours avec PostgreSQL : aucune transaction n’était ouverte. | Route ajoutée au middleware transactionnel. |

## Corrections — commerce et crédits

| Gravité | Constat | Correction |
| --- | --- | --- |
| Haute | Les paiements confirmés n’apparaissaient pas dans le journal des transactions. | Écriture `CREDIT_ADD` avec soldes avant/après et numéro de facture. |
| Moyenne | Dérive des nombres flottants : 0,1 + 0,1 + 0,1 ≠ 0,3. Un transfert pouvait être refusé à tort. | Tous les soldes sont arrondis à 10⁻⁶ Go. |
| Moyenne | Un retrait par l’administration était plafonné à zéro en silence, mais le journal enregistrait le montant demandé. Aucune limite haute (risque d’`Infinity`). | Refus explicite du découvert, plafond de 1 000 000 Go, entrée dans le journal d’audit. |
| Moyenne | La note de transfert acceptait n’importe quel objet JSON, ce qui faisait planter la page Transactions. | Texte uniquement, 200 caractères au maximum. |
| Moyenne | Suppression d’une branche : crédits perdus si l’administration supprimait, remboursement versé au mauvais compte, clients SSH-WSS orphelins. | Remboursement au parent direct et transfert des clients SSH-WSS au parent. |
| Moyenne | Revendeur créé par un ADMIN délégué : la suspension de cet ADMIN coupait toute la branche. | Les revendeurs de premier niveau sont rattachés au Super Admin. |
| Moyenne | Création d’un revendeur : plantage sur un type invalide, mot de passe sans longueur minimale, doublon renvoyant 400. | Validation complète ; un doublon renvoie 409. |
| Basse | Un revendeur parent pouvait réactiver un sous-revendeur suspendu par l’administration. | Verrou `suspendedByAdmin` et entrée dans le journal d’audit. |
| Basse | Nombre de commandes illimité par compte. | 10 commandes en cours au maximum. |

## Corrections — clients SSH-WSS (`modules/ssh.ts`)

- Un nom d’utilisateur supprimé ne peut plus être réutilisé. Le réconciliateur garde l’ancien identifiant : la nouvelle licence restait en erreur alors que le compte avait été débité.
- Une licence suspendue ou expirée peut être renouvelée, sauf si le serveur a été supprimé : aucun débit n’a lieu dans ce cas.
- La configuration exportée reprend l’empreinte et le chemin actuels du nœud.
- Un compte inactif renvoie désormais 409 au lieu d’un 5xx, que PostgreSQL présentait comme une panne de stockage.
- Un compte d’un autre revendeur est refusé (403) avant toute indication sur son existence.
- La télémétrie des VPS est réservée aux administrateurs.
- La limite de 50 appareils bloqués est désormais signalée au lieu d’être ignorée.

## Autres corrections

- **Restauration chiffrée :** chaque section est validée avant toute écriture. Une erreur d’écriture renvoie 500, ce qui annule toute la restauration au lieu d’en valider une partie.
- **Production `SSH_WSS_ONLY` :** les routes `import-link`, `membership/*` et l’approbation des demandes, qui émettaient des licences VLESS inutilisables, sont retirées.
- **Bot Telegram :** les fonctions VLESS sont retirées dans ce mode. Les boutons « +Go » et « +jours » et la bascule de mise à jour obligatoire sont réparés, et les alertes de rappel s’affichent de nouveau.
- **CORS :** les origines de développement ne sont plus autorisées en production.
- **Validation :** annonces (type, plateforme, priorité), forfaits (longueurs), demandes d’adhésion (longueurs, moyen de paiement), refus d’une demande déjà traitée.
- **Divers :** MFA signalée comme requise pour les ADMIN, métriques sans plantage si le fichier de jeton est absent.

## Design v3

Interface entièrement redessinée :
- **Système de design compact :** police Geist hébergée localement, tons neutres et accent émeraude-cyan, thèmes sombre et clair.
- **Cases groupées par fonction :** les indicateurs d’une page forment une seule bande séparée par de fines lignes. Le tableau de bord est organisé en grille, et les blocs de même nature ont la même forme.
- **Navigation :** barre latérale par sections, repliable en rail d’icônes ; fil d’Ariane ; palette de commandes Ctrl/⌘ + K (pages, actions, recherche de clients et de revendeurs).
- **Clients :** tableau dense avec filtres segmentés ; fiche client en panneau latéral organisée en sections ; création par formules prédéfinies.
- **Revendeurs :** actions en icônes et fenêtre dédiée aux transferts de crédits.
- **Graphiques :** courbe d’activations en SVG natif (sans bibliothèque), anneau de taux d’activité, jauges de capacité.

## Espace revendeur, onglets Clients et Revendeurs

Le moteur VPN et le protocole SSH-WSS ne sont pas modifiés. Les nouvelles options passent par le contrat existant du réconciliateur, qui réapplique déjà un mot de passe dont l’empreinte change. Les paiements restent manuels : déclaration Mobile Money, puis validation par le Super Admin.

**Clients**
- **Tri et filtres :** filtres par état, revendeur et serveur ; tri par date, expiration, consommation ou nom ; indicateur J-x avant expiration.
- **Actions groupées :** renouvellement (avec total débité), suspension, réactivation et export CSV.
- **Fiche client en quatre onglets :**
  - **Aperçu :** renouvellement en un clic avec solde après opération, paramètres, changement du mot de passe SSH, transfert de propriétaire (administration seulement), suppression.
  - **Configuration :** copie du message client, partage WhatsApp, JSON, fichier.
  - **Appareils :** liste des appareils et blocage ou déblocage.
  - **Historique.**
- **Création :** nom d’utilisateur proposé automatiquement, générateur de mot de passe, coût et solde après création, création bloquée si le solde est insuffisant.

**Revendeurs**
- **Liste :** filtres (actifs, suspendus, solde faible) et tris.
- **Fiche revendeur :**
  - **Aperçu :** crédits en ajout ou retrait, montants rapides, note, soldes avant et après, sous-revendeurs directs.
  - **Clients**, **Mouvements de crédits.**
  - **Réglages :** tarifs, profil (nom et email), réinitialisation du mot de passe avec révocation des sessions, suspension, suppression de la branche avec remboursement au parent.
- **Création :** mot de passe généré, puis écran des accès à copier ou à envoyer par WhatsApp.

**Tableau de bord revendeur :** solde mis en avant, achat de crédits et actions rapides.

**Nouvelles routes de l’API**
- `PATCH /admin/ssh/accounts/:id` accepte désormais `password` et `resellerId` (administration seulement).
- Ajout de `PUT /admin/resellers/:id/profile` et `PUT /admin/resellers/:id/password`, réservées à l’administration ou au parent direct.
- Toutes les validations ont lieu avant la moindre écriture.

## Panneau web

- **Nouvelle page Facturation**
  - Catalogue d’offres (création, modification, suppression par le Super Admin).
  - Commande de crédits par les revendeurs.
  - Déclaration de paiement MTN MoMo / Orange Money.
  - File de vérification avec confirmation du montant réellement reçu, ou refus motivé.
  - Factures imprimables et export CSV.
- **Nouveau Journal d’audit** (Super Admin) : filtres par famille et par période, actions sensibles mises en évidence, export CSV.
- **Page Sécurité** reconstruite avec les composants du panneau, confirmation du nouveau mot de passe et copie des codes de récupération.
- **Corrections UI**
  - Le message client affichait le texte « \n » au lieu de retours à la ligne.
  - Le bouton « Nouveau client » du tableau de bord ne s’ouvrait pas.
  - Le bouton « Serveurs » était visible par les revendeurs.
  - Une session expirée laissait le panneau figé ; elle renvoie maintenant à la connexion avec un message.
  - Les messages d’erreur HTTP sont lisibles.
  - La touche Échap ferme les fenêtres.
  - L’actualisation est suspendue quand l’onglet est caché.
- **Présentation :** typographie agrandie, page de connexion en deux colonnes, favicon, focus clavier visible, respect de `prefers-reduced-motion`.

## Nettoyage

**Supprimé :**
- Composants React inutilisés (`CommerceCenter`, `OperationsCenter`, `RenewLicence`, `WorkspaceWelcome`).
- `templates/index.html` : 4 500 lignes jamais servies.
- `metadata.json` (AI Studio), `docker-compose.legacy-tcp.yml`, `docker/node-Caddyfile`.
- Scripts ponctuels retirés : `auto-update.sh`, `ssh-wss-safe-cleanup.sh`.
- Logo PNG inutilisé (270 Ko).
- Fonctions SSH mortes et interface `SessionData` dans `server.ts`.
- Dépendances inutilisées `@google/genai`, `motion`, `autoprefixer` et binaire `rolldown`.

## Vérifications exécutées

- `npm run lint`, `npm run build`.
- Tests de sécurité, exports, plateforme, contrat mobile, SSH-WS et rotation de clé.
- Backend externe en JSON et en PostgreSQL ; suite PostgreSQL complète.
- Playwright : 5 scénarios, dont le parcours complet de facturation revendeur → administrateur.
- Test de bout en bout de type production (PostgreSQL + `SSH_WSS_ONLY=true` + `NODE_ENV=production`) :
  - paiement confirmé, puis crédits ajoutés et inscrits au journal ;
  - compteurs à 15 sessions acceptés et ramenés à 10 ;
  - renouvellement d’une licence suspendue ;
  - nom d’utilisateur supprimé refusé ;
  - verrou de suspension administrateur ;
  - requête WebSocket legacy sans arrêt du processus.

**Non vérifiés ici :** `test-deploy-stdin` et `test-xray-traffic`, qui nécessitent Docker et ne s’exécutent qu’en CI ; un déploiement réel sur le VPS.

## Limites connues

- Le stockage PostgreSQL reste sérialisé par un verrou global et charge tous les documents à chaque requête. Un découpage par document est la prochaine étape pour monter en charge.
- Les virements de crédits et la création de revendeurs n’utilisent pas encore de clé d’idempotence.
- Les routes VLESS historiques restent dans le code pour les tests de contrat. Elles sont retirées à l’exécution par `SSH_WSS_ONLY=true`.
