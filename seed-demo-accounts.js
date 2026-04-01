/**
 * Script de création des comptes de démonstration CoursPool
 * Usage : SUPABASE_URL=... SUPABASE_SECRET_KEY=... node seed-demo-accounts.js
 *
 * Nécessite la SERVICE ROLE KEY (pas la anon key) pour bypasser la vérification email.
 * Ne modifie aucune logique existante — insertions directes uniquement.
 */

'use strict';

// Support .env local si présent (sans dotenv — lecture manuelle pour éviter dep)
try {
  const fs = require('fs');
  const envPath = require('path').join(__dirname, '.env.seed');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
    console.log('📄  Variables chargées depuis .env.seed');
  }
} catch(e) {}

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY; // service_role key

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('❌  Variables manquantes. Exécuter avec :');
  console.error('   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node seed-demo-accounts.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ───────────────────────────────────────────────────────────────

function isoFuture(daysFromNow, hour = 14) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function createAuthUser(email, password, meta) {
  // Tenter de créer — si l'email existe déjà, récupérer l'utilisateur existant
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,       // bypass vérification email
    user_metadata: meta,
  });

  if (error) {
    if (error.message && error.message.toLowerCase().includes('already registered')) {
      // Récupérer l'utilisateur existant par email
      const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users?.find(u => u.email === email);
      if (existing) {
        console.log(`  ⚠️  Auth user existant récupéré : ${email} (${existing.id})`);
        // Mettre à jour le mot de passe
        await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
        return existing;
      }
    }
    throw new Error(`createUser(${email}) : ${error.message}`);
  }
  return data.user;
}

async function upsertProfile(profile) {
  const { error } = await supabase
    .from('profiles')
    .upsert(profile, { onConflict: 'id' });
  if (error) throw new Error(`upsertProfile(${profile.email}) : ${error.message}`);
}

async function insertCours(cours) {
  // Vérifier si un cours identique (même titre + professeur_id) existe déjà
  const { data: existing } = await supabase
    .from('cours')
    .select('id')
    .eq('professeur_id', cours.professeur_id)
    .eq('titre', cours.titre)
    .maybeSingle();

  if (existing) {
    console.log(`  ⚠️  Cours déjà existant, ignoré : "${cours.titre}"`);
    return existing.id;
  }

  const { data, error } = await supabase.from('cours').insert(cours).select('id').single();
  if (error) throw new Error(`insertCours("${cours.titre}") : ${error.message}`);
  return data.id;
}

// ── Compte élève ──────────────────────────────────────────────────────────

async function seedEleve() {
  console.log('\n👤  Création du compte élève…');

  const user = await createAuthUser(
    'demo.eleve@courspool.fr',
    'DemoEleve2025!',
    { prenom: 'Léa', nom: 'Martin', role: 'eleve' }
  );
  console.log(`  ✅  Auth user créé : ${user.id}`);

  await upsertProfile({
    id:             user.id,
    email:          'demo.eleve@courspool.fr',
    prenom:         'Léa',
    nom:            'Martin',
    role:           'eleve',
    statut_compte:  'actif',
    photo_url:      null,          // initiales affichées en fallback
    ville:          'Paris',
    ville_visible:  true,
    verified:       true,          // élèves sont vérifiés par défaut
    created_at:     new Date().toISOString(),
  });
  console.log('  ✅  Profil élève inséré');
  return user.id;
}

// ── Compte professeur vérifié ─────────────────────────────────────────────

async function seedProfVerifie() {
  console.log('\n👨‍🏫  Création du compte professeur vérifié…');

  const user = await createAuthUser(
    'demo.prof.verifie@courspool.fr',
    'DemoProf2025!',
    { prenom: 'Thomas', nom: 'Dupont', role: 'professeur' }
  );
  console.log(`  ✅  Auth user créé : ${user.id}`);

  await upsertProfile({
    id:              user.id,
    email:           'demo.prof.verifie@courspool.fr',
    prenom:          'Thomas',
    nom:             'Dupont',
    role:            'professeur',
    statut_compte:   'actif',
    photo_url:       null,
    bio:             'Professeur de mathématiques et physique depuis 8 ans. Ancien élève de Prépa MPSI. J\'adapte mes cours au rythme et aux objectifs de chaque élève.',
    matieres:        'Mathématiques, Physique',
    niveau:          'Lycée, Prépa, Université',
    statut:          'Professeur titulaire',
    ville:           'Paris',
    ville_visible:   true,
    // Vérification CNI activée directement
    verified:        true,
    cni_uploaded:    true,
    cni_url:         'demo_verified',   // placeholder — pas d'image réelle
    // Pas de diplôme ni casier pour la démo
    diplome_verifie: false,
    casier_verifie:  false,
    created_at:      new Date().toISOString(),
  });
  console.log('  ✅  Profil prof vérifié inséré (CNI ok, badge actif)');

  // ── 3 créneaux ──────────────────────────────────────────────────────────
  console.log('  📅  Création des créneaux…');

  const profNom      = 'Thomas Dupont';
  const profIni      = 'TD';
  const profCouleur  = 'linear-gradient(135deg,#FF8C55,#E04E10)';

  const cours = [
    {
      titre:          'Maths Terminale — Fonctions & Dérivées',
      sujet:          'Mathématiques',
      description:    'Révision complète des fonctions, limites et dérivées pour le bac. Exercices corrigés inclus.',
      date_heure:     isoFuture(3, 14),
      date_iso:       isoFuture(3, 14),
      lieu:           'Paris 5e — Bibliothèque',
      prix_total:     40,
      places_max:     4,
      places_prises:  1,
      mode:           'presentiel',
      niveau:         'Terminale',
      emoji:          '📐',
      couleur_sujet:  '#4F46E5',
      professeur_id:  user.id,
      prof_nom:       profNom,
      prof_initiales: profIni,
      prof_photo:     null,
      prof_couleur:   profCouleur,
      eleves_peuvent_ecrire: true,
      prive:          false,
      created_at:     new Date().toISOString(),
    },
    {
      titre:          'Physique — Mécanique & Énergie',
      sujet:          'Physique',
      description:    'Cours de mécanique newtonienne : forces, travail, énergie cinétique et potentielle. Exercices niveau Prépa.',
      date_heure:     isoFuture(7, 10),
      date_iso:       isoFuture(7, 10),
      lieu:           'Paris 6e — Café coworking',
      prix_total:     50,
      places_max:     3,
      places_prises:  0,
      mode:           'presentiel',
      niveau:         'Prépa MPSI',
      emoji:          '⚡',
      couleur_sujet:  '#0EA5E9',
      professeur_id:  user.id,
      prof_nom:       profNom,
      prof_initiales: profIni,
      prof_photo:     null,
      prof_couleur:   profCouleur,
      eleves_peuvent_ecrire: true,
      prive:          false,
      created_at:     new Date().toISOString(),
    },
    {
      titre:          'Maths Sup — Algèbre linéaire',
      sujet:          'Mathématiques',
      description:    'Introduction à l\'algèbre linéaire : espaces vectoriels, matrices, déterminants. En visio avec partage d\'écran.',
      date_heure:     isoFuture(10, 18),
      date_iso:       isoFuture(10, 18),
      lieu:           'En ligne (Zoom)',
      prix_total:     36,
      places_max:     5,
      places_prises:  2,
      mode:           'visio',
      niveau:         'Université L1/L2',
      emoji:          '🔢',
      couleur_sujet:  '#8B5CF6',
      professeur_id:  user.id,
      prof_nom:       profNom,
      prof_initiales: profIni,
      prof_photo:     null,
      prof_couleur:   profCouleur,
      eleves_peuvent_ecrire: true,
      prive:          false,
      created_at:     new Date().toISOString(),
    },
  ];

  for (const c of cours) {
    const id = await insertCours(c);
    console.log(`    ✅  Créneau créé : "${c.titre}" (id: ${id})`);
  }

  return user.id;
}

// ── Compte professeur non vérifié ────────────────────────────────────────

async function seedProfNonVerifie() {
  console.log('\n👤  Création du compte professeur non vérifié…');

  const user = await createAuthUser(
    'demo.prof.nonverifie@courspool.fr',
    'DemoProfNV2025!',
    { prenom: 'Sophie', nom: 'Bernard', role: 'professeur' }
  );
  console.log(`  ✅  Auth user créé : ${user.id}`);

  await upsertProfile({
    id:             user.id,
    email:          'demo.prof.nonverifie@courspool.fr',
    prenom:         'Sophie',
    nom:            'Bernard',
    role:           'professeur',
    statut_compte:  'en_attente_verification',
    photo_url:      null,
    bio:            'Professeure d\'anglais, spécialisée TOEIC/TOEFL. En attente de vérification d\'identité.',
    matieres:       'Anglais',
    niveau:         'Lycée, Adultes',
    statut:         'Professeure certifiée',
    ville:          'Lyon',
    ville_visible:  true,
    // Pas de vérification CNI
    verified:       false,
    cni_uploaded:   false,
    diplome_verifie: false,
    casier_verifie:  false,
    created_at:     new Date().toISOString(),
  });
  console.log('  ✅  Profil prof non vérifié inséré (en_attente_verification, aucun créneau)');
  return user.id;
}

// ── Main ──────────────────────────────────────────────────────────────────

(async () => {
  console.log('🚀  Seeding des comptes de démonstration CoursPool…');
  console.log(`    URL : ${SUPABASE_URL}`);

  try {
    const eleveId       = await seedEleve();
    const profVerifieId = await seedProfVerifie();
    const profNVId      = await seedProfNonVerifie();

    console.log('\n✅  Comptes créés avec succès :\n');
    console.log('  Élève           demo.eleve@courspool.fr          / DemoEleve2025!');
    console.log('  Prof vérifié    demo.prof.verifie@courspool.fr   / DemoProf2025!');
    console.log('  Prof non vér.   demo.prof.nonverifie@courspool.fr / DemoProfNV2025!');
    console.log('\n  IDs Supabase :');
    console.log(`    Élève          : ${eleveId}`);
    console.log(`    Prof vérifié   : ${profVerifieId}`);
    console.log(`    Prof non vér.  : ${profNVId}`);
    console.log('\n⚠️  Ne pas committer ce script en production avec des mots de passe en clair.');
  } catch (err) {
    console.error('\n❌  Erreur :', err.message);
    process.exit(1);
  }
})();
