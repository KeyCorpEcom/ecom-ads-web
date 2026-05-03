// Vercel Serverless Function — invite (ou re-invite) un user via Supabase Admin API
// Appelé par le bouton "+ Inviter un user" dans l'app
// Idempotent :
//   - Si user n'existe pas → /auth/v1/invite (envoie email d'invitation)
//   - Si user existe → /auth/v1/admin/generate_link type=magiclink (régénère un lien
//     d'accès, l'email est envoyé automatiquement par Supabase)
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

  // Validation des paramètres
  const { email: rawEmail, role, full_name, workspace_id } = req.body || {};
  const email = (rawEmail || '').trim().toLowerCase();
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

  // === Étape 1 : Détecte si l'user existe déjà ===
  let existingUserId = null;
  try {
    // Recherche dans auth.users via Admin API. La pagination est limitée à 50/page
    // par défaut. On augmente à 1000 pour couvrir la majorité des cas de PME.
    const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    });
    if (listRes.ok) {
      const listJson = await listRes.json();
      const found = (listJson.users || []).find(u =>
        u.email && u.email.toLowerCase() === email
      );
      if (found) existingUserId = found.id;
    }
  } catch (e) { /* fallback : on tentera l'invite quand même */ }

  // === Étape 2 : Selon que l'user existe ou non, on agit différemment ===
  let newUserId = existingUserId;
  let action = 'invited'; // 'invited' (nouveau) | 'magic_link' (existing) | 'reinvited'

  if (!existingUserId) {
    // Nouvel user → invite normal (envoie email d'invitation)
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
      // Edge case : "User already registered" alors que la liste ne l'a pas trouvé
      // (utilisateur très récent ou pagination). On bascule vers magic link.
      const msg = (inviteJson.msg || inviteJson.error_description || '').toLowerCase();
      if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
        // Re-recherche pour récupérer l'ID
        const recheck = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
        });
        const recheckJson = await recheck.json();
        const found = (recheckJson.users || []).find(u =>
          u.email && u.email.toLowerCase() === email
        );
        if (!found) {
          return res.status(500).json({ error: 'User existe mais introuvable via Admin API' });
        }
        newUserId = found.id;
        action = 'magic_link';
      } else {
        return res.status(500).json({ error: inviteJson.msg || inviteJson.error_description || 'Erreur invitation' });
      }
    } else {
      newUserId = inviteJson.id;
    }
  } else {
    // User existe déjà → on lui envoie un magic link (ne crée pas de doublon)
    action = 'magic_link';
  }

  // === Étape 3 : Si action = magic_link, on génère le lien ET on envoie l'email ===
  if (action === 'magic_link') {
    // /admin/generate_link type=magiclink → génère ET envoie l'email automatiquement
    // si le SMTP Supabase est configuré (le défaut)
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`
      },
      body: JSON.stringify({
        type: 'magiclink',
        email,
        options: {
          redirect_to: redirectTo
        }
      })
    });
    if (!linkRes.ok) {
      const errText = await linkRes.text();
      return res.status(500).json({
        error: 'Impossible de générer un nouveau lien : ' + errText,
        user_id: newUserId
      });
    }
  }

  // === Étape 4 : Met à jour le profil (role + full_name) ===
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${newUserId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      role,
      full_name: full_name || null
    })
  });

  // === Étape 5 : Ajoute / met à jour le workspace_members (upsert idempotent) ===
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
    if (errText.includes('23505') || errText.includes('duplicate key')) {
      // Déjà membre — on a quand même mis à jour le profil + envoyé le mail
      return res.status(200).json({
        ok: true,
        user_id: newUserId,
        email,
        workspace_id,
        action,
        note: 'Déjà membre du workspace, profil mis à jour, lien envoyé.'
      });
    }
    return res.status(500).json({
      error: 'User OK mais ajout au workspace échoué : ' + errText,
      user_id: newUserId
    });
  }

  return res.status(200).json({
    ok: true,
    user_id: newUserId,
    email,
    workspace_id,
    action  // 'invited' (mail invitation) | 'magic_link' (mail lien magique pour user existant)
  });
}
