// Vercel Serverless Function — liste les voix dispo sur GenAIPro Labs
// L'API key reste serveur (env GENAIPRO_API_KEY), jamais exposée au browser.
// Admin-only : sert au picker de voix par défaut (femme/homme) dans les settings.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = 'https://pxzfjnsngtjzfqmahgaj.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const GENAIPRO_API_KEY = process.env.GENAIPRO_API_KEY;

  if (!SUPABASE_SERVICE_KEY || !GENAIPRO_API_KEY) {
    return res.status(500).json({ error: 'Configuration manquante (SUPABASE_SERVICE_ROLE_KEY ou GENAIPRO_API_KEY)' });
  }

  // === 1. Auth Supabase + role admin ===
  const authHeader = req.headers['authorization'] || '';
  const callerJwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerJwt) return res.status(401).json({ error: 'Not authenticated' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${callerJwt}`, 'apikey': SUPABASE_SERVICE_KEY }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const user = await userRes.json();

  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  const profiles = await profileRes.json();
  if (!profiles[0] || profiles[0].role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  // === 2. Récupère les voix avec tous les filtres possibles ===
  // Doc: page_size (max 100), page (0-indexed), search, gender, age, accent, language, locale, category, featured
  const passthrough = ['search', 'gender', 'age', 'accent', 'language', 'locale', 'category', 'featured', 'sort', 'use_cases', 'descriptives'];
  const params = new URLSearchParams();
  const pageSize = Math.min(parseInt(req.query.page_size || req.query.limit || '100', 10), 100);
  params.set('page_size', String(pageSize));
  if (req.query.page) params.set('page', String(req.query.page));
  for (const key of passthrough) {
    const v = (req.query[key] || '').toString().trim();
    if (v) params.set(key, v);
  }

  const url = `https://genaipro.io/api/v1/labs/voices?${params.toString()}`;
  const upstream = await fetch(url, {
    headers: { 'Authorization': `Bearer ${GENAIPRO_API_KEY}` }
  });

  if (!upstream.ok) {
    const txt = await upstream.text();
    console.error('[GENAIPRO voices]', upstream.status, txt.slice(0, 400));
    return res.status(502).json({ error: 'GenAIPro upstream error: ' + txt.slice(0, 300), status: upstream.status });
  }

  const data = await upstream.json();
  return res.status(200).json(data);
}
