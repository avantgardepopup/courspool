const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({limit: '10mb', extended: true}));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Test
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
    email,
    password,
    email_confirm: true,
    user_metadata: { prenom, nom, role }
  });
  if (error) return res.status(400).json({ error: error.message });
  await supabase.from('profiles').insert([{
    id: data.user.id,
    prenom,
    nom,
    email,
    role,
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
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) return res.status(400).json({ error: error.message });
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();
  res.json({ user: data.user, session: data.session, profile });
});

// COURS — récupérer tous les cours
app.get('/cours', async (req, res) => {
  const { data, error } = await supabase
    .from('cours')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// COURS — créer un cours
app.post('/cours', async (req, res) => {
const { titre, sujet, couleur_sujet, background, date_heure, lieu, prix_total, places_max, professeur_id, emoji, prof_nom, prof_photo, prof_initiales, prof_couleur, description } = req.body;
  if (!titre || !date_heure || !lieu || !prix_total || !professeur_id) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  const { data, error } = await supabase
    .from('cours')
    .insert([{ titre, sujet, couleur_sujet, background, date_heure, lieu, prix_total, places_max, places_prises: 0, professeur_id, emoji, prof_nom, prof_photo, prof_initiales, prof_couleur, description }])
    .select();
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// RESERVATIONS — créer une réservation
app.post('/reservations', async (req, res) => {
  const { cours_id, user_id, montant_paye, type_paiement } = req.body;
  if (!cours_id || !user_id) return res.status(400).json({ error: 'Données manquantes' });
  await supabase.rpc('increment_places', { cours_id });
  const { data, error } = await supabase
    .from('reservations')
    .insert([{ cours_id, user_id, montant_paye: montant_paye||0, type_paiement: type_paiement||'total' }])
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

// RESERVATIONS — récupérer les réservations d'un user
app.get('/reservations/:user_id', async (req, res) => {
  const { data, error } = await supabase
    .from('reservations')
    .select('*, cours(*)')
    .eq('user_id', req.params.user_id);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// FOLLOWS — suivre un prof
app.post('/follows', async (req, res) => {
  const { data, error } = await supabase
    .from('follows')
    .insert([req.body]);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// FOLLOWS — récupérer les profs suivis
app.get('/follows/:user_id', async (req, res) => {
  const { data, error } = await supabase
    .from('follows')
    .select('*')
    .eq('user_id', req.params.user_id);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// PROFESSEURS — récupérer un prof
app.get('/professeurs/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('professeurs')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// MESSAGES — envoyer un message
app.post('/messages', async (req, res) => {
  const { data, error } = await supabase
    .from('messages')
    .insert([req.body]);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// MESSAGES — récupérer une conversation
app.get('/messages/:user1/:user2', async (req, res) => {
  const { user1, user2 } = req.params;
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or('and(sender_id.eq.'+user1+',receiver_id.eq.'+user2+'),and(sender_id.eq.'+user2+',receiver_id.eq.'+user1+')')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// UPLOAD PHOTO PROFIL
app.post('/upload/photo', async (req, res) => {
  const { base64, userId, filename } = req.body;
  if (!base64 || !userId) return res.status(400).json({ error: 'Données manquantes' });
  const buffer = Buffer.from(base64.split(',')[1], 'base64');
  const ext = filename ? filename.split('.').pop() : 'jpg';
  const path = userId + '/avatar.' + ext;
  const { data, error } = await supabase.storage
    .from('photos')
    .upload(path, buffer, { contentType: 'image/'+ext, upsert: true });
  if (error) return res.status(500).json({ error: error.message });
  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(path);
  // Mettre à jour le profil
  await supabase.from('profiles').update({ photo_url: urlData.publicUrl }).eq('id', userId);
  res.json({ url: urlData.publicUrl });
});

// SUPPRIMER UN COURS
app.delete('/cours/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('cours')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error });
  res.json({ success: true });
});

// MESSAGES - envoyer
app.post('/messages', async (req, res) => {
  const { expediteur_id, destinataire_id, cours_id, contenu } = req.body;
  if (!expediteur_id || !destinataire_id || !contenu) return res.status(400).json({ error: 'Données manquantes' });
  const { data, error } = await supabase.from('messages').insert([{ expediteur_id, destinataire_id, cours_id, contenu }]).select();
  if (error) return res.status(500).json({ error });
  res.json(data[0]);
});

// MESSAGES - récupérer conversation
app.get('/messages/:user1/:user2', async (req, res) => {
  const { user1, user2 } = req.params;
  const { data, error } = await supabase.from('messages')
    .select('*')
    .or(`and(expediteur_id.eq.${user1},destinataire_id.eq.${user2}),and(expediteur_id.eq.${user2},destinataire_id.eq.${user1})`)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// MESSAGES - toutes les conversations d'un user
app.get('/conversations/:user_id', async (req, res) => {
  const { data, error } = await supabase.from('messages')
    .select('*')
    .or(`expediteur_id.eq.${req.params.user_id},destinataire_id.eq.${req.params.user_id}`)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// MESSAGES - marquer comme lu
app.put('/messages/lu/:user_id', async (req, res) => {
  const { expediteur_id } = req.body;
  const { data, error } = await supabase.from('messages')
    .update({ lu: true })
    .eq('destinataire_id', req.params.user_id)
    .eq('expediteur_id', expediteur_id);
  if (error) return res.status(500).json({ error });
  res.json({ success: true });
});

// NOTATIONS - noter un cours
app.post('/notations', async (req, res) => {
  const { eleve_id, professeur_id, cours_id, note, commentaire } = req.body;
  if (!eleve_id || !professeur_id || !cours_id || !note) return res.status(400).json({ error: 'Données manquantes' });
  const { data, error } = await supabase.from('notations')
    .upsert([{ eleve_id, professeur_id, cours_id, note, commentaire }], { onConflict: 'eleve_id,cours_id' })
    .select();
  if (error) return res.status(500).json({ error });
  // Mettre à jour la note moyenne du prof
  const { data: notes } = await supabase.from('notations').select('note').eq('professeur_id', professeur_id);
  if (notes && notes.length > 0) {
    const moyenne = (notes.reduce((a, b) => a + b.note, 0) / notes.length).toFixed(1);
    await supabase.from('profiles').update({ note_moyenne: moyenne }).eq('id', professeur_id);
  }
  res.json(data[0]);
});

// NOTATIONS - récupérer les notations d'un prof
app.get('/notations/:professeur_id', async (req, res) => {
  const { data, error } = await supabase.from('notations')
    .select('*')
    .eq('professeur_id', req.params.professeur_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CoursPool API sur le port ' + PORT));
