# Audit du 10 novembre 2026

## Corrections livrées

| Constat | Correction | Validation |
| --- | --- | --- |
| Identifiants de démonstration visibles sur la connexion | Suppression des boutons, mots de passe et adresse personnelle affichés | Connexion réelle dans Chromium |
| Hôte/SNI obsolètes dans les nouveaux profils | Champs initiaux vides, à configurer explicitement | Compilation TypeScript et panneau |
| Déconnexion uniquement locale : le jeton restait valide 24 h | Route POST /api/v1/auth/logout et appel depuis le panneau | Ancien jeton refusé après déconnexion, API et Chromium |
| Boucle infinie possible avec une hiérarchie cyclique de revendeurs | Détection des cycles et parents absents à la connexion ; parcours descendant itératif avec ensemble de visites | Tests de régression avec données corrompues |
| Restauration acceptant une hiérarchie invalide | Validation préalable des utilisateurs, identifiants/emails uniques, crédits finis, administrateur actif et liens parents ; révocation des sessions après restauration | Rejet sans modification du fichier utilisateurs, sur les deux routes |
| Échec de démarrage laissant le processus actif | Sortie avec code 1 | Test avec domaine absent |
| Fichier Xray résiduel assimilé à un moteur opérationnel | Heartbeat de statistiques de même génération, datant de moins de 15 secondes, pour le ping, la télémétrie et les diagnostics | Tests de génération différente, heartbeat absent et périmé |
| CORS ne couvrant pas le port du serveur de développement intégré | Autorisation des origines loopback du PORT en développement | Vérification de configuration ; production conserve sa liste explicite |
| Installations Docker/CI non verrouillées | npm ci et copie du package-lock dans l'image | Installation locale verrouillée réussie ; workflows YAML valides |
| Métadonnées promettant des protocoles/essais non provisionnés | Description centrée sur VLESS et Xray | Build du panneau |

## Vérifications exécutées

- `npm ci`, `npm run lint`, `npm run build`, `npm run build:server` : réussis.
- Suite API intégrée dans `.github/workflows/verify.yml` : exécutée contre une instance isolée ; succès pour licences, permissions, confidentialité, persistance et génération Xray.
- `node scripts/test-security.mjs` : succès ; ajouté aux workflows de vérification et de déploiement.
- `node scripts/rotate-master-secret.mjs --self-test` : succès AES-GCM, compatibilité AES-CBC, sauvegarde chiffrée et suppression des anciens secrets SSH.
- Chromium/Playwright : écran de connexion, connexion administrateur, chargement du panneau et déconnexion avec révocation serveur ; aucune erreur JavaScript observée.
- `npm audit` : aucune vulnérabilité connue signalée pour le verrou installé, sans garantie d'absence de défaut applicatif.
- Docker Compose : configuration valide avec fichier d'exemple temporaire, supprimé après vérification.
- Xray officiel 26.7.28 : configurations générées vide et avec licences acceptées par `xray run -test`.
- Watcher Xray : syntaxe shell valide.
- Caddy : adaptation et validation de la configuration réussies avec Caddy 2.
- Image API Docker : construction réussie via un Dockerfile temporaire montant le certificat du proxy comme secret BuildKit. TLS reste vérifié ; le certificat n’est pas copié dans l’image. Démarrage du conteneur et requête fonctionnelle `/api/v1/ping` réussis ; le moteur absent est correctement signalé `not-ready`.

## Limites et actions restantes

Le build du sidecar Xray est bloqué par le refus réseau de `dl-cdn.alpinelinux.org`. Le téléchargement Flutter est bloqué sur `storage.googleapis.com`. La lecture puis l'enregistrement du brouillon cloud ont échoué (`INVALID_ARGUMENT`) : la persistance des instructions n'est pas confirmée.

Cet audit ne valide pas un déploiement VPS réel, l'obtention de certificats publics, le bot Telegram avec ses identifiants, les achats/paiements externes, ni un tunnel Android de bout en bout. Vérifier sur appareil réel le changement d'IP, les compteurs, l'expiration et l'épuisement de quota après avoir débloqué les dépendances. Aucune infrastructure distante ni donnée de production n'a été modifiée.

Les fichiers JSON de persistance restent une limite architecturale : les écritures sont atomiques par fichier, mais une restauration répartie sur plusieurs fichiers n'est pas une transaction de base de données. Prévoir une migration transactionnelle avant un déploiement multi-instance.

## Améliorations de l’interface et tests avant publication sur main

La connexion dispose d'une présentation à deux colonnes adaptée au mobile, d'une identité bleu nuit/émeraude et de champs accessibles avec autocomplétion. Le tableau de bord accueille l'utilisateur, affiche la synchronisation réelle, propose une actualisation manuelle et signale les erreurs API. Les chiffres de démonstration ont été remplacés par des états d'attente. Les cartes, onglets, focus clavier, contrastes du thème clair et transitions ont été harmonisés. Les animations respectent `prefers-reduced-motion`.

Une suite Playwright reproductible a été ajoutée : `npm run test:panel` (installer Chromium via `npx playwright install chromium`, ou définir `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` sur un Chromium déjà installé). Elle démarre son propre serveur et un stockage temporaire ; les seuls appels substitués concernent le service Git externe et le scénario volontaire d'erreur de statistiques. Les tests vérifient l'authentification réelle, la révocation serveur, la navigation, le mobile dans les deux thèmes, le clavier, la visibilité du mot de passe, les mouvements réduits et la gestion d'erreurs. **4 tests réussis** dans Chromium. Le workflow de vérification les exécute également.

Les instructions cloud et le helper de build TLS sont désormais versionnés dans `docs/CLOUD_ENVIRONMENT.md` et `scripts/build-cloud-api.sh`.

## Lot plateforme : PostgreSQL, sécurité, règlements manuels et exploitation

Les limitations de persistance signalées dans l’audit initial sont remplacées par une migration PostgreSQL transactionnelle. La base conserve actuellement des documents JSONB par agrégat ; elle n’est pas présentée comme un schéma relationnel entièrement normalisé. Les opérations sont sérialisées pour assurer la cohérence, et le contrôleur reste une instance active. Voir `docs/OPERATIONS.md` pour les capacités et limites de montée en charge.

### Livré

- Migration PostgreSQL non destructive des sources JSON, rôle applicatif non superutilisateur, commits couvrant crédits/licences/historiques, rollback et journal HMAC append-only.
- TOTP avec protection contre le rejeu, codes de récupération à usage unique, secrets MFA chiffrés, sessions hachées persistantes/révocables, mot de passe modifiable et cookie HttpOnly/SameSite Strict/Secure. Le jeton du panneau n’est plus persisté dans localStorage.
- Demandes de crédits avec règlement manuel MTN MoMo / Orange Money. Les montants XAF viennent des offres serveur ; la référence déclarée ne crédite rien. Seul un Super Admin peut confirmer le montant et la référence réellement reçus. Références dédupliquées, confirmations idempotentes et factures imprimables. Aucune passerelle automatique intégrée.
- Renouvellements idempotents et migration d’une licence vers un profil TLS. VLESS/TCP non chiffré est désactivé par défaut, sans port public 10050 dans le Compose sécurisé.
- Sauvegardes AES-GCM vérifiées, copie S3 HTTPS optionnelle, restauration HTTP et CLI transactionnelle avec révocation des sessions et conservation/import de la chaîne d’audit.
- État de santé, métriques protégées, alertes HTTPS signées, configurations Prometheus/Blackbox pour disponibilité/disque/expiration TLS.
- Agent de nœud distant, configurations limitées aux licences affectées, compteurs dédupliqués par génération, révocation et arrêt après 60 secondes sans contrôle.
- Déploiement avec archives/pg_dump chiffrés, préservation des secrets opérationnels et rollback d’images pour les installations PostgreSQL déjà compatibles. Première migration JSON à traiter en maintenance.
- Actions GitHub épinglées à leurs commits, mises à jour de dépendances proposées par Dependabot et tests enrichis dans les workflows.

### Preuves exécutées dans ce cloud

- Installation npm verrouillée, TypeScript, builds React/serveur, tests de sécurité et auto-test historique de rotation : réussis.
- Suite de contrat API existante, incluant les permissions de branches revendeurs et la compatibilité TCP explicitement activée dans son environnement isolé : réussie. Le nouveau test plateforme vérifie séparément le refus TCP par défaut.
- Tests PostgreSQL : migration, rollback, 16 opérations concurrentes, session conservée après redémarrage et exercice de restauration chiffrée hors ligne : réussis.
- Bootstrap PostgreSQL avec rôle non superutilisateur : réussi, sans droits de création de rôles/bases. Image API finale démarrée en lecture seule, capacités Linux retirées : ping et coordonnées de règlement vérifiés avec ce rôle.
- Tests plateforme : vecteur RFC TOTP, rejeu, récupération, montant incorrect refusé, absence de crédit automatique, référence non réutilisable, double crédit empêché, MFA API, renouvellement, isolation des nœuds, quota distant et révocation des sessions : réussis.
- **6 tests Chromium** : connexion/déconnexion, mobile/thèmes, clavier/mouvements réduits, erreurs API, nouvelles pages protégées et enrôlement MFA avec connexion par code de récupération : réussis.
- Binaire officiel Xray 26.7.28 : trafic VLESS réel dans un benchmark Docker privé, hausse des compteurs, épuisement de quota et refus après rechargement : réussis. Le benchmark autorise seulement son serveur HTTP privé dans sa copie de test ; les règles de production restent inchangées.
- Archive de volume chiffrée : récupération réussie et rejet d’une archive altérée, sans conserver de plaintext sur échec.
- Promtool : configuration et règles de supervision valides.

### Services et validations non activés

Le règlement est volontairement manuel avec les coordonnées fournies : MTN MoMo 681328753 — manga Ghislain ; Orange Money 695140419 — mengue belinga. Aucune intégration automatique n’est incluse. La destination S3 n’est pas configurée : aucun upload distant réel n’est annoncé comme réussi. Les notifications, certificats et nœuds des VPS doivent être vérifiés sur leurs infrastructures.

Les tests de trafic locaux ne remplacent pas la recette Android sur téléphone ni les tests DNS/IPv6, batterie et changements de réseau. Le téléchargement du SDK Flutter reste bloqué dans ce cloud. Le nombre d’appareils enregistré par l’API ne constitue pas une attestation matérielle contre le clonage d’un UUID : aucun mécanisme d’attestation externe n’est prétendu actif.

La clé maître reste stable. Une rotation PostgreSQL requiert une migration dédiée des liens, MFA et audit ; le script JSON historique ne doit pas être utilisé à cette fin. Ne pas considérer cette livraison comme une certification de sécurité ou une validation du paiement en production.

Les tests de confirmation manuelle sur PostgreSQL couvrent également quatre confirmations concurrentes d’une même commande, le refus d’une validation par un revendeur et le refus de réutiliser une référence pour une autre commande.

## Service SSH et client Android 2.5.0

Ajout d’une passerelle SSH 2 indépendante (bibliothèque `ssh2`) et d’un espace **Comptes SSH** Super Admin : création, expiration, quota, connexions simultanées, suspension, suppression, état réel, recherche et export audité. SSH TCP sur 2222 et WebSocket/TLS sur 443/2084 avec `/ws-ssh`. Aucun code propriétaire X-net réutilisé, aucun utilisateur Linux créé, aucun changement du SSH d’administration, aucun accès au socket Docker. Les restrictions et différences avec X-net sont documentées dans `docs/SSH.md`.

Le service tourne non privilégié dans un conteneur séparé. Mots de passe aléatoires chiffrés dans PostgreSQL, vérificateurs scrypt projetés, empreinte SHA-256 persistante, rejet du shell et des destinations privées, contrôle périmé fermé après 30 secondes. Les comptes sont inclus dans les sauvegardes chiffrées et le volume de clé SSH est archivé avant les déploiements suivants.

Tests exécutés : passerelle et API dans un réseau Docker isolé, trafic TCP réel, HTTP Upgrade brut et WebSocket encadré, export sans fuite dans les listes, rôle revendeur refusé, mauvaises authentifications, limite simultanée, accès privé/mappé IPv6 refusé, commande système refusée, suspension, quota persistant, redémarrage et contrôle périmé. **7 tests Chromium réussis**, dont le générateur SSH et son état indisponible réel. TypeScript, image Docker et configuration Caddy validés. Voir le dépôt Android pour les tests du client Dart et de sa chaîne Xray/SOCKS/SSH.

Le test SSH utilise également le vrai Caddyfile de production dans un réseau isolé, avec une autorité locale de test explicitement approuvée : trafic SSH réel en WSS sur 443 et 2084 validé. Le routage du port secondaire utilise des blocs `handle` pour éviter que la réponse 404 ne masque le proxy.

## SSH-WS HTTP Upgrade brut — 2.5.4

Les scripts X-net du dépôt et du ZIP ont été comparés : même révision d’installation, backend compilé non extrait. Ajout indépendant du client HTTP Upgrade puis SSH brut (sans trames RFC6455), ports HTTP 80/85 et TLS 443/2084. L’APK conserve le mode exact dans le profil ; les anciens exports WSS encadrés restent compatibles. Le générateur utilise l’origine directe pour HTTP et le domaine certifié pour TLS. Port alternatif configurable, SSH administratif intact, API HTTP redirigée, port WS alternatif sans API, aucune copie de code propriétaire. Les comptes et restrictions existants sont réutilisés.

Tests : trafic réel à travers Caddy en HTTP et TLS, exports de chaque mode, ancienne compatibilité WebSocket, limites de connexions, quota, révocation et état contrôleur. Client Dart : en-têtes HTTP réels sans Sec-WebSocket-Key, conservation de la bannière après le 101, HTTP 200 refusé, certificat et empreinte vérifiés, chaîne Xray/SOCKS/SSH réelle avec HTTP et DNS. Recette Android sur appareil nécessaire pour valider le réseau mobile et la veille.
