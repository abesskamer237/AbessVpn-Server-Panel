# Exploitation ABESS VPN

## Architecture et limites

Le control plane central reste une instance active. PostgreSQL conserve les agrégats métier dans `app_documents` (JSONB), les versions de migration dans `schema_migrations` et le journal chaîné dans `audit_events`. Les changements de crédits, licences, commandes et historiques sont regroupés dans une transaction. Un verrou transactionnel PostgreSQL sérialise les opérations : cette première migration privilégie la cohérence, sans prétendre à une architecture multi-maître ni à une base déjà normalisée par entité.

Les fichiers Xray partagés sont des projections régénérables après commit. Plusieurs nœuds de données sont possibles, mais pas plusieurs contrôleurs partageant sans coordination le même volume Xray. La durée de la transaction inclut encore certains appels externes : mesurer la capacité et les latences avant une montée en charge importante.

## Première migration depuis JSON

1. Prévoir une maintenance et conserver l’ancien `.env`, sa clé `MASTER_SECRET`, les volumes et les images précédentes. Ne pas supprimer de volume Docker.
2. Le workflow produit des mots de passe PostgreSQL distincts, les conserve dans le `.env` du VPS et préserve les paramètres opérationnels existants à chaque déploiement. L’API utilise `abess_app`, un rôle non superutilisateur ; le mot de passe superutilisateur est masqué dans son environnement.
3. Au premier démarrage, le serveur importe les documents existants dans une transaction. Un JSON invalide annule la migration. Les fichiers sources restent inchangés. Les démarrages suivants n’importent pas à nouveau ces fichiers.
4. Comparer les comptes, crédits, licences et historiques. Tester une création et un renouvellement, puis exporter et restaurer une sauvegarde sur une instance **isolée**.
5. Vérifier le panneau Exploitation et `/api/v1/ping`. Le déploiement attend une réponse HTTPS publique et `dataPlane: ready`.

Le schéma PostgreSQL initial et le rôle applicatif sont créés pour un volume neuf. Un volume PostgreSQL préexistant doit être examiné par son administrateur : ne jamais contourner une erreur de rôle ou de permissions en supprimant le volume.

Le mode fichiers est réservé au développement. En production sans `DATABASE_URL`, le serveur refuse de démarrer, sauf dérogation explicite `ALLOW_JSON_STORAGE=true` pour un test jetable. Ne pas utiliser cette dérogation sur le VPS commercial.

## Licences TLS et anciens profils TCP

VLESS/TCP simple ne chiffre pas le trafic. Les profils commercialisés doivent employer WS, gRPC, HTTPUpgrade ou XHTTP avec TLS et un SNI couvert par le certificat du nœud. TCP/10050 est fermé par défaut et n’est pas provisionné dans la configuration sécurisée.

Pour une ancienne licence TCP, créer un profil TLS valide puis utiliser `POST /api/v1/admin/tokens/:id/migrate-tls` avec `configurationId`. L’UUID, le quota et l’expiration sont conservés ; le client doit réimporter son token/lien. Pour une transition temporaire seulement, l’overlay `docker-compose.legacy-tcp.yml` active explicitement le transport non chiffré. Retirer cet overlay dès la migration terminée.

## Authentification et incident de compte

Dans Sécurité, configurer TOTP, confirmer un code et conserver les huit codes de récupération dans un gestionnaire de mots de passe séparé. Chaque code de récupération est à usage unique. Les secrets TOTP sont chiffrés ; les jetons de session sont conservés sous forme de condensats. Le panneau utilise un cookie HttpOnly, SameSite Strict et Secure en production. Les API Bearer restent disponibles pour les intégrations.

Après enrôlement du premier administrateur, définir `REQUIRE_ADMIN_MFA=true` pour rendre l’enrôlement obligatoire sur les opérations administratives. La page Sécurité reste accessible pour l’enrôlement. Ne pas définir `COOKIE_SECURE=false` en production : cette option sert uniquement aux tests HTTP sur loopback.

En cas de doute, révoquer les sessions, changer le mot de passe et renouveler les codes de récupération. Les changements de mot de passe et restaurations révoquent les sessions. Le bot Telegram reste une voie privilégiée indépendante : laisser désactivé sans besoin opérationnel et protéger strictement les comptes de sa liste d’administrateurs.

## Sauvegardes et restauration

Les sauvegardes quotidiennes sont authentifiées par AES-256-GCM, vérifiées avant conservation et retenues sept jours localement. Le panneau propose l’export chiffré. Configurer une clé distincte `BACKUP_ENCRYPTION_KEY` et la conserver **hors du serveur et hors des sauvegardes**. À défaut, `MASTER_SECRET` sert de clé ; elle doit aussi être conservée séparément. Une sauvegarde ne permet pas de retrouver une clé perdue.

Pour une copie hors serveur, configurer `BACKUP_S3_BUCKET`, un endpoint HTTPS S3 si nécessaire, sa région et des identifiants restreints au préfixe `abessvpn/`. Utiliser les politiques de rétention/versionnement du fournisseur. Le panneau distingue la sauvegarde locale vérifiée d’un upload réellement confirmé. Le manque de configuration S3 est affiché comme une alerte.

Pour une sauvegarde dépassant la limite HTTP, arrêter l’API et utiliser `node --import tsx scripts/restore-backup.mjs sauvegarde.encrypted.json --maintenance-confirmed` avec les mêmes clés et `DATABASE_URL`. Cette commande crée un instantané préalable chiffré, restaure les agrégats dans une transaction et révoque les sessions.

Tester périodiquement la restauration : exporter, démarrer une base/instance isolée avec les mêmes clés, importer dans Exploitation, vérifier les comptes, crédits et licences, puis tester un client. La restauration vérifie l’authenticité et l’identité de la clé maître et crée un instantané préalable. Elle ne remplace pas l’historique d’audit. Après une restauration ancienne, changer les mots de passe/codes de récupération dont l’état pourrait avoir été restauré.

Le workflow conserve aussi une archive chiffrée du volume et un `pg_dump` chiffré avant les déploiements suivants. Pour décoder une archive en maintenance :

```sh
# Fournir BACKUP_ENCRYPTION_KEY ou MASTER_SECRET via l'environnement sécurisé.
node scripts/snapshot-volume.mjs decrypt archive.enc fichier-restaure
```

Ne pas extraire ni importer une archive sur la production avant de l’avoir contrôlée sur un environnement isolé. Les anciens exports JSON en clair restent des données sensibles ; les conserver ou les retirer selon votre politique après validation de la migration.

## Déploiement et retour arrière

Le workflow accepte l’IP (`VPS_HOST`), l’utilisateur (`VPS_USER`) et le mot de passe (`VPS_PASSWORD` ou `VPS_SSH_PASSWORD`) sans secret `VPS_KNOWN_HOSTS`. Il collecte automatiquement la clé publique SSH au début de chaque déploiement, puis exige la même clé pour toutes les connexions de cette exécution. Cette découverte initiale ne vérifie pas l’identité du serveur par une source indépendante. Le mot de passe est prioritaire sur une éventuelle clé privée. Les conteneurs API et Xray utilisent un utilisateur non privilégié, un système de fichiers en lecture seule et aucune capacité Linux supplémentaire, avec leurs volumes d’état et `/tmp` séparés.

Le workflow valide les types, les tests de sécurité/plateforme, les transactions PostgreSQL, les images et le trafic Xray avant déploiement. Il conserve les secrets existants, effectue une sauvegarde protégée et vérifie la disponibilité HTTPS/Xray.

Lors d’une mise à jour d’une installation PostgreSQL déjà compatible, un échec des contrôles restaure les images API/Xray précédentes. La première migration depuis JSON ne revient pas automatiquement à un ancien serveur JSON : il pourrait diverger de la nouvelle base. En cas d’échec de cette première migration, maintenir la maintenance, examiner les journaux et restaurer le volume sauvegardé sous contrôle opérateur.

Le retour arrière du code ne remplace pas une restauration de données. Ne pas appliquer de migration destructive de schéma sans stratégie de compatibilité et sauvegarde vérifiée.

## Journal et clés

Les événements PostgreSQL forment une chaîne HMAC et un trigger refuse UPDATE/DELETE. Vérification :

```sh
node --import tsx scripts/verify-audit.mjs
```

L’ancre affichée peut être conservée hors du serveur. Ce mécanisme détecte des altérations ; il ne protège pas contre un administrateur système possédant toutes les clés et toutes les sauvegardes. La clé maître reste stable : elle chiffre les liens/MFA et signe l’audit. Le script historique `rotate-master-secret.mjs` ne traite que JSON et refuse PostgreSQL lorsqu’un `DATABASE_URL` est fourni. Ne pas tourner la clé maître PostgreSQL sans migration dédiée de ces données ; une rotation improvisée les rendrait illisibles. Les mots de passe de comptes, identifiants S3 et clés d’agents se changent séparément, avec vérification du service concerné.

## Nœuds distants

1. Enregistrer un hostname distinct dans Exploitation et conserver la clé de l’agent, affichée une seule fois.
2. Sur le VPS du nœud, configurer `CONTROL_API_BASE_URL` (origine HTTPS), `VPN_NODE_ID`, `VPN_NODE_KEY`, `VPN_DOMAIN` et `ACME_EMAIL`.
3. Exécuter `docker compose -f docker-compose.node.yml up -d --build` et vérifier DNS/TLS ainsi que les ports publics 80/443.
4. Créer un profil dont l’hôte et le SNI correspondent au nœud. Les licences affectées à ce profil sont les seules transmises à son agent.
5. Vérifier la connexion Android et les compteurs. Les compteurs reçus sont cumulatifs, rapprochés par génération pour éviter les doubles comptes. L’épuisement du quota retire l’utilisateur de la configuration suivante.

Un nœud révoqué ne peut plus récupérer de configuration. Le watcher coupe le moteur après 60 secondes sans heartbeat du contrôleur/agent. Prévoir ce délai de convergence pour la révocation et le quota ; ne pas promettre une coupure instantanée ni un quota au dernier octet.

## Supervision

Le panneau Exploitation affiche stockage, Xray, disque et sauvegardes. L’endpoint de métriques est authentifié. Les notifications HTTPS optionnelles sont configurées par `OPS_ALERT_WEBHOOK_URL` et signées dans `X-Abess-Signature` ; aucun token client n’est envoyé.

L’overlay `docker-compose.monitoring.yml` fournit Prometheus et Blackbox Exporter, avec règles de disponibilité, espace disque et expiration du certificat à 14 jours. Créer `.secrets/metrics-token` avec une valeur aléatoire d’au moins 32 caractères, mode 600, puis utiliser l’overlay avec le Compose central. Prometheus n’écoute que sur 127.0.0.1:9090 : accès par tunnel SSH. Configurer un récepteur Alertmanager si vous souhaitez distribuer les alertes Prometheus ; les règles seules n’envoient pas de messages.

## Limites de validation

Les tests Docker locaux prouvent le trafic VLESS, les compteurs et le refus après épuisement/rechargement dans un réseau de test isolé. Ils ne remplacent pas les tests TLS, DNS/IPv6, batterie et reconnexion sur un appareil Android réel. La configuration S3, les certificats publics des VPS, les notifications externes et les encaissements réels exigent leurs services et identifiants. Ne pas déclarer ces intégrations actives sans les vérifier.
