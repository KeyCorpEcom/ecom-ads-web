// Vercel Serverless Function — supprime une vidéo de Cloudflare Stream
// Appelé quand on supprime une formation via l'app

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = 'https://pxzfjnsngtjzfqmahgaj.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
  const CF_TOKEN = process.env.CLOUDFLARE_STREAM_TOKEN;

  if (!SUPABASE_SERVICE_KEY || !CF_ACCOUNT_ID || !CF_TOKEN) {
    return res.status(500).json({ error: 'Configuration manquante' });
  }

  // Auth admin only
  const authHeader = req.headers['authorization'] || '';
  const callerJwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerJwt) return res.status(401).json({ error: 'Not authenticated' });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${callerJwt}`, 'apikey': SUPABASE_SERVICE_KEY }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const user = await userRes.json();

  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,extra_roles`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  const profiles = await profileRes.json();
  const p = profiles?.[0];
  const userRoles = p ? [p.role, ...(Array.isArray(p.extra_roles) ? p.extra_roles : [])].filter(Boolean) : [];
  if (!userRoles.includes('admin')) {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { uid } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'uid requis' });

  // Delete via Cloudflare Stream API
  const cfRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${CF_TOKEN}` }
  });

  if (!cfRes.ok) {
    const errText = await cfRes.text();
    console.error('[CF STREAM DELETE]', cfRes.status, errText);
    return res.status(500).json({ error: 'Cloudflare delete error: ' + errText.slice(0, 300) });
  }

  return res.status(200).json({ ok: true });
}
