# Centre de service ABESS VPN 3.2

## Communications

Le menu **Annonces** est accessible aux utilisateurs connectés. Le Super Admin
peut créer un brouillon, prévisualiser, modifier, dupliquer, programmer, publier,
archiver puis supprimer une annonce archivée. Les types sont information,
avertissement, incident critique, promotion et mise à jour. Un message peut avoir
une image HTTPS et un bouton HTTPS ou interne. Les contenus sont affichés comme
du texte, jamais comme du HTML fourni par un utilisateur.

Audiences : public, tous les utilisateurs connectés, revendeurs, administration,
destinataires sélectionnés et clients du portail. Les annonces privées ne sont
jamais renvoyées par les endpoints publics historiques des applications. Les
applications mobiles existantes continuent à recevoir les annonces publiques ;
les audiences privées nécessitent les sessions du site ou du portail.

Les dates sont saisies dans l’heure locale du navigateur, stockées en UTC et
évaluées côté serveur. Une annonce programmée ou expirée n’est pas distribuée.
Les lectures, accusés, masquages et clics sont enregistrés par destinataire et
révision. Un changement de contenu produit une nouvelle révision. Les compteurs
du panneau concernent les lecteurs authentifiés, pas les téléchargements anonymes
d’une annonce par une ancienne application mobile.

## Historique et supervision

**Consommation & réseau** présente 7, 30 ou 90 jours de trafic observé, le détail
par client, l’export CSV, l’horodatage et l’état de fraîcheur de la collecte. La
première observation constitue un point de départ : les anciens cumuls ne sont
pas transformés artificiellement en historique. Deux rapports du même cumul ne
comptent pas deux fois les mêmes octets.

Le Super Admin voit aussi CPU, mémoire, sessions, débit du VPS, retransmissions
et RTT TCP des clients quand ils sont mesurables. Le RTT du HTTPS public est lu
dans l’espace réseau de Caddy. Les valeurs absentes restent « Non mesuré ». Les
échantillons de supervision sont conservés sept jours, à raison d’un point toutes
les cinq minutes ; la lecture des sockets publics est limitée à une fois par
minute. Ces mesures ne garantissent pas le débit d’un téléphone Orange.

## Support et portail client

**Support** fournit les catégories technique, paiement, renouvellement et autre,
une priorité, un fil de réponses, une attribution à un opérateur administratif et
les états ouvert, attente, résolu et fermé. Les revendeurs voient leurs demandes
et celles des licences qu’ils sont autorisés à gérer. Un client du portail voit
uniquement ses propres conversations ; les notes internes d’un revendeur ne lui
sont pas exposées.

Le portail `/client` utilise l’identifiant et le mot de passe SSH. Sa session
HttpOnly est séparée des sessions d’administration. Le client peut consulter son
quota, son expiration et son historique, télécharger sa configuration quand la
licence et le serveur sont prêts, lire les annonces qui lui sont destinées et
ouvrir une demande de renouvellement. Un renouvellement reste soumis au paiement
et à la validation du revendeur. Changer le mot de passe SSH invalide les sessions
du portail correspondant à l’ancien mot de passe.

## Notifications

Les préférences permettent de régler le rappel d’expiration (1 à 168 heures), le
seuil de quota (50 à 100 %) et les canaux. Les alertes du site sont dédupliquées.
Les annonces actives compatibles avec l’audience sont aussi accessibles dans le
centre. Un dépassement de sessions observé est signalé sans tronquer son affichage
à la limite configurée.

Les sessions comptabilisées sont authentifiées avec le compte Linux géré.
Les processus de supervision SSH privilégiés et les connexions `[net]` ou
`[preauth]` en attente d’authentification sont exclus du compteur et du trafic
facturé. Les cumuls historiques restent conservés lors de cette correction.

**Telegram** exige un bot configuré et vérifié avec `TELEGRAM_BOT_TOKEN`. Chaque
revendeur associe son compte depuis Notifications, suit un lien personnel valable
dix minutes dans une conversation privée, puis active le canal et lance un test.
Le code d’association est stocké sous forme de hachage, à usage unique. Cette
association ne donne aucun droit d’administration du bot. `/stopnotifications`
dissocie la conversation. Un envoi n’est marqué livré qu’après confirmation de
l’API Telegram ; les échecs sont réessayés au maximum trois fois. Les envois passent
par une file durable et ont lieu hors des transactions PostgreSQL. Une restauration
annule les envois encore en attente pour éviter de renvoyer de vieilles alertes.

Pour le bot choisi, **@AbessV2raybot**, enregistrer son jeton BotFather dans
le secret GitHub Actions `TELEGRAM_BOT_TOKEN` du dépôt, puis lancer le workflow
**Deploy ABESS VPN to VPS**. Ne pas mettre le jeton dans une issue, le code ou
le chat. Le déploiement garde la configuration existante si ce secret est absent.
Une fois le bot vérifié par Telegram, chaque revendeur doit encore associer son
compte dans **Notifications** et activer ses alertes. `TELEGRAM_ADMIN_IDS` reste
une liste séparée, gérée sur le VPS, pour l’administration du bot ; aucune
association de notifications n’accorde ce privilège.

**E-mail** reste désactivé, comme convenu, en l’absence de service d’envoi. Aucun
mail n’est simulé ni déclaré livré. Les paiements MTN MoMo / Orange Money restent
également **manuels** : aucune déclaration client ne crédite un compte.

## Capacité et migrations

**Parc & migrations** permet de fixer la capacité d’un VPS, de fermer les nouvelles
ventes avec des limites de sessions obligatoires. Le choix « Automatique »
à la création utilise le serveur admissible le moins rempli proportionnellement
à sa capacité. Les vérifications de capacité et le débit de crédits sont effectués
dans la même transaction.

La migration est préparée puis confirmée par le Super Admin. Le compte doit être
suspendu et la suspension récemment confirmée par l’agent source ; la destination
doit être en ligne et disposer de capacité. Une prévisualisation expire après
quatre minutes et devient invalide si le client change. Le compte reste suspendu
après déplacement : il faut le réactiver, attendre le provisionnement et remettre
sa nouvelle configuration. Aucun basculement transparent des tunnels actifs n’est
promis, ni migration forcée depuis un serveur dont l’arrêt n’est pas confirmé.

## Limites réelles des connexions

Le chemin public HTTP 101 → SSH brut utilise désormais `abess-raw-meter`.
Le relais détecte aussi les en-têtes RFC6455 et conserve le transport WebSocket
encadré. Les deux formats partagent le même quota et la même limite de sessions.
Le hook PAM **account** associe la connexion au compte Linux authentifié avant
que SSH confirme la connexion. Le relais admet atomiquement au maximum la limite
choisie, de **1 à 1000 sessions par licence**. Le compte administrateur et les
utilisateurs hors du groupe géré conservent leur chaîne PAM habituelle. Un accès
SSH direct avec les identifiants d’une licence gérée ne contourne pas le relais.

Chaque octet du flux SSH après admission, montant et descendant, est réservé sur
disque avant transmission. Le total partagé entre toutes les sessions ne dépasse
pas le quota. Une interruption brutale peut facturer au maximum une réservation
inutilisée de 1 Mio ; elle ne remet jamais le quota à zéro. La fermeture propre
restitue la réservation inutilisée. Les échanges SSH préalables à l’authentification
ne sont pas du trafic VPN facturé et sont bornés à 64 Kio et trente secondes.
Les anciens cumuls constituent le point de départ ; l’observateur passif cesse de
facturer pour éviter le double comptage. L’agent remonte le journal du relais.

Une réduction de limite ferme les sessions excédentaires ; une suspension,
expiration ou politique périmée ferme les flux concernés. Le contrôle strict est
obligatoire, même lorsqu’une ancienne sauvegarde contient le mode « Observation ».
Le garde secondaire vérifie l’identité, le groupe et la date de création du
processus, et ferme les anciennes connexions gérées non admises par le relais.
Il ne signale jamais un processus root ou un utilisateur hors du groupe géré.

L’onglet **Appareils** affiche le nom reçu ou personnalisé, le trafic montant,
descendant et total, les sessions actives et la dernière activité. Les clients
peuvent transmettre `X-Abess-Device-ID`, `X-Abess-Device-Name` et
`X-Abess-Device-Brand`. Un identifiant déclaré permet de retrouver et suspendre
ce même identifiant après reconnexion ; il n’est pas une preuve matérielle et
peut être changé par le client. Sans identifiant, chaque connexion est une
**session SSH distincte** ; sa suspension ferme cette session, et non toutes les
futures connexions d’un téléphone non identifiable. Renommer n’invente ni modèle
ni marque. Pour retirer tout accès malgré un identifiant changeant, suspendre la
licence ou changer son mot de passe. Les contrôles sont soumis aux droits du
propriétaire de la licence et sont audités.

Le déploiement prépare le relais avant le changement d’amont Caddy, conserve
une sauvegarde de `/etc/pam.d/sshd`, puis active le hook géré sans redémarrer le
SSH administrateur. `scripts/test-ssh-raw-live.py` vérifie avec un vrai OpenSSH
et PAM le refus avant authentification, l’impossibilité d’un contournement direct,
le maintien de l’accès root, la suspension/réactivation et le quota exact après
redémarrage. Le service de transport historique reste installé pour restauration,
mais les licences gérées doivent passer par le relais contrôlé.

## Données et validation

Les nouveaux agrégats sont transactionnels dans PostgreSQL et inclus dans les
sauvegardes chiffrées version 4. Les restaurations en ligne et hors ligne restent
compatibles avec les sauvegardes version 3. Les sessions client sont révoquées
lors d’une restauration et ne sont pas exportées dans les sauvegardes.

Vérifications : `scripts/test-service-center.mjs` en JSON et PostgreSQL,
`tests/service-center.spec.ts` dans Chromium, les tests des sockets/limites SSH,
la suite de sécurité et l’essai de restauration PostgreSQL. Après déploiement,
`scripts/verify-panel-features.mjs` contrôle les endpoints en production avec des
sessions temporaires supprimées ensuite. Il ne crée aucun paiement ni licence,
ne publie aucune annonce et n’envoie aucun message externe.
