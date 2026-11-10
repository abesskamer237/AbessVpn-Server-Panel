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
