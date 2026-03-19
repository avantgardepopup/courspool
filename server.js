const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const compression = require('compression');
const { Resend } = require('resend');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Compression gzip — réduit la taille des réponses de 70%
app.use(compression());

app.use(cors());
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({limit: '10mb', extended: true}));

// Rate limiting simple — max 100 requêtes par minute par IP
const rateLimitMap = new Map();
app.use(function(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 100;
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return next();
  }
  
  const data = rateLimitMap.get(ip);
  if (now - data.start > windowMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return next();
  }
  
  if (data.count >= maxRequests) {
    return res.status(429).json({ error: 'Trop de requêtes. Réessayez dans une minute.' });
  }
  
  data.count++;
  next();
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// ============================================================
// EMAILS — domaine vérifié Resend
// ============================================================
const FROM_EMAIL = 'CoursPool <hello@courspool.com>'; // ← ton domaine vérifié Resend

// Template de base partagé
function emailBase(headerBg, headerContent, bodyContent) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F4F1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <!-- HEADER -->
  <tr><td style="background:${headerBg};padding:36px 32px;position:relative">
    <table cellpadding="0" cellspacing="0" width="100%"><tr>
      <td>
        <div style="display:inline-block;background:rgba(255,255,255,.2);border-radius:10px;padding:8px 14px;margin-bottom:16px">
          <span style="color:#fff;font-weight:800;font-size:15px;letter-spacing:-.01em">CoursPool</span>
        </div>
        ${headerContent}
      </td>
    </tr></table>
  </td></tr>
  <!-- BODY -->
  <tr><td style="padding:32px 32px 24px">${bodyContent}</td></tr>
  <!-- FOOTER -->
  <tr><td style="padding:20px 32px;border-top:1px solid #F0EDE8;text-align:center">
    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">
      CoursPool · Plateforme de cours partagés<br>
      <a href="https://courspool.vercel.app" style="color:#FF6B2B;text-decoration:none">courspool.vercel.app</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ── Email 1 : Bienvenue à l'inscription ──────────────────────
async function sendEmailWelcome(userEmail, userName, role) {
  const isProf = role === 'professeur';
  const header = `
    <h1 style="margin:0;font-size:26px;font-weight:800;color:#fff;line-height:1.2">
      Bienvenue sur<br>CoursPool ! 👋
    </h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,.8);font-size:14px">
      ${isProf ? 'Votre compte professeur est créé' : 'Votre compte élève est prêt'}
    </p>`;
  const body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${userName} !</p>
    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">
      ${isProf
        ? "Bienvenue dans la communauté CoursPool. Pour commencer à proposer des cours, vérifiez d'abord votre identité depuis l'application."
        : "Bienvenue sur CoursPool ! Explorez les cours disponibles près de chez vous et réservez votre première session."
      }
    </p>
    <div style="background:#FFF7F3;border-radius:14px;padding:20px;margin-bottom:24px">
      ${isProf ? `
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
          <div style="width:28px;height:28px;background:#FF6B2B;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
            <span style="color:#fff;font-size:12px;font-weight:800">1</span>
          </div>
          <div><p style="margin:0;font-size:13px;font-weight:700;color:#111">Envoyer votre CNI ou passeport</p>
          <p style="margin:4px 0 0;font-size:12px;color:#777">Vérification sous 5 min à 2 heures</p></div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
          <div style="width:28px;height:28px;background:#E8E3DC;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
            <span style="color:#999;font-size:12px;font-weight:800">2</span>
          </div>
          <div><p style="margin:0;font-size:13px;font-weight:700;color:#111">Compte activé par email</p>
          <p style="margin:4px 0 0;font-size:12px;color:#777">Vous recevrez un email de confirmation</p></div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="width:28px;height:28px;background:#E8E3DC;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
            <span style="color:#999;font-size:12px;font-weight:800">3</span>
          </div>
          <div><p style="margin:0;font-size:13px;font-weight:700;color:#111">Publiez votre premier cours</p>
          <p style="margin:4px 0 0;font-size:12px;color:#777">Et accueillez vos premiers élèves !</p></div>
        </div>
      ` : `
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111">Avec CoursPool vous pouvez :</p>
        <p style="margin:0;font-size:13px;color:#555;line-height:1.8">
          🔍 Explorer des cours près de chez vous<br>
          📅 Réserver en quelques secondes<br>
          💬 Contacter les professeurs directement<br>
          ⭐ Laisser des avis après vos cours
        </p>
      `}
    </div>
    <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">
      ${isProf ? "Ouvrir l'application →" : "Découvrir les cours →"}
    </a>`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: userEmail,
      subject: `Bienvenue sur CoursPool, ${userName} ! 🎉`,
      html: emailBase('linear-gradient(135deg,#FF8C55,#E04E10)', header, body)
    });
  } catch(e) { console.log('Email welcome error:', e.message); }
}

// ── Email 2 : Confirmation de réservation (élève) ────────────
async function sendEmailReservation(eleveEmail, eleveName, coursTitle, coursDate, coursLieu, montant) {
  const dateFormatted = coursDate ? new Date(coursDate).toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}) : coursDate;
  const header = `
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.2">
      Réservation confirmée !
    </h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,.8);font-size:14px">
      Votre place est assurée 🎓
    </p>`;
  const body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${eleveName},</p>
    <p style="margin:0 0 20px;font-size:14px;color:#555">Votre inscription est confirmée pour le cours suivant :</p>
    <div style="background:#FFF7F3;border:1px solid #FFD9C8;border-radius:16px;padding:22px;margin-bottom:24px">
      <p style="margin:0 0 14px;font-size:18px;font-weight:800;color:#111">${coursTitle}</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:6px 0">
          <span style="font-size:13px;color:#888;display:inline-block;width:20px">📅</span>
          <span style="font-size:13px;color:#555;font-weight:500">${dateFormatted}</span>
        </td></tr>
        <tr><td style="padding:6px 0">
          <span style="font-size:13px;color:#888;display:inline-block;width:20px">📍</span>
          <span style="font-size:13px;color:#555;font-weight:500">${coursLieu}</span>
        </td></tr>
        <tr><td style="padding:12px 0 0">
          <div style="display:inline-block;background:linear-gradient(135deg,#FF8C55,#E04E10);border-radius:10px;padding:8px 16px">
            <span style="font-size:20px;font-weight:800;color:#fff">${montant}€</span>
            <span style="font-size:12px;color:rgba(255,255,255,.8);margin-left:4px">payé</span>
          </div>
        </td></tr>
      </table>
    </div>
    <p style="margin:0 0 24px;font-size:13px;color:#888;line-height:1.6">
      Retrouvez toutes vos réservations dans la section <strong>Mon profil</strong> de l'application.
    </p>
    <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">
      Voir dans l'application →
    </a>`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: eleveEmail,
      subject: `✅ Réservation confirmée — ${coursTitle}`,
      html: emailBase('linear-gradient(135deg,#FF8C55,#E04E10)', header, body)
    });
  } catch(e) { console.log('Email reservation error:', e.message); }
}

// ── Email 3 : Nouvelle inscription (prof) ──────────────────
async function sendEmailProfNewEleve(profEmail, profName, eleveName, coursTitle, montant) {
  const header = `
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.2">Nouvel élève inscrit !</h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,.8);font-size:14px">Votre cours fait des heureux</p>`;
  const body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
    <p style="margin:0 0 20px;font-size:14px;color:#555">
      <strong>${eleveName}</strong> vient de réserver une place dans votre cours.
    </p>
    <div style="background:#FFF7F3;border:1px solid #FFD9C8;border-radius:16px;padding:22px;margin-bottom:24px">
      <p style="margin:0 0 10px;font-size:17px;font-weight:800;color:#111">${coursTitle}</p>
      <div style="display:inline-block;background:linear-gradient(135deg,#22C069,#16A34A);border-radius:10px;padding:8px 16px">
        <span style="font-size:18px;font-weight:800;color:#fff">+${montant}€</span>
        <span style="font-size:12px;color:rgba(255,255,255,.8);margin-left:4px">encaissé</span>
      </div>
    </div>
    <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">
      Voir mes élèves →
    </a>`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: profEmail,
      subject: `Nouvelle inscription — ${coursTitle}`,
      html: emailBase('linear-gradient(135deg,#FF8C55,#E04E10)', header, body)
    });
  } catch(e) { console.log('Email prof error:', e.message); }
}

// ── Email 4 : Vérification compte prof ──────────────────────
// status: 'approved' | 'rejected_retry' | 'rejected_final'
async function sendEmailProfVerification(profEmail, profName, status, raison = '') {
  const isApproved = status === 'approved';
  const isRetry   = status === 'rejected_retry';
  const isFinal   = status === 'rejected_final';

  const headerBg = isApproved
    ? 'linear-gradient(135deg,#22C069,#16A34A)'
    : isFinal
      ? 'linear-gradient(135deg,#1F2937,#374151)'
      : 'linear-gradient(135deg,#EF4444,#DC2626)';

  const headerTitle = isApproved ? 'Compte activé !'
    : isFinal ? 'Compte non éligible'
    : 'Vérification refusée — Action requise';

  const headerSub = isApproved ? 'Vous êtes prêt à enseigner'
    : isFinal ? 'Votre demande a été définitivement refusée'
    : 'Vous pouvez renvoyer votre document';

  const raisonBlock = raison ? `
    <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:16px;margin-bottom:20px">
      <p style="margin:0;font-size:12px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Message de l'équipe CoursPool</p>
      <p style="margin:0;font-size:14px;color:#78350F;line-height:1.6">${raison}</p>
    </div>` : '';

  let body;
  if (isApproved) {
    body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7">Votre identité a été vérifiée. Vous pouvez dès maintenant publier vos cours et accueillir vos premiers élèves.</p>
    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:16px;padding:20px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#166534;line-height:1.8;font-weight:500">
        ✓ Votre profil est maintenant visible<br>✓ Vous pouvez créer et publier des cours<br>✓ Vous pouvez recevoir des paiements
      </p>
    </div>
    <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">Proposer mon premier cours →</a>`;
  } else if (isRetry) {
    body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#555;line-height:1.7">Votre demande de vérification n'a pas pu être acceptée en l'état.</p>
    ${raisonBlock}
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:16px;padding:20px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.8;font-weight:500">Ce qu'il faut vérifier :<br>· Photo nette, bien éclairée, sans reflet<br>· Document entier et non expiré<br>· Nom et prénom correspondant à votre profil</p>
    </div>
    <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:15px 28px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;text-align:center">Renvoyer ma pièce d'identité →</a>`;
  } else {
    body = `
    <p style="margin:0 0 16px;font-size:16px;color:#111;font-weight:600">Bonjour ${profName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#555;line-height:1.7">Après examen de votre dossier, nous ne sommes malheureusement pas en mesure de valider votre compte professeur sur CoursPool.</p>
    ${raisonBlock}
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:16px;padding:20px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#374151;line-height:1.8">Si vous pensez qu'il s'agit d'une erreur, vous pouvez nous contacter à <a href="mailto:hello@courspool.com" style="color:#FF6B2B">hello@courspool.com</a></p>
    </div>`;
  }

  const subject = isApproved
    ? `Votre compte CoursPool est activé, ${profName} !`
    : isFinal
      ? `Votre compte CoursPool — Décision finale`
      : `Vérification d'identité — Action requise`;

  const header = `
    <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.2">${headerTitle}</h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,.8);font-size:14px">${headerSub}</p>`;

  try {
    await resend.emails.send({ from: FROM_EMAIL, to: profEmail, subject, html: emailBase(headerBg, header, body) });
  } catch(e) { console.log('Email verification error:', e.message); }
}


// TEST
app.get('/', (req, res) => {
  res.json({ message: 'CoursPool API fonctionne !' });
});

// AUTH — inscription
app.post('/auth/register', async (req, res) => {
  const { email, password, prenom, nom, role } = req.body;
  if (!email || !password || !prenom || !role) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { prenom, nom, role }
  });
  if (error) return res.status(400).json({ error: error.message });
  await supabase.from('profiles').insert([{
    id: data.user.id, prenom, nom, email, role,
    statut: req.body.statut || null,
    niveau: req.body.niveau || null,
    matieres: req.body.matieres || null,
    verified: role === 'eleve' ? true : false
  }]);
  // Email de bienvenue
  const userName = (prenom + ' ' + (nom||'')).trim();
  sendEmailWelcome(email, prenom || userName, role).catch(() => {});
  res.json({ user: data.user });
});

// AUTH — connexion
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
  res.json({ user: data.user, session: data.session, profile });
});

// COURS — récupérer tous
app.get('/cours', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const sujet = req.query.sujet || null;
  const search = req.query.search || null;

  let query = supabase.from('cours').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const niveau_filter = req.query.niveau || null;
  if (sujet && sujet !== 'tous') query = query.ilike('sujet', '%' + sujet + '%');
  if (search) query = query.or('titre.ilike.%' + search + '%,sujet.ilike.%' + search + '%,lieu.ilike.%' + search + '%,prof_nom.ilike.%' + search + '%');
  if (niveau_filter) query = query.eq('niveau', niveau_filter);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error });
  res.json({ cours: data, total: count, page, limit, pages: Math.ceil(count / limit) });
});

// COURS — créer
app.post('/cours', async (req, res) => {
  const { titre, sujet, couleur_sujet, background, date_heure, lieu, prix_total, places_max, professeur_id, emoji, prof_nom, prof_photo, prof_initiales, prof_couleur, description, niveau } = req.body;
  if (!titre || !date_heure || !lieu || !prix_total || !professeur_id) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  const { data, error } = await supabase.from('cours')
    .insert([{ titre, sujet, couleur_sujet, background, date_heure, lieu, prix_total, places_max, places_prises: 0, professeur_id, emoji, prof_nom, prof_photo, prof_initiales, prof_couleur, description, niveau: niveau || null }])
    .select();
  if (error) return res.status(500).json({ error });
  // Push aux élèves qui suivent ce prof
  if (data && data[0] && professeur_id) {
    const titreNotif = data[0].titre || titre;
    (async () => {
      try {
        const { data: follows } = await supabase.from('follows').select('user_id').eq('professeur_id', professeur_id);
        if (!follows || !follows.length) return;
        const { data: profP } = await supabase.from('profiles').select('prenom,nom').eq('id', professeur_id).single();
        const profNom = profP ? (profP.prenom + ' ' + (profP.nom||'')).trim() : 'Un professeur';
        await Promise.all(follows.map(f => pushToUser(f.user_id, {
          title: `📚 Nouveau cours de ${profNom}`,
          body: `"${titreNotif}" est disponible — réservez avant que les places partent !`,
          tag: 'new-cours', icon: '/icon-192.png',
          data: { url: 'https://courspool.vercel.app' }
        })));
      } catch(e) {}
    })();
  }
  res.json(data);
});

// COURS — accès par code privé
app.get('/cours/code/:code', async (req, res) => {
  const { code } = req.params;
  if (!code) return res.status(400).json({ error: 'Code manquant' });
  try {
    const { data, error } = await supabase
      .from('cours')
      .select('*')
      .eq('code_acces', code.toUpperCase())
      .eq('prive', true)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Cours introuvable' });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// COURS — supprimer
app.delete('/cours/:id', async (req, res) => {
  const { error } = await supabase.from('cours').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error });
  res.json({ success: true });
});

// RESERVATIONS — créer
app.post('/reservations', async (req, res) => {
  const { cours_id, user_id, montant_paye, type_paiement } = req.body;
  if (!cours_id || !user_id) return res.status(400).json({ error: 'Données manquantes' });

  // Vérifier si déjà réservé
  const { data: existing } = await supabase.from('reservations')
    .select('id').eq('cours_id', cours_id).eq('user_id', user_id).single();
  if (existing) return res.status(400).json({ error: 'Vous avez déjà réservé ce cours' });

  // Créer la réservation
  const { data, error } = await supabase.from('reservations')
    .insert([{ cours_id, user_id, montant_paye: montant_paye||0, type_paiement: type_paiement||'total' }])
    .select();
  if (error) return res.status(500).json({ error: error.message });

  // Incrémenter places_prises
  const { data: coursData } = await supabase.from('cours').select('places_prises').eq('id', cours_id).single();
  const newCount = (coursData?.places_prises || 0) + 1;
  await supabase.from('cours').update({ places_prises: newCount }).eq('id', cours_id);

  res.json(data[0]);
});

// RESERVATIONS — réserver pour un ami
app.post('/reservations/ami', async (req, res) => {
  const { cours_id, user_id } = req.body;
  if (!cours_id || !user_id) return res.status(400).json({ error: 'Données manquantes' });
  const { data: coursData } = await supabase.from('cours').select('places_prises').eq('id', cours_id).single();
  const newCount = (coursData?.places_prises || 0) + 1;
  await supabase.from('cours').update({ places_prises: newCount }).eq('id', cours_id);
  res.json({ success: true });
});

// RESERVATIONS — récupérer par user
app.get('/reservations/:user_id', async (req, res) => {
  const { data, error } = await supabase.from('reservations')
    .select('*, cours(*)')
    .eq('user_id', req.params.user_id);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// STRIPE — créer une session de paiement
app.post('/stripe/checkout', async (req, res) => {
  const { cours_id, user_id, montant, cours_titre, pour_ami } = req.body;
  if (!cours_id || !user_id || !montant) return res.status(400).json({ error: 'Données manquantes' });

  try {
    const baseUrl = 'https://courspool.vercel.app';
    const successUrl = `https://devoted-achievement-production-fdfa.up.railway.app/stripe/success?cours_id=${cours_id}&user_id=${user_id}&montant=${montant}&pour_ami=${pour_ami?'1':'0'}&redirect=${encodeURIComponent(baseUrl)}`;
    const cancelUrl = baseUrl + '?cancelled=1';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: cours_titre || 'Réservation CoursPool' },
          unit_amount: Math.round(montant * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { cours_id, user_id, montant: montant.toString() },
    });
    res.json({ url: session.url });
  } catch (e) {
    console.log('Stripe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// STRIPE — page de succès qui crée la réservation et redirige
app.get('/stripe/success', async (req, res) => {
  const { cours_id, user_id, montant, pour_ami, redirect } = req.query;
  if (!cours_id || !user_id) return res.redirect(redirect || 'https://courspool.vercel.app');

  try {
    // Vérifier si déjà réservé (sauf pour ami)
    if (pour_ami !== '1') {
      const { data: existing } = await supabase.from('reservations')
        .select('id').eq('cours_id', cours_id).eq('user_id', user_id).single();
      if (existing) {
        return res.redirect((redirect || 'https://courspool.vercel.app') + '?paid=1&cours_id=' + cours_id);
      }
    }

    // Créer la réservation
    await supabase.from('reservations').insert([{
      cours_id, user_id,
      montant_paye: parseFloat(montant) || 0,
      type_paiement: pour_ami === '1' ? 'stripe_ami' : 'stripe'
    }]);

    // Incrémenter places
    const { data: coursData } = await supabase.from('cours').select('places_prises,titre,date_heure,lieu,professeur_id').eq('id', cours_id).single();
    await supabase.from('cours').update({ places_prises: (coursData?.places_prises || 0) + 1 }).eq('id', cours_id);

    // Envoyer emails
    try {
      const { data: eleve } = await supabase.from('profiles').select('email,prenom,nom').eq('id', user_id).single();
      const { data: prof } = await supabase.from('profiles').select('email,prenom,nom').eq('id', coursData?.professeur_id).single();
      if (eleve?.email) await sendEmailReservation(eleve.email, (eleve.prenom+' '+eleve.nom).trim(), coursData?.titre, coursData?.date_heure, coursData?.lieu, montant);
      if (prof?.email) await sendEmailProfNewEleve(prof.email, (prof.prenom+' '+prof.nom).trim(), (eleve?.prenom+' '+eleve?.nom||'').trim(), coursData?.titre, montant);
    } catch(e) {}
    // Push prof : nouvelle réservation
    if (coursData?.professeur_id) {
      const eleveName = (eleve?.prenom||'') + ' ' + (eleve?.nom||'');
      pushToUser(coursData.professeur_id, {
        title: '🎉 Nouvelle réservation !',
        body: `${eleveName.trim() || 'Un élève'} a réservé "${coursData?.titre}" (+${montant}€)`,
        tag: 'new-eleve', icon: '/icon-192.png',
        data: { url: 'https://courspool.vercel.app' }
      }).catch(() => {});
    }

    // Rediriger vers le site avec paramètre de succès
    res.redirect((redirect || 'https://courspool.vercel.app') + '?paid=1&cours_id=' + cours_id + (pour_ami==='1'?'&ami=1':''));
  } catch (e) {
    console.log('Stripe success error:', e.message);
    res.redirect(redirect || 'https://courspool.vercel.app');
  }
});

// STRIPE — confirmer paiement après redirect
app.post('/stripe/confirm', async (req, res) => {
  const { session_id, cours_id, user_id, pour_ami } = req.body;
  if (!session_id || !cours_id || !user_id) return res.status(400).json({ error: 'Données manquantes' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') return res.status(400).json({ error: 'Paiement non complété' });

    const montant = parseFloat(session.metadata?.montant || 0);

    // Vérifier si déjà réservé (seulement si pas pour ami)
    if (!pour_ami) {
      const { data: existing } = await supabase.from('reservations')
        .select('id').eq('cours_id', cours_id).eq('user_id', user_id).single();
      if (existing) return res.json({ success: true, already: true });
    }

    // Créer la réservation
    const { error } = await supabase.from('reservations')
      .insert([{ cours_id, user_id, montant_paye: montant, type_paiement: pour_ami ? 'stripe_ami' : 'stripe' }]);
    if (error) return res.status(500).json({ error: error.message });

    // Incrémenter places_prises
    const { data: coursData2 } = await supabase.from('cours').select('places_prises,titre,date_heure,lieu,professeur_id,prof_nom').eq('id', cours_id).single();
    const newCount = (coursData2?.places_prises || 0) + 1;
    await supabase.from('cours').update({ places_prises: newCount }).eq('id', cours_id);

    // Envoyer emails
    try {
      const { data: eleveProfile } = await supabase.from('profiles').select('email,prenom,nom').eq('id', user_id).single();
      const { data: profProfile } = await supabase.from('profiles').select('email,prenom,nom').eq('id', coursData2?.professeur_id).single();
      const eleveName = eleveProfile ? (eleveProfile.prenom + ' ' + eleveProfile.nom).trim() : 'Élève';
      const profName = profProfile ? (profProfile.prenom + ' ' + profProfile.nom).trim() : 'Professeur';
      if (eleveProfile?.email) await sendEmailReservation(eleveProfile.email, eleveName, coursData2?.titre, coursData2?.date_heure, coursData2?.lieu, montant);
      if (profProfile?.email) await sendEmailProfNewEleve(profProfile.email, profName, eleveName, coursData2?.titre, montant);
    } catch(e) { console.log('Email error:', e.message); }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/follows', async (req, res) => {
  const { user_id, professeur_id } = req.body;
  const { data, error } = await supabase.from('follows').insert([{ user_id, professeur_id }]);
  if (error) return res.status(500).json({ error });
  // Incrémenter le compteur d'élèves du prof
  const { data: profData } = await supabase.from('profiles').select('eleves_count').eq('id', professeur_id).single();
  const newCount = (profData?.eleves_count || 0) + 1;
  await supabase.from('profiles').update({ eleves_count: newCount }).eq('id', professeur_id);
  res.json({ success: true });
});

// FOLLOWS — récupérer
app.get('/follows/:user_id', async (req, res) => {
  const { data, error } = await supabase.from('follows').select('*').eq('user_id', req.params.user_id);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// EMAIL — vérification prof
// CONTACT — formulaire utilisateur → dashboard admin + email
app.post('/contact', async (req, res) => {
  const { email, sujet, message, nom, role, userId } = req.body;
  if (!email || !message) return res.status(400).json({ error: 'Données manquantes' });
  try {
    // 1. Stocker en base Supabase
    const { error: dbErr } = await supabase.from('contacts').insert([{
      email, sujet: sujet || 'Question générale', message,
      nom: nom || '', role: role || 'inconnu',
      user_id: userId || null,
      lu: false,
      created_at: new Date().toISOString()
    }]);
    if (dbErr) console.log('Contact DB error:', dbErr.message);

    // 2. Email de notification vers l'admin
    await resend.emails.send({
      from: FROM_EMAIL,
      to: 'avantgardepopup@gmail.com', // email admin
      replyTo: email,
      subject: `[Contact] ${sujet || 'Question'} — ${nom || email}`,
      html: emailBase(
        'linear-gradient(135deg,#6366F1,#4F46E5)',
        `<h1 style="margin:0;font-size:22px;font-weight:800;color:#fff">Nouveau message</h1>
         <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px">${sujet || 'Question générale'}</p>`,
        `<table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px">
          <tr><td style="padding:6px 0;font-size:13px;color:#888;width:80px">De</td><td style="font-size:13px;font-weight:600;color:#111">${nom || 'Anonyme'} &lt;${email}&gt;</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#888">Rôle</td><td style="font-size:13px;color:#555">${role || '—'}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#888">Sujet</td><td style="font-size:13px;font-weight:600;color:#111">${sujet || '—'}</td></tr>
        </table>
        <div style="background:#F8F7F5;border-radius:14px;padding:18px;margin-bottom:24px;border-left:3px solid #6366F1">
          <p style="margin:0;font-size:14px;color:#333;line-height:1.7;white-space:pre-wrap">${message}</p>
        </div>
        <a href="mailto:${email}" style="display:block;background:linear-gradient(135deg,#6366F1,#4F46E5);color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;text-align:center">Répondre à ${nom || email} →</a>`
      )
    }).catch(e => console.log('Contact email admin error:', e.message));

    // 3. Email de confirmation à l'utilisateur
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Nous avons bien reçu votre message — CoursPool',
      html: emailBase(
        'linear-gradient(135deg,#FF8C55,#E04E10)',
        `<h1 style="margin:0;font-size:22px;font-weight:800;color:#fff">Message reçu !</h1>
         <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px">On vous répond dans les 24h</p>`,
        `<p style="margin:0 0 16px;font-size:15px;color:#111;font-weight:600">Bonjour ${nom || ''} !</p>
         <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7">Votre message a bien été transmis à notre équipe. Nous vous répondrons sous 24h, du lundi au samedi.</p>
         <div style="background:#F8F7F5;border-radius:14px;padding:16px;margin-bottom:24px">
           <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.06em">Votre message</p>
           <p style="margin:0;font-size:13px;color:#555;line-height:1.6;white-space:pre-wrap">${message}</p>
         </div>
         <a href="https://courspool.vercel.app" style="display:block;background:linear-gradient(135deg,#FF8C55,#E04E10);color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;text-align:center">Retour à l'application →</a>`
      )
    }).catch(e => console.log('Contact email user error:', e.message));

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE user — suppression complète (profil + auth)
app.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Supprimer les données liées (non bloquant si table absente)
    await supabase.from('reservations').delete().eq('user_id', id).catch(e => console.log('del reservations:', e.message));
    await supabase.from('follows').delete().eq('user_id', id).catch(e => console.log('del follows:', e.message));
    await supabase.from('follows').delete().eq('professeur_id', id).catch(()=>{});
    await supabase.from('push_subscriptions').delete().eq('user_id', id).catch(()=>{});
    await supabase.from('contacts').delete().eq('user_id', id).catch(()=>{});
    await supabase.from('notations').delete().eq('eleve_id', id).catch(()=>{});
    await supabase.from('notations').delete().eq('professeur_id', id).catch(()=>{});
    await supabase.from('messages').delete().eq('expediteur_id', id).catch(()=>{});
    await supabase.from('messages').delete().eq('destinataire_id', id).catch(()=>{});
    await supabase.from('cours').delete().eq('professeur_id', id).catch(()=>{});
    // 2. Supprimer le profil
    const { error: profErr } = await supabase.from('profiles').delete().eq('id', id);
    if (profErr) console.log('del profile error:', profErr.message);
    // 3. Supprimer le compte Auth — nécessite service_role key
    try {
      const { error: authErr } = await supabase.auth.admin.deleteUser(id);
      if (authErr) console.log('Auth delete (non bloquant):', authErr.message);
    } catch(authEx) {
      console.log('Auth delete exception:', authEx.message);
    }
    res.json({ success: true });
  } catch(e) {
    console.log('DELETE user error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH profil — mise à jour verified / statut_compte (appelé depuis admin)
app.patch('/profiles/:id', async (req, res) => {
  const { id } = req.params;
  const allowedFields = ['verified', 'statut_compte', 'prenom', 'nom', 'matieres', 'niveau', 'statut', 'cni_uploaded'];
  const updates = {};
  allowedFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Aucun champ valide' });
  try {
    const { data, error } = await supabase.from('profiles').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, profile: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/email/verification', async (req, res) => {
  const { prof_id, status, raison } = req.body;
  if (!prof_id || !status) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const { data: prof } = await supabase.from('profiles').select('email,prenom,nom').eq('id', prof_id).single();
    if (!prof) return res.status(404).json({ error: 'Prof introuvable' });
    const profName = ((prof.prenom||'') + ' ' + (prof.nom||'')).trim();
    await sendEmailProfVerification(prof.email, profName, status, raison || '');
    // Mettre à jour le statut + raison en base selon le type de refus
    if (status === 'rejected_retry') {
      await supabase.from('profiles').update({ statut_compte: 'rejeté', cni_uploaded: false, rejection_reason: raison||'', can_retry_cni: true }).eq('id', prof_id);
    } else if (status === 'rejected_final') {
      await supabase.from('profiles').update({ statut_compte: 'bloqué', rejection_reason: raison||'', can_retry_cni: false }).eq('id', prof_id);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// STRIPE — récupérer les paiements réels
app.get('/stripe/payments', async (req, res) => {
  try {
    const payments = await stripe.paymentIntents.list({ limit: 100 });
    const result = payments.data.map(p => ({
      id: p.id,
      amount: p.amount / 100,
      currency: p.currency,
      status: p.status,
      created: new Date(p.created * 1000).toISOString(),
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// RESERVATIONS — liste élèves inscrits à un cours
app.get('/reservations/cours/:cours_id', async (req, res) => {
  try{
    const {data,error}=await supabase.from('reservations').select('id,user_id,cours_id,montant_paye,created_at').eq('cours_id',req.params.cours_id).order('created_at',{ascending:true});
    if(error)return res.status(500).json({error});
    const enriched=await Promise.all((data||[]).map(async(r)=>{
      const {data:p}=await supabase.from('profiles').select('prenom,nom,email').eq('id',r.user_id).single();
      return{reservation_id:r.id,user_id:r.user_id,cours_id:r.cours_id,montant_paye:r.montant_paye,created_at:r.created_at,prenom:p?.prenom||'',nom:p?.nom||'',email:p?.email||''};
    }));
    res.json(enriched);
  }catch(e){res.status(500).json({error:e.message});}
});

// RESERVATIONS — annuler une réservation élève
app.post('/reservations/:id/cancel', async (req, res) => {
  const {user_id,cours_id,montant}=req.body;
  try{
    const {data:reservation}=await supabase.from('reservations').select('*').eq('id',req.params.id).single();
    await supabase.from('reservations').delete().eq('id',req.params.id);
    const {data:cours}=await supabase.from('cours').select('places_prises').eq('id',cours_id).single();
    if(cours)await supabase.from('cours').update({places_prises:Math.max(0,(cours.places_prises||1)-1)}).eq('id',cours_id);
    let rembourse=false;
    if(reservation?.stripe_payment_intent_id){
      try{await stripe.refunds.create({payment_intent:reservation.stripe_payment_intent_id});rembourse=true;}catch(e){console.log('Refund error:',e.message);}
    }
    res.json({success:true,rembourse});
  }catch(e){res.status(500).json({error:e.message});}
});

// COURS — annuler cours complet + rembourser tous les élèves
app.post('/cours/:id/cancel', async (req, res) => {
  try{
    const {data:reservations}=await supabase.from('reservations').select('*').eq('cours_id',req.params.id);
    let remboursements=0;
    for(const r of(reservations||[])){
      await supabase.from('reservations').delete().eq('id',r.id);
      if(r.stripe_payment_intent_id){
        try{await stripe.refunds.create({payment_intent:r.stripe_payment_intent_id});remboursements++;}catch(e){console.log('Refund error:',e.message);}
      }else{remboursements++;}
    }
    await supabase.from('cours').delete().eq('id',req.params.id);
    res.json({success:true,remboursements});
  }catch(e){res.status(500).json({error:e.message});}
});

// STRIPE — paiements d'un prof
app.get('/stripe/payments/prof/:prof_id', async (req, res) => {
  try{
    const {data:cours}=await supabase.from('cours').select('id,titre').eq('professeur_id',req.params.prof_id);
    if(!cours||!cours.length)return res.json([]);
    const coursIds=cours.map(c=>c.id);
    const coursMap={};cours.forEach(c=>{coursMap[c.id]=c.titre;});
    const {data:reservations}=await supabase.from('reservations').select('cours_id,montant_paye,created_at').in('cours_id',coursIds).order('created_at',{ascending:false});
    if(!reservations)return res.json([]);
    const result=reservations.map(r=>({id:r.cours_id+'_'+r.created_at,amount:r.montant_paye||0,currency:'eur',status:'succeeded',created:r.created_at,cours_titre:coursMap[r.cours_id]||'Cours'}));
    res.json(result);
  }catch(e){res.status(500).json({error:e.message});}
});

// STRIPE CONNECT — créer compte
app.post('/stripe/connect/create', async (req, res) => {
  const {prof_id,email}=req.body;
  if(!prof_id||!email)return res.status(400).json({error:'Données manquantes'});
  try{
    const {data:prof}=await supabase.from('profiles').select('stripe_account_id').eq('id',prof_id).single();
    if(prof?.stripe_account_id)return res.json({account_id:prof.stripe_account_id,already_exists:true});
    const account=await stripe.accounts.create({type:'express',email,capabilities:{transfers:{requested:true},card_payments:{requested:true}},business_type:'individual',metadata:{prof_id}});
    await supabase.from('profiles').update({stripe_account_id:account.id}).eq('id',prof_id);
    res.json({account_id:account.id});
  }catch(e){res.status(500).json({error:e.message});}
});

// STRIPE CONNECT — setup intent IBAN
app.post('/stripe/connect/setup-intent', async (req, res) => {
  const {stripe_account_id}=req.body;
  if(!stripe_account_id)return res.status(400).json({error:'stripe_account_id manquant'});
  try{
    const setupIntent=await stripe.setupIntents.create({payment_method_types:['sepa_debit'],usage:'off_session'},{stripeAccount:stripe_account_id});
    res.json({client_secret:setupIntent.client_secret});
  }catch(e){res.status(500).json({error:e.message});}
});

// STRIPE CONNECT — IBAN sauvegardé
app.post('/stripe/connect/iban-saved', async (req, res) => {
  const {prof_id,stripe_account_id}=req.body;
  if(!prof_id)return res.status(400).json({error:'prof_id manquant'});
  try{
    await supabase.from('profiles').update({stripe_account_id,iban_configured:true}).eq('id',prof_id);
    res.json({success:true});
  }catch(e){res.status(500).json({error:e.message});}
});

// STRIPE CONNECT — statut par prof_id
app.get('/stripe/connect/status-prof/:prof_id', async (req, res) => {
  try{
    const {data:prof}=await supabase.from('profiles').select('stripe_account_id').eq('id',req.params.prof_id).single();
    if(!prof?.stripe_account_id)return res.json({stripe_account_id:null,charges_enabled:false,details_submitted:false});
    const account=await stripe.accounts.retrieve(prof.stripe_account_id);
    res.json({stripe_account_id:prof.stripe_account_id,charges_enabled:account.charges_enabled,payouts_enabled:account.payouts_enabled,details_submitted:account.details_submitted});
  }catch(e){res.status(500).json({error:e.message});}
});

// PROFILES — récupérer profil par ID
app.get('/profiles/:id', async (req, res) => {
  const {data,error}=await supabase.from('profiles').select('*').eq('id',req.params.id).single();
  if(error)return res.status(404).json({});
  res.json(data||{});
});

// MESSAGES — envoyer
app.post('/messages', async (req, res) => {
  const { expediteur_id, destinataire_id, contenu } = req.body;
  if (!expediteur_id || !destinataire_id || !contenu) return res.status(400).json({ error: 'Données manquantes' });
  const { data, error } = await supabase.from('messages')
    .insert([{ sender_id: expediteur_id, receiver_id: destinataire_id, contenu }])
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

// MESSAGES — récupérer conversation
app.get('/messages/:user1/:user2', async (req, res) => {
  const { user1, user2 } = req.params;
  const { data, error } = await supabase.from('messages')
    .select('*')
    .or(`and(sender_id.eq.${user1},receiver_id.eq.${user2}),and(sender_id.eq.${user2},receiver_id.eq.${user1})`)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// MESSAGES — toutes conversations d'un user
app.get('/conversations/:user_id', async (req, res) => {
  const { data, error } = await supabase.from('messages')
    .select('*')
    .or(`sender_id.eq.${req.params.user_id},receiver_id.eq.${req.params.user_id}`)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// MESSAGES — marquer comme lu
app.put('/messages/lu/:user_id', async (req, res) => {
  const { expediteur_id } = req.body;
  if (!expediteur_id) return res.status(400).json({ error: 'expediteur_id manquant' });
  const { error } = await supabase
    .from('messages')
    .update({ lu: true })
    .eq('receiver_id', req.params.user_id)
    .eq('sender_id', expediteur_id)
    .eq('lu', false);
  if (error) {
    console.log('Erreur lu:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ success: true });
});

// UPLOAD PHOTO PROFIL
app.post('/upload/photo', async (req, res) => {
  const { base64, userId, filename } = req.body;
  if (!base64 || !userId) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const buffer = Buffer.from(base64.split(',')[1], 'base64');
    const ext = (filename ? filename.split('.').pop().toLowerCase() : 'jpg').replace('jpeg','jpg');
    const validExt = ['jpg','jpeg','png','webp'].includes(ext) ? ext : 'jpg';
    const path = userId + '/avatar.' + validExt;
    const contentType = 'image/' + (validExt === 'jpg' ? 'jpeg' : validExt);
    // Essayer d'uploader
    const { error: uploadError } = await supabase.storage.from('photos').upload(path, buffer, { contentType, upsert: true });
    if (uploadError) {
      // Si bucket n'existe pas, sauvegarder en base64 directement dans le profil
      console.log('Storage error:', uploadError.message);
      await supabase.from('profiles').update({ photo_url: base64 }).eq('id', userId);
      return res.json({ url: base64 });
    }
    const { data: urlData } = supabase.storage.from('photos').getPublicUrl(path);
    const publicUrl = urlData.publicUrl + '?t=' + Date.now();
    await supabase.from('profiles').update({ photo_url: publicUrl }).eq('id', userId);
    res.json({ url: publicUrl });
  } catch(e) {
    console.log('Upload error:', e.message);
    // Fallback : sauvegarder base64 dans le profil
    try {
      await supabase.from('profiles').update({ photo_url: base64 }).eq('id', userId);
      res.json({ url: base64 });
    } catch(e2) {
      res.status(500).json({ error: e.message });
    }
  }
});

// NOTATIONS — noter un cours
app.post('/notations', async (req, res) => {
  const { eleve_id, professeur_id, cours_id, note, commentaire } = req.body;
  if (!eleve_id || !professeur_id || !cours_id || !note) return res.status(400).json({ error: 'Données manquantes' });
  const { data, error } = await supabase.from('notations')
    .upsert([{ eleve_id, professeur_id, cours_id, note, commentaire }], { onConflict: 'eleve_id,cours_id' })
    .select();
  if (error) return res.status(500).json({ error });
  const { data: notes } = await supabase.from('notations').select('note').eq('professeur_id', professeur_id);
  if (notes && notes.length > 0) {
    const moyenne = (notes.reduce((a, b) => a + b.note, 0) / notes.length).toFixed(1);
    await supabase.from('profiles').update({ note_moyenne: moyenne }).eq('id', professeur_id);
  }
  res.json(data[0]);
});

// NOTATIONS — récupérer par prof
app.get('/notations/:professeur_id', async (req, res) => {
  const { data, error } = await supabase.from('notations')
    .select('*').eq('professeur_id', req.params.professeur_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ============================================================
// PUSH NOTIFICATIONS — web-push VAPID
// ============================================================
let webpush;
try {
  webpush = require('web-push');
  webpush.setVapidDetails(
    'mailto:hello@courspool.com',
    process.env.VAPID_PUBLIC_KEY  || 'BDyXpxjqx8h9llIzLNcaYdMpEX_jbkqEt4fjXOV_bSgENcpW7KaPFUHEjk0uXKT--ZajXK_zAJwgplwNz3j4jA8',
    process.env.VAPID_PRIVATE_KEY || 'cbNwfClkXILrevGfrI1bPQF_AI9ExpvZ8CC3GdCkt9E'
  );
} catch(e) { console.log('web-push non installé:', e.message); }

// Helper : envoyer une notif à un abonnement, silencieux en cas d'erreur
async function sendPushToSub(sub, payload) {
  if (!webpush || !sub) return;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
  } catch(e) {
    // Abonnement expiré → supprimer
    if (e.statusCode === 410 || e.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).catch(() => {});
    }
  }
}

// Helper : envoyer à tous les users d'un rôle
async function broadcastToRole(role, payload) {
  const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('role', role);
  if (!subs || !subs.length) return 0;
  await Promise.all(subs.map(s => sendPushToSub({
    endpoint: s.endpoint,
    keys: { auth: s.auth, p256dh: s.p256dh }
  }, payload)));
  return subs.length;
}

// Helper : envoyer à un user spécifique
async function pushToUser(userId, payload) {
  const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', userId);
  if (!subs || !subs.length) return;
  await Promise.all(subs.map(s => sendPushToSub({
    endpoint: s.endpoint,
    keys: { auth: s.auth, p256dh: s.p256dh }
  }, payload)));
}

// PUSH — s'abonner
app.post('/push/subscribe', async (req, res) => {
  const { subscription, user_id, role } = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Abonnement invalide' });
  try {
    await supabase.from('push_subscriptions').upsert([{
      endpoint: subscription.endpoint,
      auth: subscription.keys?.auth,
      p256dh: subscription.keys?.p256dh,
      user_id: user_id || null,
      role: role || 'inconnu',
      updated_at: new Date().toISOString()
    }], { onConflict: 'endpoint' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUSH — se désabonner
app.delete('/push/subscribe', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id manquant' });
  try {
    await supabase.from('push_subscriptions').delete().eq('user_id', user_id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUSH — notif prof : un élève a réservé son cours (appelé dans stripe/success)
app.post('/push/prof-new-eleve', async (req, res) => {
  const { prof_id, eleve_nom, cours_titre, montant } = req.body;
  if (!prof_id) return res.status(400).json({ error: 'prof_id manquant' });
  await pushToUser(prof_id, {
    title: '🎉 Nouvelle réservation !',
    body: `${eleve_nom || 'Un élève'} vient de réserver "${cours_titre}" (+${montant}€)`,
    tag: 'new-eleve',
    icon: '/icon-192.png',
    data: { url: 'https://courspool.vercel.app' }
  });
  res.json({ success: true });
});

// PUSH — notif élève : un prof suivi publie un cours
app.post('/push/new-cours', async (req, res) => {
  const { prof_id, cours_titre, cours_id } = req.body;
  if (!prof_id) return res.status(400).json({ error: 'prof_id manquant' });
  try {
    // Récupérer tous les élèves qui suivent ce prof
    const { data: follows } = await supabase.from('follows').select('user_id').eq('professeur_id', prof_id);
    if (!follows || !follows.length) return res.json({ success: true, sent: 0 });
    const { data: profProfile } = await supabase.from('profiles').select('prenom,nom').eq('id', prof_id).single();
    const profNom = profProfile ? (profProfile.prenom + ' ' + (profProfile.nom||'')).trim() : 'Un prof';
    let sent = 0;
    await Promise.all(follows.map(async f => {
      await pushToUser(f.user_id, {
        title: `📚 Nouveau cours de ${profNom}`,
        body: `"${cours_titre}" est disponible — réservez avant que les places partent !`,
        tag: 'new-cours-' + cours_id,
        icon: '/icon-192.png',
        data: { url: 'https://courspool.vercel.app' }
      });
      sent++;
    }));
    res.json({ success: true, sent });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUSH — broadcast admin → tous les profs ou tous les élèves
app.post('/push/broadcast', async (req, res) => {
  const { role, title, body, url } = req.body;
  if (!role || !title || !body) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const payload = {
      title,
      body,
      tag: 'broadcast-' + Date.now(),
      icon: '/icon-192.png',
      data: { url: url || 'https://courspool.vercel.app' }
    };
    const sent = await broadcastToRole(role, payload);
    res.json({ success: true, sent });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUSH — relance profs inactifs (cron ou manuel via admin)
app.post('/push/relance-profs', async (req, res) => {
  try {
    // Profs vérifiés qui n'ont pas publié de cours depuis 14 jours
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: profs } = await supabase.from('profiles').select('id').eq('role', 'professeur').eq('verified', true);
    if (!profs || !profs.length) return res.json({ success: true, sent: 0 });
    const { data: recentCours } = await supabase.from('cours').select('professeur_id').gte('created_at', cutoff);
    const activeProfs = new Set((recentCours || []).map(c => c.professeur_id));
    const inactiveProfs = profs.filter(p => !activeProfs.has(p.id));
    let sent = 0;
    await Promise.all(inactiveProfs.map(async p => {
      await pushToUser(p.id, {
        title: '👋 Des élèves vous attendent !',
        body: "Vous n'avez pas publié de cours depuis un moment. Créez un nouveau cours et accueillez de nouveaux élèves.",
        tag: 'relance-prof',
        icon: '/icon-192.png',
        data: { url: 'https://courspool.vercel.app' }
      });
      sent++;
    }));
    res.json({ success: true, sent });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUSH — relance élèves inactifs
app.post('/push/relance-eleves', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
    const { data: eleves } = await supabase.from('profiles').select('id').eq('role', 'eleve');
    if (!eleves || !eleves.length) return res.json({ success: true, sent: 0 });
    const { data: recentRes } = await supabase.from('reservations').select('user_id').gte('created_at', cutoff);
    const activeEleves = new Set((recentRes || []).map(r => r.user_id));
    const inactiveEleves = eleves.filter(e => !activeEleves.has(e.id));
    let sent = 0;
    await Promise.all(inactiveEleves.map(async e => {
      await pushToUser(e.id, {
        title: '📚 De nouveaux cours vous attendent',
        body: "Des professeurs ont publié de nouveaux cours. Explorez les cours disponibles près de chez vous !",
        tag: 'relance-eleve',
        icon: '/icon-192.png',
        data: { url: 'https://courspool.vercel.app' }
      });
      sent++;
    }));
    res.json({ success: true, sent });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CoursPool API sur le port ' + PORT));
