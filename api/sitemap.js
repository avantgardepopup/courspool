const API = 'https://devoted-achievement-production-fdfa.up.railway.app';
const BASE = 'https://courspool.vercel.app';

module.exports = async function(req, res) {
  const today = new Date().toISOString().split('T')[0];

  // Pages statiques
  const staticUrls = [
    { loc: BASE,            priority: '1.0', changefreq: 'daily'   },
    { loc: `${BASE}/cgu`,   priority: '0.3', changefreq: 'monthly' },
    { loc: `${BASE}/privacy`, priority: '0.3', changefreq: 'monthly' },
    { loc: `${BASE}/contact`, priority: '0.4', changefreq: 'monthly' },
  ];

  // Cours à venir depuis l'API
  let coursUrls = [];
  try {
    const r = await fetch(`${API}/cours?page=1&limit=100`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const data = await r.json();
      const list = Array.isArray(data) ? data : (data.cours || []);
      const now = Date.now();
      coursUrls = list
        .filter(c => !c.prive && new Date(c.date_heure || '').getTime() > now)
        .map(c => ({
          loc: `${BASE}/cours/${c.id}`,
          lastmod: today,
          priority: '0.8',
          changefreq: 'daily'
        }));
    }
  } catch(e) {}

  const urlNodes = [...staticUrls, ...coursUrls].map(u =>
    `  <url>\n    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlNodes}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
};
