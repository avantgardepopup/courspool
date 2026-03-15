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

// EMAILS
async function sendEmailReservation(eleveEmail, eleveName, coursTitle, coursDate, coursLieu, montant) {
  try {
    await resend.emails.send({
      from: 'CoursPool <onboarding@resend.dev>',
      to: eleveEmail,
      subject: '✅ Réservation confirmée — ' + coursTitle,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#FF8C55,#E04E10);padding:32px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:24px">✅ Réservation confirmée !</h1>
          </div>
          <div style="padding:32px">
            <p style="font-size:16px;color:#111">Bonjour <strong>${eleveName}</strong>,</p>
            <p style="color:#555">Votre place est réservée pour :</p>
            <div style="background:#FFF2EC;border-radius:12px;padding:20px;margin:16px 0">
              <div style="font-size:18px;font-weight:700;color:#111;margin-bottom:8px">${coursTitle}</div>
              <div style="color:#555;font-size:14px">📅 ${coursDate}</div>
              <div style="color:#555;font-size:14px;margin-top:4px">📍 ${coursLieu}</div>
              <div style="color:#FF6B2B;font-size:18px;font-weight:700;margin-top:12px">${montant}€</div>
            </div>
            <p style="color:#555;font-size:14px">Retrouvez votre réservation dans l'app CoursPool.</p>
            <a href="https://courspool.vercel.app" style="display:inline-block;background:#FF6B2B;color:#fff;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:600;margin-top:8px">Voir dans l'app →</a>
          </div>
          <div style="padding:20px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee">CoursPool · Plateforme de cours partagés</div>
        </div>
      `
    });
  } catch(e) { console.log('Email reservation error:', e.message); }
}

async function sendEmailProfNewEleve(profEmail, profName, eleveName, coursTitle, montant) {
  try {
    await resend.emails.send({
      from: 'CoursPool <onboarding@resend.dev>',
      to: profEmail,
      subject: '🎉 Nouvelle inscription — ' + coursTitle,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#FF8C55,#E04E10);padding:32px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:24px">🎉 Nouvelle inscription !</h1>
          </div>
          <div style="padding:32px">
            <p style="font-size:16px;color:#111">Bonjour <strong>${profName}</strong>,</p>
            <p style="color:#555"><strong>${eleveName}</strong> vient de réserver une place dans votre cours :</p>
            <div style="background:#FFF2EC;border-radius:12px;padding:20px;margin:16px 0">
              <div style="font-size:18px;font-weight:700;color:#111;margin-bottom:8px">${coursTitle}</div>
              <div style="color:#FF6B2B;font-size:16px;font-weight:700">+${montant}€ encaissé</div>
            </div>
            <a href="https://courspool.vercel.app" style="display:inline-block;background:#FF6B2B;color:#fff;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:600;margin-top:8px">Voir mes élèves →</a>
          </div>
          <div style="padding:20px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee">CoursPool · Plateforme de cours partagés</div>
        </div>
      `
    });
  } catch(e) { console.log('Email prof error:', e.message); }
}

async function sendEmailProfVerification(profEmail, profName, status) {
  const isApproved = status === 'approved';
  try {
    await resend.emails.send({
      from: 'CoursPool <onboarding@resend.dev>',
      to: profEmail,
      subject: isApproved ? '✅ Compte vérifié — Bienvenue sur CoursPool !' : '❌ Vérification refusée',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
          <div style="background:${isApproved ? 'linear-gradient(135deg,#22C069,#16A34A)' : 'linear-gradient(135deg,#EF4444,#DC2626)'};padding:32px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:24px">${isApproved ? '✅ Compte vérifié !' : '❌ Vérification refusée'}</h1>
          </div>
          <div style="padding:32px">
            <p style="font-size:16px;color:#111">Bonjour <strong>${profName}</strong>,</p>
            ${isApproved
              ? '<p style="color:#555">Votre identité a été vérifiée. Vous pouvez maintenant publier des cours et recevoir des élèves !</p><a href="https://courspool.vercel.app" style="display:inline-block;background:#FF6B2B;color:#fff;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:600;margin-top:8px">Proposer mon premier cours →</a>'
              : '<p style="color:#555">Votre demande de vérification n\'a pas été acceptée. Vérifiez que votre pièce d\'identité est lisible et réessayez.</p>'
            }
          </div>
          <div style="padding:20px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee">CoursPool · Plateforme de cours partagés</div>
        </div>
      `
    });
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
  const { data, error } = await supabase.from('cours').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// COURS — créer
app.post('/cours', async (req, res) => {
  const { titre, sujet, couleur_sujet, background, date_heure, lieu, prix_total, places_max, professeur_id, emoji, prof_nom, prof_photo, prof_initiales, prof_couleur, description } = req.body;
  if (!titre || !date_heure || !lieu || !prix_total || !professeur_id) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  const { data, error } = await supabase.from('cours')
    .insert([{ titre, sujet, couleur_sujet, background, date_heure, lieu, prix_total, places_max, places_prises: 0, professeur_id, emoji, prof_nom, prof_photo, prof_initiales, prof_couleur, description }])
    .select();
  if (error) return res.status(500).json({ error });
  res.json(data);
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
  const { cours_id, user_id, montant, cours_titre, success_url, cancel_url } = req.body;
  if (!cours_id || !user_id || !montant) return res.status(400).json({ error: 'Données manquantes' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: cours_titre || 'Réservation CoursPool',
            description: 'Place pour le cours',
          },
          unit_amount: Math.round(montant * 100), // en centimes
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: success_url + '?session_id={CHECKOUT_SESSION_ID}&cours_id=' + cours_id + '&user_id=' + user_id,
      cancel_url: cancel_url,
      metadata: { cours_id, user_id, montant: montant.toString() },
    });
    res.json({ url: session.url, session_id: session.id });
  } catch (e) {
    console.log('Stripe error:', e.message);
    res.status(500).json({ error: e.message });
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
app.post('/email/verification', async (req, res) => {
  const { prof_id, status } = req.body;
  if (!prof_id || !status) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const { data: prof } = await supabase.from('profiles').select('email,prenom,nom').eq('id', prof_id).single();
    if (!prof) return res.status(404).json({ error: 'Prof introuvable' });
    const profName = ((prof.prenom||'') + ' ' + (prof.nom||'')).trim();
    await sendEmailProfVerification(prof.email, profName, status);
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
  const buffer = Buffer.from(base64.split(',')[1], 'base64');
  const ext = filename ? filename.split('.').pop() : 'jpg';
  const path = userId + '/avatar.' + ext;
  const { error } = await supabase.storage.from('photos').upload(path, buffer, { contentType: 'image/'+ext, upsert: true });
  if (error) return res.status(500).json({ error: error.message });
  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(path);
  await supabase.from('profiles').update({ photo_url: urlData.publicUrl }).eq('id', userId);
  res.json({ url: urlData.publicUrl });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CoursPool API sur le port ' + PORT));
