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
