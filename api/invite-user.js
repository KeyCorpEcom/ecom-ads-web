// Vercel Serverless Function — invite un user via Supabase Admin API
// Appelé par le bouton "+ Inviter un user" dans l'app
// Utilise SUPABASE_SERVICE_ROLE_KEY (env var Vercel, JAMAIS dans le frontend)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = 'https://pxzfjnsngtjzfqmahgaj.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured on Vercel' });
  }

  // Extrait le token JWT de l'appelant pour vérifier qu'il est admin
  const authHeader = req.headers['authorization'] || '';
  const callerJwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerJwt) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Vérifie que l'appelant est admin
  const checkUser = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${callerJwt}`, 'apikey': SERVICE_KEY }
  });
  if (!checkUser.ok) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  const callerUser = await checkUser.json();

  // Vérifier que le caller est admin via la table profiles
  const checkProfile = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${callerUser.id}&select=role`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
  });
  const profiles = await checkProfile.json();
  if (!profiles[0] || profiles[0].role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  // Invite l'user via Admin API
  const { email, role, full_name, workspace_id } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email requis' });
  if (!['admin', 'editor', 'viewer', 'page_builder'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide (admin/editor/viewer/page_builder)' });
  }
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id requis' });

  // Vérifie que le workspace_id existe ET que l'admin appelant en est membre admin
  const checkWs = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_members?workspace_id=eq.${workspace_id}&user_id=eq.${callerUser.id}&select=role`,
    { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
  );
  const wsMembers = await checkWs.json();
  if (!wsMembers[0] || wsMembers[0].role !== 'admin') {
    return res.status(403).json({ error: 'Tu dois être admin de ce workspace pour inviter quelqu\'un dedans' });
  }

  // Détermine l'URL de redirection selon l'origine de l'appel
  const origin = req.headers['origin'] || req.headers['referer'] || 'https://keycorp-ecom.com';
  const redirectTo = origin.replace(/\/$/, '') + '/';

  const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`
    },
    body: JSON.stringify({
      email,
      data: { full_name: full_name || '' },
      redirect_to: redirectTo
    })
  });
  const inviteJson = await inviteRes.json();
  if (!inviteRes.ok) {
    return res.status(500).json({ error: inviteJson.msg || inviteJson.error_description || 'Erreur invitation' });
  }

  const newUserId = inviteJson.id;

  // Met à jour le profil avec le rôle et le nom (le trigger a créé le profil auto avec role=editor)
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${newUserId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ role, full_name: full_name || null })
  });

  // Ajoute le nouveau user au workspace choisi (upsert : merge si déjà membre)
  const addToWs = await fetch(`${SUPABASE_URL}/rest/v1/workspace_members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=minimal,resolution=merge-duplicates'
    },
    body: JSON.stringify({
      workspace_id,
      user_id: newUserId,
      role,
      added_by: callerUser.id
    })
  });
  if (!addToWs.ok) {
    const errText = await addToWs.text();
    // Tolère le cas où l'user est déjà membre (duplicate key) — pas une erreur fatale
    if (errText.includes('23505') || errText.includes('duplicate key')) {
      return res.status(200).json({
        ok: true,
        user_id: newUserId,
        email,
        workspace_id,
        note: 'User déjà membre du workspace, profil mis à jour'
      });
    }
    return res.status(500).json({ error: 'User créé mais ajout au workspace échoué : ' + errText, user_id: newUserId });
  }

  return res.status(200).json({ ok: true, user_id: newUserId, email, workspace_id });
}
