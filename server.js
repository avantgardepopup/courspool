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
  const { titre, sujet, couleur_sujet, background, date_heure, lieu, prix_total, places_max, professeur_id, emoji } = req.body;
  if (!titre || !date_heure || !lieu || !prix_total || !professeur_id) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  const { data, error } = await supabase
    .from('cours')
    .insert([{ titre, sujet, couleur_sujet, background, date_heure, lieu, prix_total, places_max, places_prises: 0, professeur_id, emoji }])
    .select();
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// RESERVATIONS — créer une réservation
app.post('/reservations', async (req, res) => {
  const { cours_id, user_id, montant_paye, type_paiement } = req.body;
  await supabase.rpc('increment_places', { cours_id });
  const { data, error } = await supabase
    .from('reservations')
    .insert([{ cours_id, user_id, montant_paye, type_paiement }]);
  if (error) return res.status(500).json({ error });
  res.json(data);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CoursPool API sur le port ' + PORT));
