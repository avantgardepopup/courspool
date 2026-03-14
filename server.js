const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Test
app.get('/', (req, res) => {
  res.json({ message: 'CoursPool API fonctionne !' });
});

// COURS — récupérer tous les cours
app.get('/cours', async (req, res) => {
  const { data, error } = await supabase
    .from('cours')
    .select(', professeurs()');
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// COURS — créer un cours
app.post('/cours', async (req, res) => {
  const { data, error } = await supabase
    .from('cours')
    .insert([req.body]);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// RESERVATIONS — créer une réservation
app.post('/reservations', async (req, res) => {
  const { cours_id, user_id, montant_paye, type_paiement } = req.body;
  // Incrémenter les places prises
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
    .select(', cours()')
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
    .select(', professeurs()')
    .eq('user_id', req.params.user_id);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// PROFESSEURS — récupérer un prof
app.get('/professeurs/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('professeurs')
    .select('*
