# ABESS VPN — distribution multiclient et mise à niveau de sécurité

## Objectif

ABESS VPN Server Panel est un **panneau commercial indépendant des applications VPN**.
L'application ABESS VPN n'est pas obligatoire : les revendeurs peuvent délivrer des
profils VLESS à leurs clients pour les logiciels compatibles, ou distribuer des
comptes SSH déjà provisionnés par un fournisseur.

Le panneau ne doit jamais prétendre avoir créé ou arrêté un utilisateur sur un
VPS tiers sans retour positif d'un provisionneur de confiance.

## Abonnements VLESS portables

Pour une nouvelle licence, l'API revendeur retourne `subscriptionUrl`, par exemple
`/sub/<secret-aléatoire>`. Ce secret de 256 bits est **distinct** du code commercial
`token` et de l'UUID VLESS. Ne pas publier ce lien dans un catalogue public.

- `GET /sub/<secret>` : portail HTML pour navigateur, abonnement Base64 pour
  les clients VPN reconnaissables.
- `GET /sub/<secret>?format=raw` : URI VLESS standard en texte brut.
- `GET /sub/<secret>?format=base64` : abonnement VLESS Base64.
- `GET /sub/<secret>?format=sing-box` : configuration sing-box JSON.
- `GET /sub/<secret>?format=mihomo` : configuration Mihomo / Clash Meta YAML.
- `POST /api/v1/admin/tokens/:id/rotate-subscription` : revendeur autorisé
  ou administrateur, invalide immédiatement l'ancien lien et retourne le nouveau.

Les exports sing-box et Mihomo sont volontairement limités aux transports
`ws`, `grpc` et `tcp`. Les autres profils renvoient 422 : ne pas exporter un
transport non testé comme une connexion fonctionnelle.

**Migration des anciennes licences :** les licences antérieures restent
temporairement accessibles avec `/sub/<code-commercial>` jusqu'à leur première
rotation manuelle. Distribuer ensuite le nouveau `subscriptionUrl` au client.
La rotation du lien n'annule pas l'UUID VLESS déjà importé : pour révoquer une
personne qui possède déjà l'UUID, il faut **agir sur le serveur VPN**.

## Dossier d'adhésion : preuve de possession obligatoire

`POST /api/v1/membership/request` renvoie maintenant `claimSecret` **une seule
fois à la création ou mise à jour** et `request.id`. Le client doit stocker les
deux de manière sécurisée (stockage protégé de l'application), sans journaliser
`claimSecret`.

Lire le statut :

```http
GET /api/v1/membership/status?request_id=req_UUID
X-Claim-Secret: <claimSecret-obtenu-lors-de-la-demande>
```

Le backend stocke uniquement le hash SHA-256 de cette preuve. La présence du
`device_id` ou d'un `request_id` sans preuve n'autorise plus la récupération
des identifiants. Une mise à jour de la demande invalide l'ancien `claimSecret`.

**Changement incompatible :** les anciens clients Android doivent être mis à
jour pour transmettre ce nouvel en-tête. Les anciens dossiers sans secret
doivent être déposés de nouveau ou traités manuellement par un administrateur.

## Revendeurs et fournisseurs SSH

`POST /api/v1/admin/ssh/accounts` autorise désormais un revendeur authentifié
à enregistrer **un compte déjà créé chez un fournisseur**. Il choisit les
paramètres exacts du fournisseur et paie en crédits commerciaux.

- Le revendeur ne peut pas importer un compte `nodeId` lié à un VPS administré.
- Il ne peut pas faire payer un autre revendeur avec `resellerId`.
- L'import ne crée **aucun** utilisateur SSH sur le serveur du fournisseur.
- Les identifiants sensibles sont chiffrés au repos ; l'export reste authentifié
  et audité.
- Le quota SSH du panneau est un quota **commercial** jusqu'à vérification et
  application côté fournisseur.

## Couper les accès réellement : intégration VPS requise

Le backend publie l'inventaire authentifié
`GET /api/v1/nodes/:id/config` : `enabled`, `expiresAt`, quotas et UUID/SSH.
Les statistiques arrivent par heartbeat dans le sens VPS → panneau.

**Pas encore réalisé :** provisionner et révoquer automatiquement des utilisateurs
sur un VPS tiers. L'agent fourni n'exécute aucune action distante ; les accès
déjà établis ne sont pas automatiquement interrompus quand `enabled=false`.
Avant de vendre une suspension immédiate ou un quota strict, installer une
intégration côté VPS et réaliser les tests suivants :

1. Créer un utilisateur Xray via une API/agent autorisé, constater sa présence
   dans le moteur, puis ouvrir un vrai tunnel dans une application tierce.
2. Dépasser son quota, constater que le serveur refuse ou interrompt ses accès.
3. Suspendre/expirer la licence, constater la révocation effective dans Xray
   **sans dépendre de la consultation du lien d'abonnement**.
4. Renouveler puis constater le retour de l'accès et des compteurs cohérents.
5. Redémarrer le panneau, le VPS et l'agent ; vérifier que la politique reste
   appliquée.
6. Reproduire ces scénarios pour chaque fournisseur SSH dont on possède une
   API : sinon indiquer le statut « intervention fournisseur requise ».

Les limites d'appareils fondées sur l'identifiant de l'application ABESS ne
peuvent pas être garanties dans les applications tierces.

## Sauvegardes

Les quatre anciens endpoints non chiffrés
`/api/v1/admin/backup`, `/api/v1/admin/backup/restore`,
`/api/v1/admin/system/backup`, `/api/v1/admin/system/restore`
renvoient désormais 410. Utiliser uniquement :

- `GET /api/v1/admin/operations/backup` : enveloppe authentifiée chiffrée.
- `POST /api/v1/admin/operations/restore` : restauration chiffrée.

Vérifier les copies non chiffrées historiques et les supprimer de manière
sécurisée suivant la politique de rétention.

## GitHub Actions et protection de production

L'action de déploiement exige désormais
`VPS_SSH_KNOWN_HOSTS`, une entrée `known_hosts` du VPS vérifiée **hors du job**
(console du fournisseur, fingerprint validé sur la machine). Ne jamais copier
aveuglément la sortie réseau d'un `ssh-keyscan` comme preuve d'identité.

Préférer le secret `VPS_SSH_KEY`. Si une clé et un mot de passe sont présents,
la clé est prioritaire.

**À effectuer dans les paramètres GitHub (accès propriétaire requis) :**
protéger `main`, exiger une pull request, le job `verify`, au moins une revue,
et limiter l'autorisation du déploiement de production.

## APK

Les APK factices ne sont plus distribués : le service exige un fichier
significatif au format ZIP/APK. Le hash SHA-256 affiché est calculé réellement.
Cela ne remplace **pas** une vérification de signature Android ni une publication
de la véritable application signée depuis son projet de build.

## Éléments demandant un travail d'infrastructure distinct

- Provisionneur Xray/SSH multi-fournisseurs avec contrôle et coupure réels.
- Refactorisation transactionnelle de PostgreSQL (verrou global et réponses
  mises en mémoire dans `modules/store.ts`) après tests de charge.
- Limitation distribuée via Redis ou PostgreSQL en multi-instance.
- Publication de l'APK Android signé et mise à jour de l'application pour
  `X-Claim-Secret`.
- Protection de `main` dans les paramètres GitHub du dépôt.

Ne pas annoncer ces éléments comme terminés à la fusion de la PR.
