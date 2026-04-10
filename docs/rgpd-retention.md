# Politique de rétention des données — CoursPool

## Durées de conservation

| Catégorie de données | Durée de rétention | Justification |
|---|---|---|
| Compte utilisateur actif | Pendant toute la durée d'utilisation | Nécessité contractuelle |
| Compte inactif (aucune connexion) | 3 ans après dernière activité | Prescription commerciale |
| Données de réservation et paiement | 5 ans après la transaction | Obligation comptable/fiscale |
| Messages entre utilisateurs | 2 ans après envoi | Résolution de litiges |
| Documents KYC (CNI, diplôme, casier) | 1 an après vérification | Durée minimale nécessaire |
| Logs de sécurité (IP, tentatives login) | 12 mois | Détection d'intrusion |
| Données de notation | Durée de vie du profil prof | Intégrité du système |

## Suppression automatique

Aucune suppression automatique n'est implémentée en v1. La suppression est déclenchée :
- Par l'utilisateur via le bouton "Supprimer mon compte" (endpoint `DELETE /users/:id`)
- Par un admin depuis le dashboard

## Droits RGPD disponibles

- **Droit d'accès & portabilité** : `GET /users/me/export` — télécharge toutes les données en JSON
- **Droit à l'effacement** : `DELETE /users/:id` — supprime profil, cours, réservations, messages, follows
- **Droit de rectification** : `PATCH /users/me` — modification du profil

## À faire en v2

- Mise en place d'une suppression automatique des comptes inactifs depuis 3 ans
- Email de rappel 30 jours avant suppression automatique
