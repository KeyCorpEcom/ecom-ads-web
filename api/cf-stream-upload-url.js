// Vercel Serverless Function — génère une URL d'upload one-time Cloudflare Stream
// Le frontend appelle cet endpoint, on retourne uploadURL + uid
// Le frontend uploade ensuite directement au uploadURL via TUS (résumable)
// Le token Cloudflare reste secret côté serveur — jamais exposé au browser

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = 'https://pxzfjnsngtjzfqmahgaj.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
  const CF_TOKEN = process.env.CLOUDFLARE_STREAM_TOKEN;

  if (!SUPABASE_SERVICE_KEY || !CF_ACCOUNT_ID || !CF_TOKEN) {
    return res.status(500).json({ error: 'Configuration manquante (SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_STREAM_TOKEN)' });
  }

  // === 1. Vérifie l'auth Supabase + rôle admin ===
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

  // === 2. Récupère la taille du fichier (en bytes) depuis le body ===
  // tus-js-client a besoin que l'API connaisse la taille pour activer la upload directe
  const fileSize = parseInt(req.body?.fileSize || req.headers['x-file-size'] || '0', 10);
  if (!fileSize || fileSize <= 0) {
    return res.status(400).json({ error: 'fileSize requis (en bytes)' });
  }

  // === 3. Demande à Cloudflare une URL TUS one-time ===
  // Doc : https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/
  const cfRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream?direct_user=true`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_TOKEN}`,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(fileSize),
      'Upload-Metadata': `name ${Buffer.from(req.body?.fileName || 'video').toString('base64')}`
    }
  });

  if (!cfRes.ok) {
    const errText = await cfRes.text();
    console.error('[CF STREAM]', cfRes.status, errText);
    return res.status(500).json({ error: 'Cloudflare error: ' + errText.slice(0, 300) });
  }

  // Cloudflare retourne l'URL TUS dans le header "Location"
  // et l'uid dans le header "Stream-Media-Id"
  const uploadURL = cfRes.headers.get('Location');
  const uid = cfRes.headers.get('Stream-Media-Id') || cfRes.headers.get('stream-media-id');

  if (!uploadURL || !uid) {
    return res.status(500).json({ error: 'Cloudflare n\'a pas retourné uploadURL ou uid' });
  }

  return res.status(200).json({
    uploadURL,
    uid,
    subdomain: process.env.CLOUDFLARE_STREAM_SUBDOMAIN || ''
  });
}
