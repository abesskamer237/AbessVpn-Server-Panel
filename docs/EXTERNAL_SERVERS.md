# Serveurs externes configurés manuellement

Le panneau gère les données commerciales et les exports client. Il ne crée, ne démarre, ne recharge ni n'arrête un moteur VPN, un compte système SSH ou un proxy de tunnel. Le Compose central contient PostgreSQL, l'API et Caddy pour le panneau HTTPS. Le Compose de nœud ne contient qu'un agent de statistiques, sans port entrant et avec un montage de statistiques en lecture seule.

## Association

1. Configurer le VPN et ses utilisateurs indépendamment, sur chaque VPS. Conserver ses volumes et ses services existants.
2. Enregistrer le VPS dans **Exploitation**. Conserver son ID et sa clé unique dans un gestionnaire de secrets. Chaque clé ne peut transmettre que les relevés du VPS correspondant.
3. Enregistrer le profil dans **Infrastructure**, avec l'hôte du VPS, le port public réel, le chemin ou service gRPC, le Host HTTP et le SNI du certificat présenté par ce VPS. Le SNI peut différer du domaine du panneau. L'association au nœud utilise l'hôte du profil, identique à l'hôte enregistré.
4. Créer la licence avec l'UUID de l'utilisateur VLESS déjà configuré et, si nécessaire, son **Identifiant trafic** (email/nom de compteur dans Xray). Sans UUID fourni, une identité de licence est générée et doit être associée manuellement au VPN existant. Aucun utilisateur ni listener distant n'est créé. Un UUID ou identifiant de compteur ne peut pas être attribué à deux licences du même VPS.
5. L'export et l'abonnement reprennent uniquement le transport configuré. Ils ne proposent pas d'autres listeners supposés. Les snapshots de profils conservent les paramètres des licences existantes.

VLESS WS, gRPC, HTTPUpgrade et XHTTP utilisent TLS avec vérification du certificat. VLESS/TCP sans TLS reste désactivé sauf `ALLOW_INSECURE_TCP=true`. Le panneau ne déploie aucun protocole supplémentaire.

## API de statistiques

Un exporteur externe peut envoyer directement :

```http
POST /api/v1/nodes/ID/heartbeat
Authorization: Bearer CLE_DU_NOEUD
Content-Type: application/json
```

```json
{
  "ready": true,
  "version": "exporter-1",
  "snapshot": {
    "generation": "identite-stable-du-processus-vpn",
    "observedAt": "2026-11-12T05:00:00.000Z",
    "stat": [
      {"name": "user>>>client@example.test>>>traffic>>>uplink", "value": "1048576"},
      {"name": "user>>>client@example.test>>>traffic>>>downlink", "value": "2097152"},
      {"name": "user>>>client@example.test>>>online", "value": "1"}
    ],
    "accounts": [
      {"id": "ssh_identifiant_du_panneau", "usedBytes": 4096, "online": 1}
    ]
  }
}
```

L'exemple de date doit être remplacé par l'heure réelle de la mesure. Les compteurs sont des octets cumulatifs non négatifs, entiers sûrs (ou chaînes représentant un entier sûr pour `stat`). `stat` est obligatoire ; il peut être vide pour un relevé SSH. Les compteurs Xray sont obtenus avec son API StatsService, sans remise à zéro (`xray api statsquery --server=127.0.0.1:10085 -pattern 'user>>>'`) ; l'exporteur ajoute `generation` et `observedAt`. Garder cette API privée, avec les permissions propres au VPS. Le panneau accepte l'identifiant trafic configuré, le nom historique `abess-<id licence>`, ou l'UUID comme nom de compteur selon l'identité de la licence.

`generation` doit rester identique pendant toute la vie des compteurs et changer seulement lors d'une remise à zéro réelle du moteur. Ne pas utiliser l'heure de chaque requête comme génération. Les directions absentes d'un relevé partiel conservent leur baseline. Un compteur qui diminue dans une même génération est rejeté ; les valeurs, noms dupliqués et relevés invalides sont rejetés avant modification des consommations. Un relevé exact répété ne débite pas deux fois, y compris après redémarrage du backend. Les baselines et consommations sont persistées transactionnellement avec PostgreSQL.

Les mesures de plus de 60 secondes, de plus de 5 secondes dans le futur, antérieures au dernier relevé ou modifiées à timestamp identique sont refusées. La disponibilité expire après 60 secondes sans mesure fraîche. Une requête sans `snapshot` peut signaler `ready:false` sans ajouter du trafic. Un relevé du VPS A ne peut pas débiter les licences ou comptes SSH du VPS B. La première mesure d'une génération inclut les octets cumulés de cette génération : lors d'un import historique, préparer les valeurs/baselines avec l'opérateur avant facturation.

Les relevés doivent provenir du moteur ou de son exporteur de confiance ; la télémétrie du téléphone ne constitue pas une source de facturation. La clé d'un nœud autorise la déclaration de ses compteurs et doit être protégée comme un secret. Sa révocation bloque immédiatement les nouvelles requêtes de cet agent.

## Agent de remontée facultatif

Configurer les variables dans un environnement sécurisé, sans les inscrire dans Git :

- `CONTROL_API_BASE_URL` : origine HTTPS du panneau, sans chemin.
- `VPN_NODE_ID`, `VPN_NODE_KEY` : identité du VPS enregistrée dans le panneau.
- `STATS_FILE` : fichier JSON fourni par un exporteur externe, avec la forme de `snapshot` ci-dessus.
- Ou `STATS_API_URL` : endpoint HTTPS retournant ce même JSON ; `STATS_API_TOKEN_FILE` peut désigner un fichier contenant le jeton propre à cette API. La clé du panneau n'est jamais envoyée à l'API de statistiques.

Exécuter `node scripts/node-agent.mjs`. Il lit et transmet un relevé toutes les cinq secondes. Il ne réécrit ni le relevé ni les configurations VPN, ne récupère pas de configuration serveur et ne commande aucun service. Une source indisponible ou périmée produit `ready:false`. Les redirections HTTP sont refusées et la vérification TLS reste activée.

Pour le lancer en conteneur, définir aussi `VPN_STATS_DIR` (répertoire contenant `snapshot.json`), puis utiliser `docker compose -f docker-compose.node.yml up -d --build agent`. Le répertoire est monté en lecture seule. Aucun moteur VPN n'est créé par ce Compose. Publier les snapshots atomiquement depuis l'exporteur pour éviter une lecture partielle.

## Licences, quotas et application des restrictions

`GET /api/v1/nodes/ID/config`, avec la clé du nœud, conserve l'ancienne route mais retourne désormais `format: abess-external-inventory-v1`, l'hôte, les licences et comptes SSH de ce seul VPS. Il ne retourne ni inbounds, ni configuration exécutable, ni mot de passe SSH, ni token mobile. Les entrées contiennent les identifiants, compteurs, limites, expiration et un booléen `enabled`. Un quota dépassé conserve les octets réellement consommés au-delà de la limite ; aucune consommation n'est fabriquée ou plafonnée pour masquer le dépassement.

Le backend refuse les nouvelles validations et distributions de licences inactives, expirées ou épuisées. La coupure d'une connexion déjà établie et l'application des quotas/limites de connexions dans le moteur restent la responsabilité du VPS et de son intégration externe. Un intégrateur peut consulter cet inventaire et appliquer les restrictions à son service existant. L'agent fourni ici rapporte uniquement les mesures ; il ne prétend pas couper le trafic. Une révocation de clé d'agent n'arrête aucun service VPN.

## Comptes SSH existants

Importer dans **Comptes SSH** un JSON contenant `host`, `port`, `username`, `password`, `transport`, `fingerprint` (SHA-256), et pour TLS `tls:true`, `sni`, ainsi que `path` si nécessaire. Sélectionner le VPS enregistré, le quota, la durée et la limite de connexions. L'hôte doit correspondre au VPS. Les modes sont `tcp`, `ws`, `ws-alt`, `ws-framed`, `wss-raw`, `wss-raw-alt`, `wss` et `wss-alt`. L'import enregistre les métadonnées et chiffre le mot de passe ; il ne crée aucun utilisateur sur le VPS. L'export conserve exactement le transport, port, chemin, SNI et empreinte importés. Le mot de passe n'est révélé que par l'export authentifié et audité d'un accès disponible.

La suspension/suppression modifie l'inventaire du panneau. L'intégration externe applique ces changements aux comptes existants si souhaité. Les anciens comptes locaux restent conservés en base ; réimporter leur configuration avec le nœud externe pour rétablir des exports vérifiables. Ne pas réactiver la passerelle historique.

## Passage d'une ancienne installation

Sauvegarder la base, les secrets et les volumes avant toute opération future. Le workflow de déploiement est exclusivement manuel (`workflow_dispatch`) ; un push sur `main` lance les vérifications, pas un déploiement. Un déploiement manuel futur ne lance que `database api caddy`, sans `--remove-orphans`, sans arrêt ni suppression de volumes des anciens moteurs. Planifier séparément leur migration/arrêt avec l'opérateur ; le backend ne les administre plus. Le ping du backend vérifie `ok:true` indépendamment de la disponibilité des VPS externes. Ne pas attendre `dataPlane:ready` avant d'enregistrer les agents externes.

## Vente et renouvellement SSH

L’administrateur importe les accès réels dans le formulaire SSH (ou par JSON) et choisit le revendeur. La vente débite le quota du solde de ce revendeur et inscrit une écriture `SSH_SALE`. Un solde insuffisant refuse l’import sans créer de vente. L’unicité utilisateur/VPS et les transactions PostgreSQL empêchent deux ventes concurrentes du même accès. Aucun utilisateur n’est créé sur le VPS.

Le revendeur voit ses accès et ceux de sa hiérarchie, peut les exporter, suspendre et renouveler. L’import d’infrastructure, la suppression et les clés d’agents restent réservés au super administrateur. Le renouvellement augmente le quota, prolonge l’expiration sans effacer la consommation et inscrit `SSH_RENEW`. Il exige une `Idempotency-Key` ; plusieurs requêtes simultanées identiques ne débitent qu’une fois. La réutilisation d’une clé pour un achat différent renvoie 409. L’administrateur qui renouvelle un accès vendu débite son propriétaire ; un revendeur qui renouvelle un accès de sa branche paie avec son propre solde. Les unités de nouvelles ventes SSH correspondent aux licences VLESS : 1 Go commercial = 1024³ octets. Les anciens quotas restent inchangés en octets.

Les règlements restent manuels et vérifiés par un administrateur, avec les factures existantes. Une déclaration de transfert ne recharge jamais automatiquement un compte. Le registre financier n’est plus tronqué après 1000 écritures. Les ventes, renouvellements, suspensions et exports SSH identifient leur acteur dans l’audit ; les mots de passe et payloads personnalisés sont chiffrés et absents des listes et de l’inventaire des agents. Une suspension d’un revendeur ou d’un parent désactive ses droits SSH dans l’inventaire.

`POST /api/v1/admin/nodes/ID/key` permet au super administrateur de renouveler une clé d’agent perdue ou compromise. L’ancienne clé cesse immédiatement de fonctionner ; la génération et les baselines de compteurs sont conservées pour éviter une double facturation après reconnexion. La nouvelle clé est affichée une seule fois.

## Payload TCP et WebSocket

Un import `tcp` peut inclure `payload`. Le serveur l’enregistre chiffré et le restitue exactement lors de l’export. Le client Android 2.5.5+ l’envoie avant SSH, accepte une réponse HTTP 200/101, puis exige la bonne empreinte SSH. Les transports HTTP Upgrade bruts (`ws`, `ws-alt`, `wss-raw`, `wss-raw-alt`) exigent 101 ; `ws-framed`, `wss` et `wss-alt` sont des WebSocket standard. Seuls les transports bruts/TCP acceptent un payload personnalisé. Le port, le chemin et le SNI proviennent de la configuration du VPS ; aucun proxy ni service n’est généré.

Les placeholders sont `[crlf]`, `[cr]`, `[lf]`, `[host]`, `[port]`, `[host_port]`, `[protocol]` et `[ua]`. Un payload doit commencer par une méthode HTTP, rester ASCII, ne pas contenir de NUL et ne pas dépasser 8192 caractères. Les placeholders inconnus sont refusés. Les paramètres doivent correspondre au proxy réellement exploité sur le VPS ; le panneau ne devine pas un payload fonctionnel. Pour un compte existant sans payload, le TCP reste du SSH direct.

Les changements de droits commerciaux ne constituent pas une preuve de coupure du moteur distant. L’intégration externe doit appliquer l’inventaire aux utilisateurs déjà configurés. La nouvelle version du client est nécessaire pour les payloads TCP et chemins/SNI personnalisés ; un ancien APK ne gagne pas ces capacités par une simple mise à jour du panneau.
