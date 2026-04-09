const fs = require('fs');
const path = require('path');

const API = 'https://devoted-achievement-production-fdfa.up.railway.app';

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = async function(req, res) {
  const id = req.query.id;
  if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) { res.redirect(302, '/'); return; }

  let prof = null;
  try {
    const r = await fetch(`${API}/profiles/${id}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) prof = await r.json();
  } catch(e) {}

  if (!prof || prof.error || prof.role !== 'professeur') {
    res.redirect(302, '/'); return;
  }

  const nm = [prof.prenom, prof.nom].filter(Boolean).join(' ') || 'Professeur';
  const matieres = Array.isArray(prof.matieres) ? prof.matieres.slice(0, 3).join(', ') : '';
  const title = `${nm} — Cours sur CoursPool`;
  const desc = [
    `${nm} propose des cours`,
    matieres ? `de ${matieres}` : null,
    prof.ville ? `à ${prof.ville}` : null,
    'sur CoursPool. Réservez une place et partagez les frais entre élèves.',
  ].filter(Boolean).join(' ');

  const canonicalUrl = `https://courspool.vercel.app/prof/${id}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    'name': nm,
    'jobTitle': 'Professeur particulier',
    'description': desc,
    'url': canonicalUrl,
    'address': prof.ville ? { '@type': 'PostalAddress', 'addressLocality': prof.ville } : undefined
  };

  const cleanJsonLd = JSON.parse(JSON.stringify(jsonLd));

  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  } catch(e) {
    res.redirect(302, '/'); return;
  }

  html = html
    .replace(/<title>[^<]*<\/title>/,
      `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/,
      `<meta name="description" content="${esc(desc)}">`)
    .replace(/<meta property="og:title"[^>]*>/,
      `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description"[^>]*>/,
      `<meta property="og:description" content="${esc(desc)}">`)
    .replace(/<meta property="og:url"[^>]*>/,
      `<meta property="og:url" content="${esc(canonicalUrl)}">`)
    .replace(/<meta name="twitter:title"[^>]*>/,
      `<meta name="twitter:title" content="${esc(title)}">`)
    .replace(/<meta name="twitter:description"[^>]*>/,
      `<meta name="twitter:description" content="${esc(desc)}">`)
    .replace('</head>',
      `<link rel="canonical" href="${esc(canonicalUrl)}">\n`
      + `<script type="application/ld+json">${JSON.stringify(cleanJsonLd).replace(/</g,'\\u003c').replace(/>/g,'\\u003e')}</script>\n`
      + `<script>window.__CP_DEEP__=${JSON.stringify({type:'prof',id:String(id)})};</script>\n`
      + '</head>'
    );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(html);
};
