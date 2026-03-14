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

app.get('/', (req, res) => {
  res.json({ message: 'CoursPool API fonctionne !' });
});

app.get('/cours', async (req, res) => {
  const { data, error } = await supabase
    .from('cours')
    .select(', professeurs()');
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.post('/cours', async (req, res) => {
  const { data, error } = await supabase
    .from('cours')
    .insert([req.body]);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.post('/reservations', async (req, res) => {
  const { cours_id, user_id, montant_paye, type_paiement } = req.body;
  await supabase.rpc('increment_places', { cours_id });
  const { data, error } = await supabase
    .from('reservations')
    .insert([{ cours_id, user_id, montant_paye, type_paiement }]);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.get('/reservations/:user_id', async (req, res) => {
  const { data, error } = await supabase
    .from('reservations')
    .select(', cours()')
    .eq('user_id', req.params.user_id);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.post('/follows', async (req, res) => {
  const { data, error } = await supabase
    .from('follows')
    .insert([req.body]);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.get('/follows/:user_id', async (req, res) => {
  const { data, error } = await supabase
    .from('follows')
    .select(', professeurs()')
    .eq('user_id', req.params.user_id);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.get('/professeurs/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('professeurs')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(500).json({ error });
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CoursPool API sur le port ' + PORT));
