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
  bnav_creer:      'Créer',

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

  // Jours / mois (fmtDt)
  day_0: 'dim.', day_1: 'lun.', day_2: 'mar.', day_3: 'mer.',
  day_4: 'jeu.', day_5: 'ven.', day_6: 'sam.',
  month_0: 'janv.', month_1: 'févr.', month_2: 'mars', month_3: 'avr.',
  month_4: 'mai',   month_5: 'juin',  month_6: 'juil.', month_7: 'août',
  month_8: 'sept.', month_9: 'oct.',  month_10: 'nov.', month_11: 'déc.',

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
  }

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
