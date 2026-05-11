// Vercel Serverless Function — crée une tâche TTS GenAIPro Labs
// Body : { text, voice_id, model_id, stability?, similarity?, style?, speed?, use_speaker_boost? }
// Réponse : { task_id }
// Admin + video_editor autorisés (ce sont eux qui produisent les masters).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = 'https://pxzfjnsngtjzfqmahgaj.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const GENAIPRO_API_KEY = process.env.GENAIPRO_API_KEY;

  if (!SUPABASE_SERVICE_KEY || !GENAIPRO_API_KEY) {
    return res.status(500).json({ error: 'Configuration manquante (SUPABASE_SERVICE_ROLE_KEY ou GENAIPRO_API_KEY)' });
  }

  // === 1. Auth Supabase + role admin/video_editor ===
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

  // === 2. Validation body ===
  const { text, voice_id, model_id, stability, similarity, style, speed, use_speaker_boost } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text requis' });
  if (!voice_id) return res.status(400).json({ error: 'voice_id requis' });
  if (!model_id) return res.status(400).json({ error: 'model_id requis' });

  // Hard cap : 5000 caractères pour éviter les générations runaway
  const cleanText = text.trim().slice(0, 5000);
  if (cleanText.length === 0) return res.status(400).json({ error: 'text vide après trim' });

  // === 3. Crée la tâche sur GenAIPro ===
  const body = {
    input: cleanText,
    voice_id,
    model_id,
    ...(typeof stability === 'number' ? { stability } : {}),
    ...(typeof similarity === 'number' ? { similarity } : {}),
    ...(typeof style === 'number' ? { style } : {}),
    ...(typeof speed === 'number' ? { speed } : {}),
    ...(typeof use_speaker_boost === 'boolean' ? { use_speaker_boost } : {})
  };

  const upstream = await fetch('https://genaipro.io/api/v1/labs/task', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GENAIPRO_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!upstream.ok) {
    const txt = await upstream.text();
    console.error('[GENAIPRO tts-create]', upstream.status, txt.slice(0, 500));
    return res.status(502).json({ error: 'GenAIPro upstream error: ' + txt.slice(0, 300), status: upstream.status });
  }

  const data = await upstream.json();
  if (!data?.task_id) {
    return res.status(502).json({ error: 'Réponse GenAIPro sans task_id', raw: data });
  }

  return res.status(200).json({ task_id: data.task_id, chars: cleanText.length });
}
