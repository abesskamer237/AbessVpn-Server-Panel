# Règlement manuel — MTN MoMo et Orange Money

Aucune passerelle ni API de paiement automatique n’est intégrée. L’application n’exécute ni prélèvement ni code USSD.

| Canal | Numéro | Bénéficiaire |
| --- | --- | --- |
| MTN MoMo | 681328753 | manga Ghislain |
| Orange Money | 695140419 | mengue belinga |

## Comptes du panneau

1. Le revendeur crée une demande de recharge depuis une offre. Le montant XAF et les crédits viennent du serveur et restent attachés à cette demande.
2. Il vérifie les coordonnées et le bénéficiaire dans son application mobile money, puis effectue lui-même son transfert.
3. Il soumet le canal utilisé et sa référence de transaction. La demande passe en attente de vérification ; **aucun crédit n’est ajouté**.
4. Un Super Administrateur vérifie indépendamment la réception effective sur le compte bénéficiaire, le montant et la référence. Il renseigne ces éléments et confirme explicitement la vérification dans le panneau, ou refuse avec un motif.
5. PostgreSQL valide ensemble le crédit, l’état de commande et l’historique. Les confirmations répétées ne créditent pas deux fois et une même référence ne peut pas financer deux commandes.
6. Une facture imprimable est disponible après confirmation. Compléter les informations et mentions fiscales du vendeur selon son statut légal.

Une référence fournie, un SMS ou une capture d’écran ne remplace jamais la vérification du compte bénéficiaire. L’administrateur garde la responsabilité de cette vérification manuelle ; le serveur ne prétend pas interroger les opérateurs.

## Clients APK

La page Outils présente les mêmes coordonnées et permet de les copier ou de contacter le support. Le client convient du montant avec son revendeur, règle manuellement et transmet sa référence. La licence est fournie ou renouvelée après vérification. Les paiements ne créent pas de tokens depuis une route mobile publique.

## Tests

Les tests vérifient les coordonnées exactes, l’absence de crédit sur déclaration, le rôle administratif requis, le montant exact, les références dédupliquées et quatre validations concurrentes ne produisant qu’un seul crédit. Ils simulent la vérification administrative et ne réalisent aucun transfert d’argent.
