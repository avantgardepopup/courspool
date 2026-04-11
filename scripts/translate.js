#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// CoursPool — Générateur de traductions via DeepL API
//
// Usage :
//   node scripts/translate.js --key YOUR_DEEPL_API_KEY
//
// La clé gratuite DeepL (500 000 car/mois) suffit amplement.
// Récupérez la vôtre sur : https://www.deepl.com/pro-api (plan Free)
//
// Le script écrase www/lang.js avec toutes les langues générées.
// Relancez-le après avoir ajouté des clés dans SOURCE pour garder tout à jour.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Clé API DeepL (arg CLI ou variable d'env) ──────────────────────────────
const API_KEY = process.argv.find(function(a){ return a.startsWith('--key='); })
  ? process.argv.find(function(a){ return a.startsWith('--key='); }).slice(6)
  : process.env.DEEPL_API_KEY || '';

if (!API_KEY) {
  console.error('❌  Clé DeepL manquante.\n   Passez --key=VOTRE_CLE ou définissez DEEPL_API_KEY.');
  process.exit(1);
}

// ── Langues cibles (codes DeepL) + codes app ──────────────────────────────
const TARGETS = [
  { deepl: 'EN', app: 'en' },
  { deepl: 'ES', app: 'es' },
  { deepl: 'DE', app: 'de' },
  { deepl: 'IT', app: 'it' },
  { deepl: 'PT', app: 'pt' },
  { deepl: 'DA', app: 'da' },
  { deepl: 'FI', app: 'fi' },
  { deepl: 'SV', app: 'sv' },
  { deepl: 'PL', app: 'pl' },
  { deepl: 'EL', app: 'el' },
];

// ── Chaînes sources en français ────────────────────────────────────────────
// IMPORTANT : ne pas changer les CLÉS — l'app les utilise directement.
//             Modifiez uniquement les VALEURS françaises, puis relancez le script.
const SOURCE = {
  // Navigation bas
  bnav_explorer:   'Explorer',
  bnav_favoris:    'Favoris',
  bnav_messages:   'Messages',
  bnav_mes_cours:  'Mes cours',
  bnav_profil:     'Profil',
  bnav_mes_profs:  'Mes Profs',
  bnav_creer:      'Créer',

  // Page Mes Profs
  mes_profs_empty_title: 'Aucun professeur suivi',
  mes_profs_empty_sub:   'Suivez un professeur depuis son profil pour le retrouver ici.',

  // Profil prof — onglets followers
  mp_tab_accueil:       'Accueil',
  mp_tab_ressources:    'Ressources',
  mp_tab_notes:         'Notes',
  mp_envoyer_msg:       'Envoyer un message',
  mp_annonces:          'Annonces',
  mp_aucune_annonce:    'Aucune annonce pour le moment.',
  mp_aucune_ressource:  'Aucune ressource partagée.',
  mp_notes_hint:        'Notes partagées par votre professeur',
  mp_aucune_note:       'Aucune note de votre professeur pour le moment.',

  // Onboarding
  ob_tag1:   'Bienvenue',
  ob_desc1:  'La plateforme qui réunit élèves et professeurs pour partager le coût des cours particuliers.',
  ob_tag2:   'Pour les élèves',
  ob_title2: 'Trouve ton cours près de chez toi',
  ob_desc2:  'Maths, physique, langues… Réserve une place dans un cours collectif et paie uniquement ta part.',
  ob_tag3:   'Économise',
  ob_title3: 'Un prof, des frais partagés',
  ob_desc3:  'La qualité d\'un cours particulier, à un prix accessible à tous.',
  ob_tag4:   'Pour les professeurs',
  ob_title4: 'Propose tes cours, remplis ta salle',
  ob_desc4:  'Crée un cours, fixe ton prix total. CoursPool remplit les places et gère les paiements pour toi.',
  ob_btn_next:  'Continuer',
  ob_btn_skip:  'Passer',
  ob_btn_start: 'Commencer',

  // Connexion
  login_subtitle:  'Trouvez un cours près de vous',
  login_pw_label:  'Mot de passe',
  login_btn:       'Se connecter',
  login_or:        'ou',
  login_google:    'Continuer avec Google',
  login_no_acc:    'Pas encore de compte ?',
  login_signup:    'S\'inscrire',
  login_legal:     'En continuant, vous acceptez nos',
  login_cgu:       'CGU',
  login_and:       'et notre',
  login_privacy:   'Politique de confidentialité',

  // Inscription
  reg_title:        'Créer un compte',
  reg_pw_ph:        'Min. 6 caractères',
  reg_role_sep:     'Je suis...',
  reg_eleve:        'Elève',
  reg_eleve_desc:   'Je cherche des cours',
  reg_prof:         'Professeur',
  reg_prof_desc:    'Je donne des cours',
  reg_btn:          'Créer mon compte',
  reg_already:      'Déjà un compte ?',
  reg_login:        'Se connecter',
  reg_legal:        'En créant un compte, vous acceptez nos',

  // Force mot de passe
  pw_too_short: 'Trop court',
  pw_weak:      'Faible',
  pw_ok:        'Correct',
  pw_strong:    'Fort',

  // Complétion profil
  pc_role_title:    'Je suis...',
  pc_role_sub:      'Pour personnaliser votre experience',
  pc_continue:      'Continuer',
  pc_age_title:     'Votre année de naissance',
  pc_age_sub:       'Requise pour votre sécurité et la conformité RGPD.',
  pc_age_year:      'Année',
  pc_age_privacy:   'Ces données servent uniquement à votre sécurité et ne sont jamais partagées avec des tiers.',
  pc_for_who:       'C\'est pour qui ?',
  pc_for_who_sub:   'Les cours que vous cherchez sont pour...',
  pc_for_me:        'Pour moi',
  pc_for_me_desc:   'Je suis l\'élève',
  pc_for_child:     'Pour mon enfant',
  pc_for_child_desc:'Je suis le parent',
  pc_later:         'Plus tard',
  pc_level_title:   'Quel est votre niveau ?',
  pc_level_child:   'Quel est le niveau de votre enfant ?',
  pc_finish:        'Terminer',

  // Explorer
  exp_title:       'Accueil',
  exp_subtitle:    'Cours près de vous',
  exp_refresh:     'Actualiser',
  exp_verif:       'Vérification en cours',
  exp_verif_sub:   'Réponse par email sous 24h',
  exp_city_ph:     'Ville, code postal…',
  exp_around_me:   'Autour de moi',
  exp_pull:        'Tirer pour actualiser',
  exp_empty_title: 'Aucun cours trouvé',
  exp_empty_sub:   'Essayez un autre filtre ou une autre ville',
  exp_see_more:    'Voir plus',
  exp_private:     'Code privé détecté',
  exp_join:        'Rejoindre',
  exp_ignore:      'Ignorer',
  exp_search_ph:   'Matière, professeur, code privé…',
  exp_loading:     'Chargement',

  // Filtres
  filter_date:      'Date',
  filter_niveau:    'Niveau',
  filter_mode:      'Mode',
  filter_ville:     'Ville',
  filter_periode:   'Période',
  filter_reset:     'Effacer',
  filter_niv_title: 'Niveau d\'études',
  filter_niv_all:   'Tous les niveaux',
  filter_niv_prim:  'Primaire (6-11 ans)',
  filter_niv_col:   'Collège (11-15 ans)',
  filter_niv_lyc:   'Lycée (15-18 ans)',
  filter_niv_bac12: 'Bac+1/2 (BTS · IUT · L1-L2)',
  filter_niv_bac34: 'Bac+3/4 (L3 · Master 1)',
  filter_niv_bac5:  'Bac+5 (Master 2 · Grandes écoles)',
  filter_reset_all: 'Réinitialiser tous les filtres',
  filter_mode_title:'Format du cours',
  filter_mode_all:  'Tous les formats',
  filter_mode_pres: 'Présentiel (En personne)',
  filter_mode_vis:  'Visio (En ligne)',
  filter_per_title: 'Période',
  filter_all_dates: 'Toutes les dates',
  filter_this_week: 'Cette semaine',
  filter_this_month:'Ce mois-ci',
  filter_day_label: 'Jour précis',
  filter_lun:  'Lun',
  filter_mar:  'Mar',
  filter_mer:  'Mer',
  filter_jeu:  'Jeu',
  filter_ven:  'Ven',
  filter_sam:  'Sam',
  filter_dim:  'Dim',

  // Favoris
  fav_saved:         'Cours sauvegardés',
  fav_profs:         'Professeurs suivis',
  fav_empty_title:   'Aucun favori encore',
  fav_empty_sub:     'Sauvegardez un cours ou suivez un professeur pour les retrouver ici.',
  fav_explore:       'Explorer les cours',
  fav_cours_fin:     'Cours terminé',
  fav_cours_del:     'Cours supprimé',
  fav_retirer:       'Retirer',

  // Messages
  msg_title:   'Messages',
  msg_search:  'Rechercher...',
  msg_input:   'Message…',
  msg_safety:  'Pour la sécurité des utilisateurs, les messages peuvent être vérifiés en cas de signalement.',

  // Compte
  acc_title:         'Mon compte',
  acc_mes_cours:     'Mes cours',
  acc_reservations:  'Réservations',
  acc_suivis:        'Suivis',
  acc_professeurs:   'Professeurs',
  acc_historique:    'Historique',
  acc_cours_passes:  'Cours passés',
  acc_mon_profil:    'Mon profil',
  acc_infos:         'Infos & réglages',
  acc_revenus:       'Revenus',
  acc_paiements:     'Paiements reçus',
  acc_parametres:    'Paramètres',
  acc_notifs:        'Notifications, CGU…',
  acc_cours_avenir:  'Cours à venir',
  acc_profs_suivis:  'Professeurs suivis',
  acc_mes_profs:     'Mes Profs',
  acc_mon_espace:    'Mon Espace',
  acc_eleves_ressources: 'Élèves & ressources',
  acc_mes_avis:      'Mes avis',
  acc_notes_commentaires: 'Notes & commentaires',

  // Mon Espace (professeur)
  esp_guide:           'Guide',
  esp_code_title:      "Code d'accès élèves",
  esp_code_sub:        "Partage ce code pour donner accès à ton espace",
  esp_code_hint:       "Partage ce code avec tes élèves",
  esp_copier:          'Copier',
  esp_partager:        'Partager',
  esp_nouveau_code:    'Nouveau code',
  esp_mes_cours_sub:   'Cours créés et réservés',
  esp_mes_eleves_title:'Mes élèves',
  esp_mes_eleves_sub:  'Élèves inscrits à ton espace',
  esp_publications_title:'Publications',
  esp_publications_sub:'Annonces visibles par tes élèves',
  esp_publier:         'Publier',
  esp_sondage_btn:     'Sondage',
  esp_voir_publications:'Voir mes publications',
  esp_docs_recus_title:'Documents reçus',
  esp_docs_recus_sub:  'Fichiers envoyés par tes élèves',
  esp_biblio_title:    'Ma bibliothèque',
  esp_biblio_sub:      'Fiches de cours et documents partagés',
  esp_creer_fiche:     'Créer une fiche',
  esp_ajouter_doc:     'Ajouter un doc',
  esp_voir_biblio:     'Voir ma bibliothèque',
  esp_no_eleve:        "Aucun élève inscrit à tes cours pour l'instant.",
  esp_no_doc:          "Aucun document reçu pour l'instant.",
  esp_no_ressource:    'Aucune ressource publiée.',
  esp_doc_sans_titre:  'Document sans titre',
  esp_voir_lien:       'Voir',

  // Guide tuto Mon Espace (6 étapes)
  esp_title_1: 'Bienvenue dans ton Espace !',
  esp_sub_1:   'Ton espace prof centralise tout ce dont tu as besoin pour gérer tes élèves et tes cours.',
  esp_title_2: "Code d'accès élèves",
  esp_sub_2:   "Partage ton code unique avec tes élèves pour qu'ils rejoignent ton espace privé.",
  esp_title_3: 'Tes cours en un clin d\'œil',
  esp_sub_3:   'Retrouve ici tous tes cours créés et vois combien d\'élèves se sont inscrits.',
  esp_title_4: 'Suis tes élèves',
  esp_sub_4:   'Consulte la liste de tes élèves, leur statut de paiement et leurs coordonnées.',
  esp_title_5: 'Publie des annonces',
  esp_sub_5:   'Partage des informations importantes ou des rappels visibles uniquement par tes élèves.',
  esp_title_6: 'Ta bibliothèque',
  esp_sub_6:   'Mets à disposition des fiches de cours, exercices et documents pour tes élèves.',

  // Profil
  prof_prenom:       'Prénom',
  prof_nom:          'Nom',
  prof_email:        'Email',
  prof_ville:        'Ville',
  prof_ville_ph:     'Paris…',
  prof_ville_vis:    'Ville visible sur mon profil public',
  prof_etab:         'Établissement',
  prof_etab_vis:     'Établissement visible sur mon profil',
  prof_role:         'Rôle',
  prof_a_propos:     'À propos',
  prof_a_propos_ph:  'Présentez-vous, partagez votre approche…',
  prof_enseignement: 'Enseignement',
  prof_statut:       'Statut',
  prof_matieres:     'Matières enseignées',
  prof_matieres_ph:  'Ajouter une matière…',
  prof_sauvegarder:  'Sauvegarder',
  prof_partager:     'Partager mon profil',
  prof_comment:      'Comment ça marche',
  prof_deconnexion:  'Se déconnecter',

  // Modal prof (visiteur)
  mp_identite: 'Identité vérifiée',
  mp_diplome:  'Diplôme vérifié',
  mp_confiance:'Profil de confiance',
  mp_cours:    'Cours',
  mp_note:     'Note',
  mp_eleves:   'Élèves',
  mp_donnes:   'Donnés',
  mp_matieres: 'Matières enseignées',
  mp_contacter:'Contacter',
  mp_signaler: 'Signaler ce profil',
  mp_prochains:'Prochains cours',
  mp_avis:     'Avis des élèves',

  // Détail cours
  rr_title:       'Réservation',
  rr_detail_prix: 'Détail du prix',
  rr_prix_total:  'Prix total du cours',
  rr_nb_places:   'Nombre de places',
  rr_votre_part:  'Votre part',
  rr_remb:        'Remboursé si le cours est annulé.',
  rr_visio:       'Rejoindre en visio',
  rr_securise:    'Paiement 100% sécurisé',
  rr_confirmer:   'Confirmer',
  rr_contacter:   'Contacter le professeur',
  rr_avis:        'Laisser un avis',
  rr_partager:    'Partager ce cours',
  rr_eleves:      'Voir les élèves inscrits',
  rr_groupe:      'Groupe du cours',
  rr_dupliquer:   'Dupliquer ce cours',
  rr_annuler:     'Annuler mon cours',
  rr_deja:        'Vous avez déjà une place',
  rr_autre:       'Réserver une place pour une autre personne ?',
  rr_annuler_btn: 'Annuler',
  rr_oui:         'Oui',
  rr_complet:     'Complet',
  rr_place:       'place restante',
  rr_places:      'places restantes',
  rr_cancel_title:'Annuler ce cours ?',
  rr_cancel_warn: 'Cette action est irréversible. Les élèves déjà inscrits seront notifiés.',
  rr_garder:      'Garder le cours',
  rr_oui_annuler: 'Oui, annuler',

  // Création cours
  nc_title:    'Nouveau cours',
  nc_subtitle: 'Remplissez les infos essentielles',
  nc_titre:    'Titre du cours',
  nc_titre_ph: 'Ex: Algèbre linéaire pour débutants…',
  nc_matiere:  'Matière',
  nc_mat_ph:   'Choisir une matière…',
  nc_niveau:   'Niveau visé',
  nc_duree:    'Durée',
  nc_places:   'Places max',
  nc_prix:     'Prix total',
  nc_desc_ph:  'Niveau requis, programme abordé…',
  nc_prive:    'Cours privé',
  nc_prive_d:  'Accès par code uniquement',
  nc_code:     'Code d\'accès',
  nc_apercu:   'Aperçu',
  nc_publier:  'Publier',
  nc_pub_now:  'Publier maintenant',

  // Notation
  rating_title:'Comment s\'est passé ce cours ?',
  rating_ph:   'Partagez votre expérience… (optionnel)',
  rating_btn:  'Envoyer mon avis',

  // Chat groupe
  group_title: 'Groupe du cours',
  group_sub:   'Discussion de groupe',

  // Élèves inscrits
  students_title: 'Élèves inscrits',

  // Connexion requise
  login_prompt_title: 'Connectez-vous pour réserver',
  login_prompt_desc:  'Créez un compte gratuit ou connectez-vous pour réserver votre place en quelques secondes.',
  login_prompt_btn:   'Se connecter / Créer un compte',
  login_prompt_exp:   'Continuer à explorer',

  // Paramètres
  settings_title:       'Paramètres',
  settings_langue:      'Langue',
  settings_langue_sub:  'Choisir votre langue',
  settings_apparence:   'Apparence',
  settings_dark:        'Mode sombre',
  settings_dark_sys:    'Suit le système',
  settings_dark_on:     'Activé',
  settings_dark_off:    'Désactivé',
  settings_notifs:      'Notifications',
  settings_assistance:  'Assistance',
  settings_remb:        'Mes remboursements',
  settings_remb_sub:    'Annulations & retours',
  settings_inviter:     'Inviter un ami',
  settings_inviter_sub: 'Partager CoursPool',
  settings_contact:     'Nous contacter',
  settings_contact_sub: 'Une question ? On répond vite',
  settings_confid:      'Confidentialité',
  settings_confid_sub:  'Politique de confidentialité',
  settings_cgu:         'CGU',
  settings_cgu_sub:     'Conditions générales d\'utilisation',
  settings_permissions: 'Permissions',
  settings_location:    'Localisation',
  settings_location_sub:'Ouvrir les réglages de l\'app',
  settings_compte:      'Compte',
  settings_deconn:      'Se déconnecter',
  settings_suppr:       'Supprimer mon compte',
  settings_suppr_sub:   'Efface toutes vos données — irréversible',
  settings_priv:        'Confidentialité',
  settings_adresse:     'Adresse du cours',
  settings_adresse_sub: 'Partagée aux élèves inscrits après réservation',
  settings_msg_in:      'Messages entrants',
  settings_visible:     'Visibilité dans Explorer',
  settings_visible_sub: 'Votre profil est proposé aux élèves dans les recherches',
  settings_mon_profil:  'Mon profil',
  settings_tuteur:      'Je suis tuteur / parent',
  settings_tuteur_sub:  'Vos avis seront identifiés "Tuteur" — aide les autres familles',

  // Toasts
  t_save_login:    'Connectez-vous pour sauvegarder des cours',
  t_fav_removed:   'Retiré des favoris',
  t_fav_saved:     'Cours sauvegardé',
  t_fav_saved_sub: 'Retrouvez-le dans vos favoris',
  t_prof_removed:  'Professeur retiré des suivis',
  t_session_exp:   'Session expirée',
  t_reconnect:     'Veuillez vous reconnecter',
  t_login_fail:    'Connexion échouée',
  t_retry:         'Réessaie ou utilise email / mot de passe',
  t_error:         'Erreur',
  t_oauth_unavail: 'OAuth non disponible',
  t_retry_later:   'Réessaie dans quelques instants',
  t_google_fail:   'Impossible de continuer avec Google',
  t_apple_fail:    'Impossible de continuer avec Apple',
  t_consent:       'Consentement requis',
  t_consent_check: 'Cochez la case pour continuer',
  t_refreshed:     'Actualisé',
  t_welcome_sub:   'Connecté à CoursPool',
  t_disconn:       'Déconnecté',
  t_disconn_sub:   'À bientôt !',
  t_follow_login:  'Connectez-vous pour suivre un professeur',
  t_unfollowed:    'Retiré des suivis',
  t_followed:      'Vous suivez ce professeur',
  t_followed_sub:  'Notifié dès son prochain cours',
  t_self_follow:   'Action impossible',
  t_self_follow_s: 'Vous ne pouvez pas vous suivre vous-même',
  t_already_res:   'Déjà réservé',
  t_already_res_s: 'Vous avez déjà une place pour ce cours',
  t_link_copied:   'Lien copié !',
  t_link_copied_s: 'Partagez ce lien pour inviter quelqu\'un',
  t_profile_saved: 'Profil sauvegardé ✓',
  t_photo_ok:      'Photo mise à jour ✓',
  t_photo_heavy:   'Photo trop lourde',
  t_photo_heavy_s: 'Maximum 2MB. Compressez votre image.',
  t_diplome_ok:    'Diplôme vérifié !',
  t_diplome_sub:   'Le badge est maintenant visible sur votre profil',
  t_casier_ok:     'Profil de confiance !',
  t_casier_sub:    'Le badge est maintenant visible sur votre profil',
  t_not_found:     'Cours introuvable',
  t_unavail:       'Ce cours n\'est plus disponible',
  t_denied:        'Accès refusé',
  t_cni_req:       'Pièce d\'identité requise',
  t_prof_only:     'Seuls les professeurs peuvent proposer des cours',
  t_pay_active:    'Paiements activés ✓',
  t_pay_active_s:  'Vous allez recevoir vos virements automatiquement',
  t_cancelled:     'Annulé',
  t_cancelled_sub: 'L\'élève a été remboursé automatiquement ✓',
  t_fields_miss:   'Champs manquants',
  t_pw_short:      'Mot de passe trop court (6 min)',
  t_net_error:     'Erreur réseau',
  t_prof_not_saved:'Profil non sauvegardé sur le serveur',
  t_fav_login:     'Connectez-vous pour accéder à vos favoris',
  t_msg_login:     'Connectez-vous pour accéder aux messages',
  t_acc_login:     'Connectez-vous pour accéder à votre profil',

  // Niveaux courts (chips création cours)
  niv_all:   'Tous',
  niv_prim:  'Primaire',
  niv_col:   'Collège',
  niv_lyc:   'Lycée',
  niv_bac12: 'Bac+1/2',
  niv_bac34: 'Bac+3/4',
  niv_bac5:  'Bac+5+',

  // Création cours — sections
  nc_quand_ou:      'Quand & Où',
  nc_infos:         'Infos pratiques',
  nc_desc_section:  'Description',
  nc_optionnel:     '(optionnelle)',
  nc_mode_label:    'Format',
  nc_mode_pres:     'Présentiel',
  nc_mode_vis:      'Visio',

  // Divers UI
  cours_dispo:      'cours dispo',
  par_eleve:        '/ élève',
  aucun_cours_dispo:'Aucun cours disponible',
  aucune_conv:      'Aucune conversation',
  aucun_msg:        'Aucun message',
  dites_bonjour:    'Dites bonjour !',
  inscrit:          'Inscrit',
  configuration_requise: 'Configuration requise',

  // Tutoriel élève (steps interactifs)
  tuto_e1_title: 'Bienvenue sur CoursPool !',
  tuto_e1_desc:  'La plateforme qui partage le coût d\'un cours entre élèves. Un prof, plusieurs places, un prix juste pour tous.',
  tuto_e2_title: 'Trouvez des cours près de vous',
  tuto_e2_desc:  'Tapez votre ville ou appuyez sur Autour de moi. Filtrez par matière, niveau ou distance.',
  tuto_e3_title: 'Réservez votre place',
  tuto_e3_desc:  'Appuyez sur un cours puis Réserver. Vous ne payez que votre part — le reste est partagé entre les élèves.',
  tuto_e4_title: 'Contactez le professeur',
  tuto_e4_desc:  'Avant de réserver, écrivez au professeur depuis l\'onglet Messages.',
  tuto_e5_title: 'Prêt à découvrir ?',
  tuto_e5_desc:  'Créez un compte gratuit pour réserver votre premier cours.',

  // Tutoriel professeur (steps interactifs)
  tuto_p1_title: 'Bienvenue professeur !',
  tuto_p1_desc:  'Proposez vos cours à plusieurs élèves. CoursPool gère tout : inscriptions, paiements et messagerie.',
  tuto_p2_title: 'Créez votre premier cours',
  tuto_p2_desc:  'Appuyez sur le bouton + orange en bas de l\'écran.',
  tuto_p3_title: 'Vos cours visibles par tous',
  tuto_p3_desc:  'Dès la publication, vos cours sont visibles par tous les élèves.',
  tuto_p4_title: 'Messagerie directe',
  tuto_p4_desc:  'Les élèves vous contactent avant de réserver. Répondre vite aide.',
  tuto_p5_title: 'Paiements sécurisés',
  tuto_p5_desc:  'Renseignez votre IBAN dans Revenus pour recevoir vos virements automatiquement. Bonne aventure !',

  // Toasts supplémentaires
  t_welcome:            'Bienvenue',
  t_account_suspended:  'Compte suspendu',
  t_account_suspended_msg: 'Votre compte a été suspendu. Contactez le support CoursPool.',
  t_timeout:            'Délai dépassé',
  t_timeout_msg:        'Le serveur met du temps à répondre, réessaie',
  t_login_fail_msg:     'Impossible de se connecter',
  t_signup_fail:        'Impossible de créer le compte',
  t_photo_fail:         'Impossible d\'uploader la photo',
  t_try_again:          'Veuillez réessayer',
  t_login_reserve:      'Connectez-vous pour réserver',
  t_title_req:          'Titre manquant',
  t_title_req_msg:      'Donnez un titre à votre cours',
  t_subject_req:        'Matière manquante',
  t_subject_req_msg:    'Choisissez une matière',
  t_date_req:           'Date manquante',
  t_date_req_msg:       'Choisissez une date',
  t_hour_req:           'Heure manquante',
  t_hour_req_msg:       'Choisissez une heure',
  t_invalid_date:       'Date invalide',
  t_future_date:        'Choisissez une date future',
  t_publish_fail:       'Impossible de publier',
  t_duplicated:         'Cours dupliqué',
  t_duplicated_msg:     'Changez la date et l\'heure puis publiez',
  t_login_msg:          'Connectez-vous pour envoyer des messages',
  t_no_recipient:       'Destinataire introuvable',
  t_msg_self:           'Vous ne pouvez pas vous écrire à vous-même',
  t_not_verified:       'Compte non vérifié',
  t_verify_to_msg:      'Votre compte doit être vérifié pour envoyer des messages',
  t_msg_failed:         'Message non envoyé — vérifiez votre connexion',
  t_msg_failed_s:       'Message non envoyé',
  t_reconnect_msg:      'Reconnectez-vous pour envoyer des messages',
  t_read_only:          'Lecture seule',
  t_read_only_msg:      'Le professeur n\'a pas activé les réponses',
  t_geoloc_off:         'Localisation désactivée',
  t_geoloc_off_msg:     'Activez-la dans Réglages > CoursPool > Localisation',
  t_geoloc_unsup:       'Géolocalisation non disponible',
  t_geoloc_deny:        'Localisation refusée',
  t_geoloc_deny_msg:    'Appuie à nouveau pour ouvrir les Réglages',
  t_geoloc_fail:        'Impossible de détecter la position',
  t_doc_req:            'Document manquant',
  t_doc_cni:            'Choisissez votre CNI ou passeport',
  t_file_heavy:         'Fichier trop lourd',
  t_file_heavy_msg:     'La taille maximale est 5 Mo',
  t_file_fail:          'Impossible d\'envoyer le fichier',
  t_doc_diplome:        'Choisissez une photo de votre diplôme',
  t_doc_attest:         'Choisissez une photo de votre attestation',
  t_sent:               'Envoyé !',
  t_attest_verif:       'Votre attestation est en cours de vérification',
  t_code_invalid:       'Code invalide',
  t_no_course_code:     'Aucun cours trouvé avec ce code',
  t_payment_svc:        'Service de paiement indisponible',
  t_pay_declined:       'Paiement refusé',
  t_res_confirmed:      'Réservation confirmée ✓',
  t_res_confirmed_msg:  'Vous êtes inscrit au cours',
  t_iban_holder_req:    'Entrez le titulaire du compte',
  t_link_saved:         'Lien enregistré',
  t_link_deleted:       'Lien supprimé',
  t_banking_config_msg: 'Finalisez votre configuration bancaire pour recevoir les paiements',
  t_in_progress:        'Publication déjà en cours',
  t_action_impossible:  'Action impossible',

  // Textes UI dynamiques (boutons, états de chargement)
  txt_publishing:   '⏳ Publication…',
  txt_sending:      'Envoi...',
  txt_loading:      'Chargement…',
  txt_processing:   'Traitement…',
  txt_confirming:   'Confirmation…',
  txt_saving:       '⏳ Enregistrement…',
  txt_send_verif:   'Envoyer pour vérification',
  txt_verif_prog:   'Vérification en cours ⏳',
  txt_doc_sent:     'Document envoyé ✓',
  txt_diploma_sent: 'Diplôme envoyé ✓',
  txt_no_students:  'Aucun élève inscrit pour l\'instant.',
  txt_publish_btn:  'Publier le cours',
  txt_creating:     'Création...',
  txt_login_btn:    'Se connecter',
  txt_create_btn:   'Créer mon compte',
  txt_retry:        'Réessayer',

  // Vérification identité (CNI)
  cni_title:       'Vérifiez votre identité',
  cni_desc:        'Pour garantir la confiance des élèves, nous vérifions l\'identité de chaque professeur.',
  cni_photo_label: 'Photo de votre CNI ou passeport',
  cni_recto:       'Recto uniquement, lisible',
  cni_24h:         'Vérification sous 24h',
  cni_email_conf:  'Email de confirmation dès que c\'est fait',
  cni_publish:     'Publiez vos premiers cours',
  cni_visible_all: 'Visible par tous les élèves',
  cni_start_btn:   'Commencer la vérification',
  cni_your_id:     'Votre pièce d\'identité',
  cni_id_types:    'CNI, Passeport ou Carte de séjour',
  cni_file_inst:   'Appuyez pour choisir · JPG, PNG ou PDF · Max 5 MB',
  cni_privacy:     'Vos documents sont chiffrés et ne seront jamais partagés. Votre pièce d\'identité est automatiquement supprimée après vérification.',
  cni_later:       'Plus tard',
  cni_thanks:      'Compris, merci !',

  // Vérification diplôme
  dip_title:       'Obtenez le badge Diplôme vérifié',
  dip_desc:        'Rassurez les parents en prouvant votre qualification. Le badge apparaît sur votre profil et vos cours.',
  dip_photo_label: 'Photo de votre diplôme',
  dip_types:       'Licence, Master, CAPES, agrégation…',
  dip_email_val:   'Email de confirmation dès validation',
  dip_badge:       'Badge affiché sur votre profil',
  dip_visible:     'Visible par tous les élèves et parents',
  dip_btn:         'Envoyer mon diplôme',
  dip_your:        'Votre diplôme',
  dip_encrypted:   'Vos documents sont chiffrés et ne seront jamais partagés.',

  // Vérification casier judiciaire
  cas_title:       'Obtenez le badge Profil de confiance',
  cas_desc:        'Montrez aux familles que votre profil a été contrôlé. Ce badge renforce la confiance et vous démarque.',
  cas_photo_label: 'Photo de votre attestation',
  cas_type:        'Extrait de casier judiciaire bulletin n°3',
  cas_type_form:   'Extrait de casier judiciaire (bulletin n°3)',
  cas_btn:         'Envoyer mon attestation',
  cas_your:        'Votre attestation',

  // Notifications push — statut
  notif_not_supported:    'Les notifications ne sont pas supportées sur cet appareil.',
  notif_blocked_title:    'Notifications bloquées',
  notif_blocked_sub:      'Activez-les dans les réglages de votre appareil',
  notif_active_title:     'Notifications activées',
  notif_active_sub:       'Vous recevez les alertes en temps réel',
  notif_inactive_title:   'Notifications désactivées',
  notif_inactive_sub:     'Activez pour ne rien manquer',
  notif_activate_btn:     'Activer',
  notif_deactivate_btn:   'Désactiver',
  notif_denied:           'Refusé',
  notif_enable_settings:  'Activez les notifications dans vos réglages',
  notif_enabled:          'Notifications activées ✓',
  notif_will_receive:     'Vous recevrez les alertes',
  notif_disabled:         'Notifications désactivées',
  notif_err_enable:       "Impossible d'activer les notifications",
  notif_err_disable:      'Impossible de désactiver',

  // Notifications — groupes et types
  notif_grp_courses:      'Cours',
  notif_grp_reservations: 'Réservations',
  notif_grp_reminders:    'Rappels',
  notif_grp_messages:     'Messages',
  notif_grp_msg_avis:     'Messages & avis',
  notif_new_course:       'Nouveaux cours',
  notif_new_course_sub:   'Quand un prof suivi publie un cours',
  notif_place_available:  'Place disponible',
  notif_place_available_sub: 'Quand une place se libère sur un cours complet',
  notif_resa_confirmed:   'Confirmation de réservation',
  notif_resa_confirmed_sub: 'Dès que votre réservation est validée',
  notif_cours_annule:     'Cours annulé',
  notif_cours_annule_sub: 'Quand le prof annule un cours auquel vous êtes inscrit',
  notif_rappel_24h:       'Rappel 24h avant',
  notif_rappel_24h_e_sub: 'La veille du cours réservé',
  notif_rappel_1h:        'Rappel 1h avant',
  notif_rappel_1h_sub:    'Une heure avant le début du cours',
  notif_messages:         'Messages',
  notif_messages_e_sub:   'Quand un prof vous répond dans la messagerie',
  notif_new_reservation:  'Nouvelle réservation',
  notif_new_reservation_sub: "Quand un élève réserve un de vos cours",
  notif_annulation:       'Annulation',
  notif_annulation_sub:   "Quand un élève annule sa réservation",
  notif_cours_complet:    'Cours complet',
  notif_cours_complet_sub:'Quand toutes les places de votre cours sont prises',
  notif_paiement:         'Paiement reçu',
  notif_paiement_sub:     'Confirmation de virement sur votre compte',
  notif_rappel_24h_p_sub: 'La veille de chacun de vos cours',
  notif_messages_p_sub:   "Quand un élève vous envoie un message",
  notif_avis:             'Avis et notations',
  notif_avis_sub:         "Quand un élève laisse un avis sur votre cours",

  // Salutations dynamiques
  greet_morning:    'Bonjour',
  greet_afternoon:  'Bon après-midi',
  greet_evening:    'Bonsoir',
  greet_night:      'Bonne nuit',
  explore_sub1:     'Que voulez-vous apprendre ?',
  explore_sub2:     'Trouvez votre prochain cours',

  // Statuts professeur
  statut_etudiant:    'Étudiant',
  statut_prof_ecoles: 'Prof des écoles',
  statut_prof_clg:    'Collège / lycée',
  statut_chercheur:   'Enseignant-chercheur',
  statut_auto:        'Auto-entrepreneur',
  statut_autre:       'Autre',

  // Toasts publication cours
  t_first_course:      'Premier cours publié !',
  t_first_course_sub:  'Félicitations ! Vos élèves peuvent maintenant vous trouver.',
  t_course_published:  'Cours publié ✓',
  t_visible_students:  'Visible pour tous les élèves',

  // Toasts follow
  t_vous_suivez:    'Vous suivez',
  t_following_msg:  'Notifié dès son prochain cours',

  // Mode de cours (badges courts)
  mode_visio: 'Visio',
  mode_pres:  'Présentiel',

  // Niveaux supplémentaires (groupes picker)
  niv_superieur:    'Supérieur',
  niv_general:      'Général',
  niv_tous_niveaux: 'Tous niveaux',
  niv_adultes:      'Adultes / Pro',

  // Catégories matières (picker)
  mat_cat_sciences:  'Sciences exactes',
  mat_cat_numerique: 'Numérique & Tech',
  mat_cat_langues:   'Langues',
  mat_cat_lettres:   'Lettres & Écriture',
  mat_cat_arts:      'Arts visuels',
  mat_cat_musique:   'Musique',
  mat_cat_humaines:  'Sciences humaines',
  mat_cat_business:  'Business & Droit',
  mat_cat_prepa:     'Prépa & Concours',
  mat_cat_sport:     'Sport',
  mat_cat_bienetre:  'Bien-être',
  mat_cat_cuisine:   'Cuisine & Artisanat',
  mat_cat_jeux:      'Jeux & Loisirs',
  mat_cat_autre:     'Autre',

  // Préférences messagerie
  msg_pref_all:          'Tous les élèves',
  msg_pref_all_sub:      "N'importe quel élève peut vous écrire",
  msg_pref_enrolled:          'Inscrits uniquement',
  msg_pref_enrolled_sub:      'Réservé aux élèves inscrits à vos cours',
  msg_pref_enrolled_space:    'Espace élèves',
  msg_pref_enrolled_space_sub:'Messages de vos professeurs inscrits',
  msg_pref_none:              'Désactivée',
  msg_pref_none_sub:          'Personne ne peut vous envoyer de message',
  msg_incoming_title:         'Nouveau message',
  msg_incoming_subtitle:      'Vous avez un nouveau message',

  // Types de lieu (création cours)
  lieu_home:      'À domicile',
  lieu_home_desc: 'Adresse partagée en privé avec les inscrits',
  lieu_etab:      'Établissement',
  lieu_etab_desc: 'Collège, lycée, bibliothèque, université…',
  lieu_other:     'Autre lieu',
  lieu_other_desc:'Salle de co-working, café, parc…',

  // Confidentialité cours
  nc_public:      'Cours public',
  nc_public_desc: 'Visible dans les résultats de recherche',
  nc_prive_desc:  'Invisible au public — accès par code unique',

  // États vides / erreurs génériques
  err_load_fail:  'Impossible de charger.',
  err_revenues:   'Impossible de charger les revenus.',
  err_refunds:    'Impossible de charger les remboursements',
  err_courses:    'Impossible de charger les cours.',
  err_connection: 'Erreur de connexion.',
  err_check_conn: 'Vérifiez votre connexion internet.',
  empty_no_msgs:  'Aucun message pour l\'instant.',
  empty_be_first: 'Soyez le premier à écrire !',

  // Favoris — états cours supprimé/terminé
  fav_cours_termine:  'Cours terminé',
  fav_cours_supprime: 'Cours supprimé',
  fav_retirer:        'Retirer',

  // Boutons follow (profil page)
  fol_add:     'Suivre',
  fol_remove:  'Suivi',

  // Confirmation annulation réservation (depuis mes cours)
  confirm_cancel_swap: "Pour annuler, contactez {prof} — le remboursement est effectué par le professeur.\n\nOuvrir la messagerie ?",

  // Réservation place supplémentaire
  res_extra_place: 'Réservation d\'une place supplémentaire · {pp}€ par personne.',

  // Code cours privé — suggestion de recherche
  search_code_join: '🔒 Rejoindre le cours privé "{code}" ?',

  // Messagerie — états vides / connexion
  msg_reconnecting:    'Reconnexion...',
  msg_empty_conv:      'Aucune conversation',
  msg_empty_prof:      'Tes élèves peuvent t\'écrire depuis la fiche d\'un cours.',
  msg_empty_eleve:     'Démarre une conversation depuis le profil d\'un professeur.',
  msg_empty_group:     'Aucun message pour l\'instant.<br>Soyez le premier à écrire !',

  // Historique
  hist_empty:          'Aucun cours passé pour le moment',

  // Rappel cours (reminder band)
  reminder_dans:       'Dans',
  reminder_min:        'min',

  // IBAN bouton
  txt_save_iban:       'Enregistrer mon IBAN',

  // Connexion OAuth loading
  oauth_loading:       'Connexion en cours...',

  // Visio link sheet
  visio_add_title:     'Ajouter un lien visio',
  visio_edit_title:    'Modifier le lien visio',
  visio_help:          'Zoom, Google Meet, Jitsi ou tout autre lien',
  visio_delete_link:   'Supprimer le lien',
  visio_delete_confirm:'Supprimer ?',

  // Partager cours (messagerie sheet)
  share_cours_title: 'Partager un cours',
  share_cours_sub:   'La carte s\'affichera dans la conversation.',

  // Supprimer message
  confirm_delete_msg:  'Supprimer ce message ?',

  // Statut professionnel (label)
  lbl_statut_pro:      'Statut professionnel',

  // Wizard création cours — boutons de navigation
  wiz_back_cancel:       'Annuler',
  wiz_back_prev:         'Étape précédente',
  wiz_publish:           'Publier',
  wiz_continuer:         'Continuer',
  wiz_cours_publie:      'Cours publié !',
  wiz_cours_visible:     'Votre cours est maintenant visible',
  wiz_lien_visio:        'Lien visio automatique',
  wiz_seances_prog:      'Séances programmées',
  wiz_chaque_seance_note:'Chaque séance est notée',

  // Suppression compte
  delete_account_btn:  'Supprimer définitivement',

  // Boutons cartes
  card_reserve:  'Réserver',
  card_consult:  'Consulter',
  card_calendar: 'Calendrier',
  card_cours:    'Cours',
  cal_add_title:       'Ajouter au calendrier',
  cal_apple:           'Calendrier Apple',
  cal_google:          'Google Agenda',
  cal_download:        'Télécharger .ics (Outlook, Apple…)',
  cal_upcoming:        'À venir',
  cal_past:            'Passés',
  cal_next_course:     'Prochain cours',
  cal_no_course_day:   'Aucun cours ce jour',
  cal_no_course_eleve: 'Aucun cours prévu',
  cal_no_course_prof:  'Aucun cours programmé',

  // Places et prix (cours cards / détail)
  places_max:    'places max',
  prix_fixe:     'Prix fixe de',
  par_eleve_confirm: 'par élève. Confirmez pour réserver votre place.',
  soit_par_eleve:'Soit',
  calc_per:      'par élève pour',
  pour_place:    'place',
  pour_places:   'places',

  // Comptage élèves inscrits (openEleves)
  eleve_inscrit:  'élève inscrit',
  eleves_inscrits:'élèves inscrits',
  sur_places:     'sur',
  role_eleve:     'Élève',
  role_tuteur:    'Tuteur',

  // Statut paiement réservation
  paiement_paye:    'Payé',
  paiement_attente: 'En attente',

  // Boutons confirmations / dialogs
  confirm_cancel_cours:    'Annuler ce cours ? Tous les élèves inscrits seront notifiés.',
  confirm_cancel_eleve:    'Annuler et rembourser cet élève ?',
  confirm_cancel_res_btn:  'Annuler',
  confirm_cancel_res:      'Annuler cette réservation ?',

  // Labels lieu enseignement (profil)
  lieu_enseignement: 'Lieu d\'enseignement',
  etab_ecole:        'Établissement / école',
  lieu_activite:     'Lieu d\'activité',
  visible_profil:    'Visible sur mon profil',
  visible_public:    'public',

  // Rôle affiché dans settings (ligne 1942)
  role_prof_display: '👨‍🏫 Professeur',
  role_eleve_display:'👤 Élève',

  // Cours partagé en messagerie
  t_cours_shared:    'Cours partagé\u00a0!',
  t_carte_conv:      'La carte est dans la conversation',
  t_send_impossible: 'Envoi impossible',

  // Signalement
  ctx_prof:     'Professeur',
  ctx_eleve:    'Élève',
  ctx_message:  'Conversation',

  // Cours privé — badge
  badge_prive:    'Privé',
  badge_done:     'Terminé',
  badge_upcoming: 'À venir',

  // Chargement/erreur openEleves
  err_eleves_load: 'Impossible de charger.',
  txt_retry_link:  'Réessayer',

  // Annuler dans calendrier
  txt_annuler: 'Annuler',
  btn_annuler: 'Annuler',

  // Dates relatives (messagerie)
  date_today:    "Aujourd'hui",
  date_tomorrow: 'Demain',
  date_at:       'à',
  date_tbd:      'Date à définir',
  date_yesterday: 'Hier',

  // ProfCompletion — lieu selon statut
  pc_ou_etudiez:   'Où étudiez-vous ?',
  pc_univ_ecole:   'Université / école',
  pc_ou_travaillez:'Où travaillez-vous ?',
  pc_ou_enseignez: 'Où enseignez-vous ?',
  pc_etab_opt:     'Établissement',

  // Onboarding boutons
  ob_continuer:    'Continuer',
  ob_commencer:    'Commencer 🎉',
  ob_cest_parti:   'C\u2019est parti !',

  // Validation âge (profCompletion)
  age_18_requis:   'Vous devez avoir au moins 18 ans pour enseigner sur CoursPool.',
  age_13_requis:   'CoursPool est réservé aux utilisateurs de 13 ans et plus. Demandez à un parent de créer un compte pour vous.',
  age_15_accord:   "Les moins de 15 ans doivent avoir l'accord de leur parent ou tuteur légal.",

  // Page Explorer (titre / sous-titre avant connexion)
  exp_explore_title: 'Explorer',
  exp_guest_title:   'Créez votre compte gratuit',
  exp_guest_sub:     'Rejoignez CoursPool pour réserver des cours,<br>suivre des professeurs et gérer votre profil.',
  exp_first_course:  'Soyez le premier à proposer un cours !',
  exp_near_you:      'Trouvez un cours près de vous',

  // Réservation — email confirmation
  res_email_ami:  'La place supplémentaire a été réservée. Un email de confirmation a été envoyé.',
  res_email_vous: 'Votre place est réservée. Un email de confirmation vous a été envoyé.',

  // Documents vérification — sous-titres après envoi
  doc_cni_recu:   'Votre document a bien été reçu.<br>Vous recevrez un email de confirmation<br><strong>sous 24 heures</strong>.',
  doc_cni_verif:  'Nous vérifions votre identité.<br>Vous recevrez un email de confirmation<br><strong>sous 24 heures</strong>.',
  doc_dip_recu:   'Votre diplôme a bien été reçu.<br>Vous recevrez un email de confirmation<br><strong>sous 24 heures</strong>.',
  doc_dip_verif:  'Nous vérifions votre diplôme.<br>Vous recevrez un email de confirmation<br><strong>sous 24 heures</strong>.',

  // Titre verif identité dans explore (mini card statut CNI)
  verif_id_required:  'Vérification d\'identité requise',
  verif_id_tap:       'Appuyez pour envoyer votre document',
  verif_id_progress:  'Vérification en cours',
  verif_id_email24h:  'Réponse par email sous 24h',
  verif_id_rejected:  'Document refusé — renvoyer',
  verif_id_resubmit:  'Appuyez pour soumettre à nouveau',

  // Blocs statut certifications (profil prof)
  verif_section:           'Vérification',
  verif_a_obtenir:         'À obtenir',
  verif_badge_ok:          'Vérifié',
  verif_badge_pending_lbl: 'En cours',
  verif_badge_refused:     'Refusé',
  verif_ineligible:        'Non éligible',
  verif_cni_send:          'Envoyez votre pièce d\'identité',
  verif_cni_ok:            'CNI contrôlée par CoursPool',
  verif_cni_retry:         'Renvoyer ma pièce d\'identité',
  verif_dip_send:          'Envoyez votre diplôme',
  verif_cas_send:          'Envoyez votre attestation',

  // Nudge badges post-CNI
  nudge_votre_profil:  'Votre profil',
  nudge_aller_plus:    'Allez encore plus loin',
  nudge_dip_desc:      'Montrez vos qualifications aux élèves',
  nudge_cas_desc:      'Attestation de moralité vérifiée',
  nudge_ajouter:       'Ajouter',
  nudge_identite_ok:   'Votre identité est vérifiée ✓ — complétez votre profil pour inspirer encore plus confiance aux élèves.',
  nudge_complete:      'Complétez votre profil pour inspirer confiance aux élèves et vous démarquer.',

  // Envoi en cours (contact form / signalement)
  txt_envoi:  'Envoi…',
  txt_choose: 'Choisir…',
  t_share_profile_sub: 'Partagez votre profil avec vos élèves',
  t_copy_link:        'Copiez ce lien',
  t_share_profile_msg: 'Retrouvez mes cours sur CoursPool — partagez les frais à plusieurs !',

  // Filtres (explore)
  filter_prof:     'Professeur',
  filter_niveau:   'Niveau',
  filter_date:     'Date',
  filter_prix:     'Prix',
  filter_gratuit:  'Gratuit',
  filter_reset:    'Réinitialiser',
  filter_apply:    'Appliquer',
  filter_all_mat:  'Toutes les matières',
  filter_all_niv:  'Tous niveaux',
  filter_all_mode: 'Tous les formats',

  // Toasts manquants — instrumentés en phase 2
  t_net_error_sub:      'Vérifiez votre connexion',
  t_unsubscribed:       'Désinscription effectuée',
  t_space_joined:       'Espace rejoint !',
  t_course_found:       'Cours trouvé !',
  t_load_error:         'Erreur de chargement',
  t_photo_sent:         'Photo envoyée ✓',
  t_access_unlocked:    'Accès débloqué !',
  t_code_generated:     'Code généré !',
  t_code_generated_sub: 'Partage-le avec tes élèves',
  t_code_copied:        'Code copié !',
  t_copied:             'Copié !',
  t_resource_published: 'Ressource publiée !',
  t_max_options:        'Maximum 6 options',
  t_write_question:     'Écris une question',
  t_min_two_options:    'Au moins 2 options',
  t_poll_published:     'Sondage publié !',
  t_login_to_vote:      'Connecte-toi pour voter',
  t_wrong_password:     'Mot de passe incorrect',
  t_content_unlocked:   'Contenu débloqué !',
  t_doc_sent_success:   'Document envoyé !',
  t_doc_added:          'Document ajouté !',
  t_write_first:        'Écris quelque chose d\'abord',
  t_too_long:           'Trop long',
  t_char_limit_1500:    'Limite de 1500 caractères',
  t_write_message:      'Écris un message',
  t_message_sent_all:   'Message envoyé à tous les inscrits !',
  t_location_req:       'Lieu manquant',
  t_location_type_req:  'Précisez le type de lieu',
  t_location_addr_req:  'Précisez la ville ou l\'adresse',
  t_price_req:          'Prix manquant',
  t_price_req_msg:      'Entrez le prix total du cours',
  t_date_incoherent:    'Date incohérente',
  t_date_future_msg:    'Le cours doit être dans le futur',
  t_iban_invalid:       'IBAN invalide',
  t_iban_saved:         'IBAN enregistré !',
  t_iban_error:         'Impossible d\'enregistrer l\'IBAN',
  t_booking_required:   'Réservation requise',
  t_booking_req_msg:    'Vous devez avoir réservé ce cours pour le noter',
  t_course_upcoming:    'Cours à venir',
  t_course_upcoming_msg:'Vous pourrez noter ce cours après sa date',
  t_rating_error:       'Impossible d\'envoyer la note',
  t_thanks_review:      'Merci pour votre avis !',
  t_thanks_review_sub:  'Votre note a été enregistrée',
  t_account_disabled:   'Votre compte a été désactivé',
  t_account_disabled_s: 'Vous allez être déconnecté',
  t_account_blocked:    'Votre compte a été bloqué',
  t_account_verified:   'Compte vérifié !',
  t_account_verified_s: 'Vous pouvez maintenant publier des cours',
  t_doc_rejected:       'Document refusé',
  t_doc_rejected_sub:   'Vérifiez votre email pour plus d\'informations',
  t_verif_pending:      'Vérification en cours',
  t_verif_pending_sub:  'Votre identité est en cours de vérification',
  t_user_blocked:       'Utilisateur bloqué',
  t_user_unblocked:     'Utilisateur débloqué',
  t_preparing:          'Préparation…',
  t_preparing_sub:      'Collecte de vos données…',
  t_export_done:        'Export téléchargé',
  t_login_to_report:    'Connexion requise',
  t_login_to_report_s:  'Connectez-vous pour signaler',
  t_report_sent:        'Signalement envoyé',
  t_report_sent_sub:    'Notre équipe va examiner ce signalement',
  t_account_deleted:    'Compte supprimé',
  t_account_deleted_s:  'Toutes vos données ont été effacées',
  t_delete_acc_error:   'Impossible de supprimer le compte',
  t_parent_disabled:    'Statut désactivé',
  t_parent_disabled_s:  'Vous n\'apparaissez plus comme tuteur',
  t_parent_only:        'Réservé aux parents',
  t_parent_only_sub:    'Vous devez avoir 18 ans ou plus',
  t_firstname_req:      'Prénom requis',
  t_firstname_req_sub:  'Indiquez le prénom de l\'enfant',
  t_parent_enabled:     'Statut activé',
  t_firstname_saved:    'Prénom enregistré',
  t_message_deleted:    'Message supprimé',
  t_setup_required:     'Configuration requise',
  t_login_first:        'Connecte-toi d\'abord',
  t_profile_not_found:  'Profil introuvable',
  t_connect_required:   'Connexion requise',
  t_connect_to_book:    'Connectez-vous pour réserver',
  t_desc_required:      'Description requise',
  t_desc_req:           'Description requise',
  t_desc_req_sub:       'Décrivez votre cours en quelques mots',
  t_course_not_found:   'Cours introuvable',
  t_no_upcoming:        'Aucun cours à venir',
  t_no_upcoming_sub:    'Publiez un nouveau cours pour commencer',
  t_edit_error:         'Impossible de modifier',
  t_delete_error:       'Impossible de supprimer',
  t_delete_error_sub:   'Une erreur est survenue',
  t_title_link_req:     'Titre et lien requis',
  t_fill_title_link:    'Remplis le titre et le lien',
  t_doc_name_req:       'Donne un nom au document',
  t_passwd_req:         'Mot de passe requis',
  t_content_published:  'Contenu publié !',
  t_generate_first:     'Génère un code d\'abord',
  t_no_students_msg:    'Aucun élève inscrit pour l\'instant',
  t_select_course:      'Sélectionnez le cours d\'abord',
  btn_oui:              'Oui',
  btn_non:              'Non',
  legal_back:           '← Retour à l\'app',

  // Matières — noms affichés (filtres + onboarding)
  mat_pop_title:   'Matières populaires',
  mat_maths:       'Maths',
  mat_desc_maths:  'Algèbre, géométrie, analyse…',
  mat_physique:    'Physique',
  mat_desc_phys:   'Mécanique, optique, thermodynamique…',
  mat_chimie:      'Chimie',
  mat_desc_chim:   'Organique, minérale, solutions…',
  mat_informatique:'Informatique',
  mat_desc_info:   'Algorithmes, web, bases de données…',
  mat_anglais:     'Anglais',
  mat_desc_angl:   'Conversation, grammaire, TOEFL…',
  mat_francais_l:  'Français',
  mat_desc_fr:     'Dissertation, grammaire, littérature…',
  mat_espagnol:    'Espagnol',
  mat_desc_esp:    'Conversation, conjugaison, DELE…',
  mat_histoire:    'Histoire-Géo',
  mat_desc_hist:   'Chronologie, cartographie, géopolitique…',
  mat_philo:       'Philosophie',
  mat_desc_philo:  'Dissertation, éthique, épistémologie…',
  mat_svt:         'SVT / Biologie',
  mat_desc_svt:    'Génétique, écologie, anatomie…',
  mat_musique:     'Musique',
  mat_desc_mus:    'Solfège, instrument, théorie…',
  mat_python:      'Python',
  mat_desc_py:     'Scripts, data science, automatisation…',
  mat_physchim:    'Physique-Chimie',
  mat_economie:    'Économie',
  mat_allemand:    'Allemand',

  // Filtres
  filter_add_custom:   'Ajouter une matière personnalisée',
  filter_custom_ph:    'Ex: architecture, latin…',

  // Chips barre de filtres
  fchip_maths:        'Maths',
  fchip_physique:     'Physique',
  fchip_informatique: 'Info',
  fchip_langues:      'Langues',
  fchip_economie:     'Éco',
  fchip_soir:         'Ce soir',
  fchip_weekend:      'Week-end',
  fchip_histoire:     'Histoire',
  fchip_philosophie:  'Philo',
  fchip_chimie:       'Chimie',
  fchip_biologie:     'Bio',
  fchip_sport:        'Sport',
  fchip_musique:      'Musique',
  fchip_droit:        'Droit',

  // Matières complètes (MATIERES array)
  mat_francais:       'Français',
  mat_stats:          'Statistiques',
  mat_astro:          'Astronomie',
  mat_geologie:       'Géologie',
  mat_medecine:       'Médecine / Santé',
  mat_ecologie:       'Écologie',
  mat_javascript:     'JavaScript',
  mat_devweb:         'Développement web',
  mat_data:           'Data Science',
  mat_ia:             'IA & Machine Learning',
  mat_electronique:   'Électronique',
  mat_design:         'Design / UI',
  mat_cyber:          'Cybersécurité',
  mat_nocode:         'No-code',
  mat_blockchain:     'Blockchain',
  mat_italien:        'Italien',
  mat_portugais:      'Portugais',
  mat_arabe:          'Arabe',
  mat_chinois:        'Chinois',
  mat_japonais:       'Japonais',
  mat_russe:          'Russe',
  mat_coreen:         'Coréen',
  mat_hindi:          'Hindi',
  mat_latin:          'Latin',
  mat_lsf:            'Langue des signes',
  mat_ecriture:       'Écriture créative',
  mat_theatre:        'Théâtre',
  mat_cinema:         'Cinéma / Vidéo',
  mat_bd:             'BD / Manga',
  mat_dessin:         'Dessin',
  mat_peinture:       'Peinture',
  mat_aquarelle:      'Aquarelle',
  mat_arts:           'Arts plastiques',
  mat_calligraphie:   'Calligraphie',
  mat_photo:          'Photographie',
  mat_illustration:   'Illustration',
  mat_piano:          'Piano',
  mat_guitare:        'Guitare',
  mat_chant:          'Chant',
  mat_batterie:       'Batterie',
  mat_violon:         'Violon',
  mat_saxo:           'Saxophone',
  mat_psycho:         'Psychologie',
  mat_socio:          'Sociologie',
  mat_geographie:     'Géographie',
  mat_sciencespol:    'Sciences politiques',
  mat_anthropo:       'Anthropologie',
  mat_compta:         'Comptabilité',
  mat_finance:        'Finance',
  mat_marketing:      'Marketing',
  mat_droit:          'Droit',
  mat_entrepreneuriat:'Entrepreneuriat',
  mat_gestion:        'Gestion de projet',
  mat_communication:  'Communication',
  mat_rh:             'RH & Recrutement',
  mat_immo:           'Immobilier',
  mat_architecture:   'Architecture',
  mat_prepa:          'CPGE / Prépa',
  mat_pass:           'Médecine (PASS/LAS)',
  mat_sciencespo:     'Sciences Po',
  mat_toefl:          'TOEFL / IELTS',
  mat_gmat:           'GMAT / GRE',
  mat_sport:          'Sport / EPS',
  mat_fitness:        'Fitness',
  mat_yoga:           'Yoga / Méditation',
  mat_martial:        'Arts martiaux',
  mat_danse:          'Danse',
  mat_natation:       'Natation',
  mat_tennis:         'Tennis',
  mat_football:       'Football',
  mat_basket:         'Basket',
  mat_running:        'Running',
  mat_boxe:           'Boxe / MMA',
  mat_golf:           'Golf',
  mat_nutrition:      'Nutrition',
  mat_devperso:       'Développement personnel',
  mat_cuisine:        'Cuisine',
  mat_patisserie:     'Pâtisserie',
  mat_jardinage:      'Jardinage',
  mat_bricolage:      'Bricolage',
  mat_couture:        'Couture',
  mat_broderie:       'Broderie',
  mat_poterie:        'Poterie',
  mat_jeux:           'Jeux / Gaming',
  mat_echecs:         'Échecs',
  mat_autre:          'Autre',

  // Profil completion — matières
  pc_mat_title:        'Quelles matières enseignez-vous ?',
  pc_mat_search_ph:    'Ex : Maths, Physique, Anglais...',
  pc_mat_selected:     'Sélectionnées :',
  pc_mode_sep:         'Mode de cours',
  mode_both:           'Les deux',
  lbl_rechercher:      'Rechercher',

  // Wizard création de cours — labels & placeholders
  cr_step_code_acces:  'Code d\'accès généré',
  cr_step_titre_ph:    'Ex : Algèbre pour débutants…',
  cr_step_mat_ph:      'Rechercher une matière…',
  cr_step_date_lbl:    'Date du cours',
  cr_step_heure_lbl:   'Heure de début',
  cr_step_duree_lbl:   'Durée (min)',
  cr_step_ville_lbl:   'Ville ou arrondissement',
  cr_step_ville_ph:    'Ex : Paris 5e, Lyon 3e…',
  cr_step_ville_note:  'Visible publiquement — les élèves pourront filtrer par lieu.',
  cr_step_visio_title: 'Lien généré automatiquement',
  cr_step_visio_desc:  'Un lien Jitsi sera créé pour votre cours. Vous pourrez le modifier depuis Mes cours après publication.',
  cr_step_dom_lbl:     'Adresse exacte',
  cr_step_dom_ph:      'Ex : 12 rue de la Paix, Paris…',
  cr_step_dom_note:    'Partagée avec les élèves inscrits uniquement, selon vos paramètres.',
  cr_step_etab_lbl:    'Nom de l\'établissement',
  cr_step_etab_ph:     'Ex : Collège Victor Hugo, Lycée Pasteur…',
  cr_step_etab_note:   'Partagé avec les élèves inscrits.',
  cr_step_autre_ph:    'Ex : 20 avenue Larousse, Paris 5e…',
  cr_step_autre_note:  'Partagée avec les élèves inscrits.',
  cr_step_prix_lbl:    'Prix total (€)',
  cr_step_places_lbl:  'Places max',
  cr_step_ppeleve_lbl: 'Prix par élève',
  cr_step_desc_ph:     'Décrivez votre cours : niveau requis, programme, matériel…',
  cr_step_seances_lbl: 'Nombre de séances',

  // Récurrence
  rec_once:         'Une seule fois',
  rec_once_sub:     'Ce cours sera publié une seule fois',
  rec_weekly:       'Toutes les semaines',
  rec_weekly_sub:   'Même heure, chaque semaine',
  rec_biweekly:     'Toutes les 2 semaines',
  rec_biweekly_sub: 'Bi-hebdomadaire',
  rec_monthly:      'Tous les mois',
  rec_monthly_sub:  'Même jour, chaque mois',

  // Duplication
  dup_title:        'Dupliquer ce cours',
  dup_date_only:    'Choisir une nouvelle date',
  dup_date_sub:     'Tout le reste reste identique',
  dup_full:         'Modifier les détails',
  dup_full_sub:     'Revoir chaque étape',
  dup_field_mat:    'Matière',
  dup_field_niveau: 'Niveau',
  dup_field_mode:   'Mode',
  dup_field_prix:   'Prix',
  dup_field_places: 'Places',
  dup_field_lieu:   'Lieu',
  dup_visio_auto:   'Lien auto-généré',

  // Onglets compte
  acc_tab_cours:    'Mes cours',
  acc_tab_suivis:   'Suivis',
  acc_tab_histo:    'Historique',
  acc_tab_profil:   'Mon profil',
  acc_tab_revenus:  'Revenus',
  acc_tab_remb:     'Remboursements',
  acc_tab_avis:     'Mes avis',

  // États vides compte
  empty_no_cours_prof:    'Aucun cours à venir — créez-en un nouveau',
  empty_first_cours:      'Vous n\'avez pas encore créé de cours',
  btn_creer_cours:        'Créer un cours →',
  empty_no_resa_prof:     'Aucune réservation à venir',
  empty_resa_title:       'Aucun cours à venir',
  empty_resa_sub:         'Réservez votre premier cours et retrouvez-le ici',
  empty_resa_histo:       'Voir l\'historique',
  empty_resa_explorer:    'Explorer les cours →',
  section_mes_resa:       'Mes réservations',
  section_prochains:      'Prochains cours',

  // Profil prof sections
  prof_formations:    'Formations & Diplômes',
  prof_experiences:   'Expériences',

  // Sondage
  sondage_title:      'Créer un sondage',
  sondage_question_ph:'Votre question…',
  sondage_opt1_ph:    'Option 1',
  sondage_opt2_ph:    'Option 2',
  sondage_opt3_ph:    'Option 3 (optionnel)',
  sondage_send:       'Envoyer le sondage',
  sondage_err:        'Complète la question et au moins 2 options',
  sondage_share:      'Partagé dans la conversation',

  // Contenu messagerie
  contenu_fiche_ph:   'Contenu de la fiche…',
  contenu_msg_ph:     'Écris quelque chose pour tes élèves…',
  msg_send_all:       'Envoyer à tous',
  btn_deverrouiller:  'Déverrouiller',
  vis_label:          'Visibilité',
  vis_desc:           'Choisir qui peut accéder à ce contenu',

  // Recherche
  search_title:       'Que cherches-tu ?',
  search_sub:         'Matière · Professeur · Code privé',

  // Titres étapes wizard création (STEP_DEFS)
  step_mode_q:      'Type de cours',
  step_mode_h:      'Présentiel en personne ou visio en ligne',
  step_prive_q:     'Visibilité',
  step_prive_h:     'Un cours privé n\'est pas visible publiquement — accès par code unique',
  step_titre_q:     'Titre du cours',
  step_titre_h:     'Donnez un titre clair et accrocheur',
  step_matiere_q:   'Quelle matière ?',
  step_matiere_h:   'Choisissez la discipline',
  step_niveau_q:    'Niveau visé',
  step_niveau_h:    'Quel public ciblez-vous ?',
  step_datetime_q:  'Quand ?',
  step_datetime_h:  'Date et heure du cours',
  step_lieu_q:      'Où ?',
  step_lieu_h:      'Ville, adresse — ou lien généré pour la visio',
  step_prix_q:      'Prix & places',
  step_prix_h:      'Prix total que vous souhaitez recevoir',
  step_desc_q:      'Description',
  step_desc_h:      'Détails sur votre cours (optionnel)',
  step_rec_q:       'Récurrence',
  step_rec_h:       'Publiez une seule fois ou programmez plusieurs séances',

  // Ancien formulaire CR (index.html)
  cr_titre_ph:      'Ex : Algèbre linéaire pour débutants…',
  cr_section_format:'Format',
  cr_section_quandou:'Quand & Où',
  cr_section_pratique:'Infos pratiques',
  cr_section_options:'Options',
  cr_lieu_ph:       'Ville ou adresse…',
  cr_desc_ph:       'Niveau requis, programme abordé, prérequis…',
  cr_prix_total:    'Prix total',
  cr_duree:         'Durée',
  cr_date_lbl:      'Date',
  cr_heure_lbl:     'Heure',
  cr_prive_sub:     'Accès par code uniquement',
  niv_tous:         'Tous',
  niv_prim_lbl:     'Primaire',
  niv_col_lbl:      'Collège',
  niv_lyc_lbl:      'Lycée',

  // Recherche pill
  ph_search_pill:   'Maths, Python, anglais…',
  ph_enfant_prenom: 'Ex : Lucas',
  ph_etablissement: 'Ex : Collège Victor Hugo, Lycée Carnot…',
  espca_msg_ph:     'Écris un message pour tous les élèves inscrits à ce cours…',

  // Toast divers
  t_desabonne:        'Désabonné',
  t_desabonne_pre:    'Vous ne suivez plus ',
  t_msg_envoye:       'Message envoyé ✓',
  t_msg_envoye_sub:   'On vous répond sous 24h',
  t_aucun_cours_share_sub: 'Publiez un nouveau cours pour le partager',

  // États vides — mes profs / profil
  no_prof_followed:   'Aucun professeur suivi',
  follow_profs_desc:  'Suivez des professeurs pour voir leurs cours ici',
  explore_courses_btn:'Explorer les cours',
  no_course_published:'Aucun cours publié',
  no_reviews_yet:     'Aucun avis pour le moment',

  // Statistiques profil
  stat_profs_lbl:     'Profs',

  // Tutoriel professeur — navigation
  mpt_done:           'Terminé',
  mpt_skip:           'Passer',
};

// ── Utilitaire HTTP pour DeepL ─────────────────────────────────────────────
function deeplTranslate(texts, targetLang) {
  return new Promise(function(resolve, reject) {
    // Détecter si c'est une clé free (se termine par ':fx') ou pro
    var host = API_KEY.endsWith(':fx')
      ? 'api-free.deepl.com'
      : 'api.deepl.com';

    var body = 'source_lang=FR'
      + '&target_lang=' + targetLang
      + texts.map(function(t){ return '&text=' + encodeURIComponent(t); }).join('');

    var options = {
      hostname: host,
      path: '/v2/translate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': 'DeepL-Auth-Key ' + API_KEY
      }
    };

    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c){ data += c; });
      res.on('end', function(){
        try {
          var json = JSON.parse(data);
          if (json.translations) {
            resolve(json.translations.map(function(t){ return t.text; }));
          } else {
            reject(new Error('DeepL: ' + JSON.stringify(json)));
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Découpe un tableau en lots de `size`
function chunk(arr, size) {
  var res = [];
  for (var i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

// ── Traduction d'une langue complète ──────────────────────────────────────
async function translateLang(targetInfo) {
  var keys   = Object.keys(SOURCE);
  var values = Object.values(SOURCE);
  var translated = [];

  var batches = chunk(values, 50);
  for (var b = 0; b < batches.length; b++) {
    process.stdout.write('  lot ' + (b+1) + '/' + batches.length + '…');
    var results = await deeplTranslate(batches[b], targetInfo.deepl);
    translated = translated.concat(results);
    process.stdout.write(' ✓\n');
    // Petite pause pour ne pas dépasser le rate limit
    if (b < batches.length - 1) await new Promise(function(r){ setTimeout(r, 300); });
  }

  var obj = {};
  keys.forEach(function(k, i){ obj[k] = translated[i]; });
  return obj;
}

// ── Overrides manuels (contournent DeepL pour les mots ambigus) ───────────
// Clé → { langCode: traduction, … }
const MANUAL_OVERRIDES = {
  date_at: { fr:'à', en:'at', es:'a las', de:'um', it:'alle', pt:'às', da:'kl.', fi:'klo', sv:'kl.', pl:'o', el:'στις' },
  date_tbd:{ fr:"Date à définir", en:'Date TBD', es:'Fecha por confirmar', de:'Datum TBD', it:'Data da definire', pt:'Data a confirmar', da:'Dato TBD', fi:'Päivämäärä TBD', sv:'Datum TBD', pl:'Data TBD', el:'Ημερομηνία TBD' },
};

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌍  CoursPool — Génération des traductions via DeepL');
  console.log('   Source : ' + Object.keys(SOURCE).length + ' chaînes en français');
  console.log('   Cibles : ' + TARGETS.map(function(t){ return t.app; }).join(', ') + '\n');

  var allLangs = { fr: SOURCE };

  for (var i = 0; i < TARGETS.length; i++) {
    var tgt = TARGETS[i];
    console.log('→ ' + tgt.app.toUpperCase() + ' (' + tgt.deepl + ')');
    try {
      allLangs[tgt.app] = await translateLang(tgt);
      console.log('  ✅ ' + tgt.app + ' terminé\n');
    } catch(e) {
      console.error('  ❌ Erreur pour ' + tgt.app + ':', e.message);
      // On garde le français comme fallback pour cette langue
      allLangs[tgt.app] = SOURCE;
    }
    // Appliquer les overrides manuels
    Object.keys(MANUAL_OVERRIDES).forEach(function(key) {
      if(allLangs[tgt.app] && MANUAL_OVERRIDES[key][tgt.app]) {
        allLangs[tgt.app][key] = MANUAL_OVERRIDES[key][tgt.app];
      }
    });
  }
  // Overrides pour le français aussi
  Object.keys(MANUAL_OVERRIDES).forEach(function(key) {
    if(MANUAL_OVERRIDES[key].fr) allLangs.fr[key] = MANUAL_OVERRIDES[key].fr;
  });

  // ── Générer www/lang.js ────────────────────────────────────────────────
  var outPath = path.join(__dirname, '..', 'www', 'lang.js');

  var content = [
    '// ── CoursPool i18n — généré par scripts/translate.js — NE PAS ÉDITER MANUELLEMENT ──',
    '// Relancez `node scripts/translate.js --key=VOTRE_CLE` pour mettre à jour.',
    '',
    '(function(){',
    '  var _valid=[\'fr\',\'en\',\'es\',\'de\',\'it\',\'pt\',\'da\',\'fi\',\'sv\',\'pl\',\'el\'];',
    '  var _l;',
    '  try{_l=localStorage.getItem(\'cp_lang\');}catch(e){}',
    '  window._i18nLang=(_valid.indexOf(_l)!==-1)?_l:\'fr\';',
    '',
    '  window.LANGS=' + JSON.stringify(allLangs, null, 2) + ';',
    '',
    '  window.t=function(key){',
    '    var l=window.LANGS[window._i18nLang];',
    '    if(l&&l[key]!==undefined)return l[key];',
    '    var f=window.LANGS.fr;',
    '    return(f&&f[key]!==undefined)?f[key]:key;',
    '  };',
    '',
    '  window.setLang=function(code){',
    '    if(_valid.indexOf(code)===-1)return;',
    '    window._i18nLang=code;',
    '    try{localStorage.setItem(\'cp_lang\',code);}catch(e){}',
    '    if(typeof applyLang===\'function\')applyLang();',
    '  };',
    '})();',
  ].join('\n');

  fs.writeFileSync(outPath, content, 'utf8');
  var kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log('✅  www/lang.js généré (' + kb + ' Ko)');
  console.log('   Toutes les traductions sont prêtes. Déployez et testez !');
}

main().catch(function(e){ console.error('Fatal:', e); process.exit(1); });
