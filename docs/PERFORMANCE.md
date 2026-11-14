# Mesures et optimisation du débit VPN

Les réglages TCP sont appliqués avec `scripts/tune-vpn-network.sh` et le workflow
`Improve VPN TCP transport`. Ils ne redémarrent ni la passerelle existante ni les
sessions actives. BBR est sélectionné uniquement s’il est disponible ; la détection
automatique des trous noirs MTU est activée si elle était désactivée. Les limites
de crédit, de quota et les identifiants restent inchangés.

Les valeurs initiales sont conservées dans
`/var/lib/abess-network-tuning/original.conf`. Retour aux valeurs initiales :

```sh
sudo sysctl -p /var/lib/abess-network-tuning/original.conf
sudo rm -f /etc/sysctl.d/90-abess-tcp.conf
```

Les nouveaux réglages TCP concernent surtout les nouvelles connexions : déconnecter
puis reconnecter le client avant de comparer. Sur Orange Cameroun, faire trois
mesures avec VPN et trois sans VPN, au même endroit et sur le même serveur de test.
Noter débit descendant, débit montant, ping, heure et type de couverture mobile.
Un téléchargement depuis le VPS mesure une autre route et ne prouve pas le débit
atteignable par un téléphone Orange.

L’observateur des consommations filtre désormais les sockets SSH dans le noyau,
avant de lire leurs compteurs, au lieu d’énumérer toutes les connexions transférées.
Il continue d’exclure les sockets sortants et de conserver les bornes de comptage
pour éviter les doublons après redémarrage de l’observateur.

Mesures du 14 novembre 2026 : VPS de 4 cœurs, mémoire disponible supérieure à 4 Go,
environ 8 700 connexions TCP ; RTT médian observé de 168 ms. Des téléchargements
bornés ont donné environ 30 Mbit/s vers Cloudflare et 4,3 Mbit/s vers OVH. Les
transferts, tailles et routes diffèrent : ces chiffres ne constituent pas une
preuve de gain avant/après. Des retransmissions étaient présentes. Une éventuelle
limite opérateur, la distance et le routage restent à mesurer côté client.

## Sessions mobiles abandonnées

Le contrôle du 14 novembre a relevé `ClientAliveInterval 15` et
`ClientAliveCountMax 9999` sur le SSH existant. Le workflow
`Improve VPN session stability` ajoute un bloc final `Match User abv_*` :
intervalle de 30 secondes et 6 réponses manquantes au maximum. Les futures
sessions VPN devenues injoignables sont ainsi fermées après environ trois
minutes, sans changer les délais du compte d’administration.

Le script valide la syntaxe et les valeurs effectives avec OpenSSH, sauvegarde
la configuration puis recharge SSH. Il ne redémarre pas la passerelle et ne
ferme pas les sessions déjà ouvertes. Ces dernières doivent être reconnectées
pour bénéficier des nouveaux délais. Ce changement nettoie les sessions mortes ;
il ne réduit pas la latence du trajet Orange Cameroun et ne fixe aucun débit
minimal. La configuration initiale se trouve dans
`/var/lib/abess-network-tuning/sshd_config.original`.

## TCP du HTTPS public dans Docker

Caddy termine le TLS dans son propre espace réseau. Le script d’optimisation
vérifie donc aussi les réglages TCP de ce conteneur et les applique avec
`nsenter`, sans le redémarrer. Le choix est conservé dans la variable non secrète
`VPN_TCP_CONGESTION_CONTROL` du `.env` et dans les paramètres `sysctls` de Compose
pour les prochains démarrages. La configuration initiale de cet espace réseau
est sauvegardée dans `/var/lib/abess-network-tuning/caddy-original.conf`.
Les sessions publiques déjà ouvertes conservent leur algorithme TCP : reconnecter
le client pour bénéficier du changement.
