# Vérification des consommations réelles

Le compteur facture les octets du flux SSH chiffré après admission PAM, dans les deux sens. Il inclut donc les en-têtes, le chiffrement et les messages de contrôle SSH ; il ne correspond pas exactement à la taille d’un fichier téléchargé. Les en-têtes TLS et les trames WebSocket ne sont pas ajoutés à ce compteur. Un volume ne dépend ni du temps connecté ni d’une estimation de débit.

Le workflow `Verify real VPN consumption` utilise une licence administrateur temporaire et un serveur de transfert accessible uniquement sur le loopback du VPS. Aucun crédit revendeur n’est prélevé. Les certificats TLS et la clé SSH du VPS sont vérifiés.

La sonde ouvre simultanément SSH brut sur l’origine et SSH WebSocket via le CloudFront exporté. Elle compte les octets SSH indépendamment côté client, transfère 8 Mio en réception et 4 Mio en envoi avec vérification SHA-256, puis compare les différences exactes avec chaque direction des appareils et le total de la licence. Elle vérifie aussi l’absence de consommation inventée au repos, la convergence de l’API, l’historique quotidien sans doublon, le remboursement des réservations inutilisées à la fermeture normale et la conservation des compteurs lors d’une reconnexion. Une seconde licence vérifie la coupure au quota exact, le refus des sessions excédentaires et la suspension/réactivation d’un appareil.

Le relais ne redémarre pas pendant ces sondes. Les licences, sessions d’administration de contrôle et le serveur temporaire sont supprimés à la fin.

Les compteurs sont cumulatifs. L’historique commence à une mesure initiale : une consommation antérieure sans observations datées n’est pas répartie artificiellement entre les jours. L’agent publie ses mesures périodiquement ; le panneau s’actualise automatiquement et propose aussi une actualisation manuelle.

Les réservations durables empêchent de récupérer du quota en arrêtant brutalement le processus : après un arrêt non propre, une réserve inutilisée peut être imputée (au maximum un bloc partagé de 1 Mio par licence dans le relais natif, limité par le quota restant). Les tests de fermeture normale vérifient explicitement qu’aucune réserve inutilisée n’est facturée dans ce cas. Une exactitude au dernier octet reçu par l’application après une panne électrique n’est pas garantie.

L’affichage conserve les valeurs inconnues comme « Non mesuré », présente les petits transferts en octets/Ko/Mo et additionne les octets avant d’arrondir les totaux revendeur. Une absence de trafic actualise l’observation sans créer de volume supplémentaire dans l’historique.
