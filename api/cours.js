const fs = require('fs');
const path = require('path');

const API = 'https://devoted-achievement-production-fdfa.up.railway.app';

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = async function(req, res) {
  const id = req.query.id;
  if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) { res.redirect(302, '/'); return; }

  let cours = null;
  try {
    const r = await fetch(`${API}/cours/${id}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) cours = await r.json();
  } catch(e) {}

  if (!cours || cours.error) { res.redirect(302, '/'); return; }

  const pricePerStudent = (cours.prix_total && cours.places_max)
    ? Math.ceil(cours.prix_total / cours.places_max)
    : null;

  const title = `${cours.titre} — CoursPool`;
  const desc = [
    `Cours de ${cours.sujet || cours.matiere || ''}`,
    cours.prof_nom   ? `par ${cours.prof_nom}`   : null,
    cours.niveau     ? `· ${cours.niveau}`        : null,
    cours.lieu       ? `à ${cours.lieu}`          : (cours.mode === 'visio' ? 'en visio' : null),
    pricePerStudent  ? `· ${pricePerStudent}€/élève` : null,
  ].filter(Boolean).join(' ') + '.';

  const canonicalUrl = `https://courspool.vercel.app/cours/${id}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    'name': cours.titre,
    'description': cours.description || desc,
    'provider': {
      '@type': 'Person',
      'name': cours.prof_nom || 'Professeur'
    },
    'courseMode': cours.mode === 'visio' ? 'Online' : 'Onsite',
    'offers': pricePerStudent ? {
      '@type': 'Offer',
      'price': String(pricePerStudent),
      'priceCurrency': 'EUR',
      'availability': (cours.places_prises || 0) < (cours.places_max || 1)
        ? 'https://schema.org/InStock'
        : 'https://schema.org/SoldOut'
    } : undefined,
    'location': cours.lieu ? { '@type': 'Place', 'name': cours.lieu } : undefined
  };

  // Enlever les clés undefined
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
      + `<script>window.__CP_DEEP__=${JSON.stringify({type:'cours',id:String(id)})};</script>\n`
      + '</head>'
    );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(html);
};
