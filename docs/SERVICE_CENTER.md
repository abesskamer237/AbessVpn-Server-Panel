# Centre de service ABESS VPN 3.1

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
ventes et de contrôler le mode des limites de sessions. Le choix « Automatique »
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

La passerelle RFC6455 native applique déjà les quotas et les admissions. Sur le
chemin brut existant, l’observateur remonte les vrais compteurs ; le rapprochement
verrouille les comptes dont le quota ou la durée est épuisé. Le nouveau service
`abess-session-guard` vérifie les sockets SSH authentifiés, l’identité système,
le groupe géré et l’heure de création des processus.

Le mode initial des anciens serveurs reste **Observation**, pour ne pas casser des
usages mobiles existants. Le Super Admin peut activer « Refuser les nouvelles
sessions excédentaires » dans Parc & migrations. Les sessions antérieures à cette
activation sont préservées et consomment de la capacité ; les nouvelles sessions
au-delà de la limite sont fermées. Le contrôleur ne signale aucun processus root,
ni un PID réutilisé, ni un utilisateur hors du groupe géré. Une politique périmée
n’autorise aucune fermeture. L’interface distingue la politique demandée de la
présence réellement confirmée du contrôleur.

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
