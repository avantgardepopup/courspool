const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({limit: '10mb', extended: true}));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

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
    const { data: coursData } = await supabase.from('cours').select('places_prises').eq('id', cours_id).single();
    const newCount = (coursData?.places_prises || 0) + 1;
    await supabase.from('cours').update({ places_prises: newCount }).eq('id', cours_id);

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
