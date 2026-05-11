// Vercel Serverless Function — poll le statut d'une tâche TTS GenAIPro Labs
// Query : ?task_id=...&fetch_mp3=1
// Réponse : { status, result_url } OU si fetch_mp3=1 et completed → renvoie le mp3 binary directement
// (utile pour bypass CORS si media.genaipro.io ne whitelist pas notre domain).
//
// Admin + video_editor autorisés.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = 'https://pxzfjnsngtjzfqmahgaj.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const GENAIPRO_API_KEY = process.env.GENAIPRO_API_KEY;

  if (!SUPABASE_SERVICE_KEY || !GENAIPRO_API_KEY) {
    return res.status(500).json({ error: 'Configuration manquante' });
  }

  // === 1. Auth ===
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
  if (!userRoles.some(r => ['admin', 'video_editor'].includes(r))) {
    return res.status(403).json({ error: 'Admin ou video_editor uniquement' });
  }

  // === 2. Récupère le task ===
  const taskId = (req.query.task_id || '').toString().trim();
  if (!taskId) return res.status(400).json({ error: 'task_id requis' });
  const fetchMp3 = req.query.fetch_mp3 === '1';

  const upstream = await fetch(`https://genaipro.io/api/v1/labs/task/${encodeURIComponent(taskId)}`, {
    headers: { 'Authorization': `Bearer ${GENAIPRO_API_KEY}` }
  });

  if (!upstream.ok) {
    const txt = await upstream.text();
    console.error('[GENAIPRO tts-status]', upstream.status, txt.slice(0, 400));
    return res.status(502).json({ error: 'GenAIPro upstream error: ' + txt.slice(0, 300), status: upstream.status });
  }

  const data = await upstream.json();

  // === 3. Si demandé + completed, on proxy le mp3 binaire pour éviter les soucis CORS ===
  if (fetchMp3 && data?.status === 'completed' && data?.result) {
    const mp3Res = await fetch(data.result);
    if (!mp3Res.ok) {
      return res.status(502).json({ error: 'Impossible de récupérer le mp3 final', url: data.result });
    }
    const buf = Buffer.from(await mp3Res.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${taskId}.mp3"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).send(buf);
  }

  // === 4. Sinon on retourne le JSON brut (status, result, etc.) ===
  return res.status(200).json({
    task_id: data.id || taskId,
    status: data.status,
    result: data.result || null,
    voice_id: data.voice_id,
    model_id: data.model_id,
    input: data.input,
    created_at: data.created_at
  });
}
