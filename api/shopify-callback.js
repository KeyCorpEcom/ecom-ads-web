// Vercel Serverless — reçoit le callback OAuth Shopify
// Échange le code contre un access token et stocke en DB

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
  const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
  const SUPABASE_URL = 'https://pxzfjnsngtjzfqmahgaj.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send('SHOPIFY_CLIENT_ID / SECRET not configured on Vercel');
  }
  if (!SERVICE_KEY) {
    return res.status(500).send('SUPABASE_SERVICE_ROLE_KEY not configured on Vercel');
  }

  const { code, shop, hmac, state } = req.query;

  if (!code || !shop || !state) {
    return res.status(400).send('Callback invalide (code/shop/state manquant)');
  }

  // Validation shop domain
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return res.status(400).send('Shop domain invalide');
  }

  // Vérif HMAC pour sécurité
  if (hmac) {
    const params = new URLSearchParams(req.url.split('?')[1]);
    params.delete('hmac');
    params.delete('signature');
    const sortedParams = Array.from(params.entries()).sort().map(([k, v]) => `${k}=${v}`).join('&');
    const computedHmac = crypto.createHmac('sha256', CLIENT_SECRET).update(sortedParams).digest('hex');
    if (computedHmac !== hmac) {
      return res.status(403).send('HMAC invalide — requête non authentifiée');
    }
  }

  // Parse state pour récupérer country
  let country;
  try {
    const parsed = JSON.parse(decodeURIComponent(state));
    country = parsed.country;
  } catch (e) {
    return res.status(400).send('State invalide');
  }

  if (!country || !/^[A-Z]{2,3}$/.test(country)) {
    return res.status(400).send('Country invalide');
  }

  // Exchange code for access token
  let accessToken, scope;
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code
      })
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      return res.status(500).send('Erreur Shopify : ' + (tokenJson.error_description || JSON.stringify(tokenJson)));
    }
    accessToken = tokenJson.access_token;
    scope = tokenJson.scope;
  } catch (e) {
    return res.status(500).send('Erreur exchange code : ' + e.message);
  }

  // Store in Supabase via REST API (upsert)
  try {
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/shopify_connections?on_conflict=country_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        country_id: country,
        shop_domain: shop,
        access_token: accessToken,
        scope: scope,
        connected_at: new Date().toISOString(),
        last_used_at: new Date().toISOString()
      })
    });
    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      return res.status(500).send('Erreur Supabase : ' + errText);
    }
  } catch (e) {
    return res.status(500).send('Erreur DB : ' + e.message);
  }

  // Success → redirige vers l'app avec un flag
  const appUrl = `https://${req.headers['host']}/#parametres?shopify_connected=${country}`;
  res.redirect(302, appUrl);
}
