# Vérification du débit et de la stabilité

Le workflow **Verify VPN speed and stability** mesure le transport existant sans
redéployer ni redémarrer les services. Il crée une licence temporaire appartenant
au Super Admin (aucun débit de crédits revendeur) et un récepteur TCP privé sur
127.0.0.1. La licence, le récepteur et les identifiants temporaires sont retirés
en fin de contrôle. Un délai de sécurité de douze minutes arrête aussi le récepteur.

Un agent GitHub extérieur au VPS compare trois transferts montants et descendants
de 16 Mio par cas : SSH direct, TLS avec SSH brut, TLS avec RFC6455 et, lorsqu’elle
diffère, l’adresse réellement exportée dans les configurations clientes. Les
empreintes SSH sont épinglées et les certificats TLS vérifiés. La compression est
désactivée. L’intégrité des données synthétiques est vérifiée par SHA-256.

Le trafic synthétique est plafonné à 100 Mb/s et son budget total à 512 Mio. Les
résultats sont donc des débits observés dans ce plafond, pas un test de saturation
du VPS. Quatre transferts simultanés vérifient le partage du transport ; la latence
est aussi mesurée sous cette charge. Les sessions restent ensuite ouvertes pendant
90 secondes avec échanges, puis au moins 180 secondes sans données applicatives,
avant reprise des échanges. Aucun client ne se reconnecte automatiquement. Les
keepalives du serveur restent actifs ; ceux du client de test sont désactivés.

Le rapport hôte contient CPU, mémoire, pression CPU/disque, retransmissions TCP
dans l’espace réseau public de Caddy, erreurs d’interface, BBR, compteurs OOM et
PID/redémarrages du relais. Il n’imprime ni adresses clientes, ni secrets, ni
contenu de trafic utilisateur. Les retransmissions publiques agrègent aussi les
connexions réelles présentes pendant le contrôle.

Ce contrôle couvre un trajet Internet extérieur et la configuration du protocole.
Il ne reproduit pas le réseau radio Orange Cameroun. Une mesure avec/sans VPN sur
un téléphone Orange reste nécessaire pour confirmer le débit et la latence sur
ce dernier trajet. Il n’existe pas de référence historique comparable permettant
de chiffrer exactement une régression avant/après les changements.

`scripts/benchmark-ssh-ws.mjs` est l’ancien microbenchmark synthétique local ; ses
résultats ne doivent pas être présentés comme du débit Internet ou Orange.
