// Vercel Serverless — génère l'URL d'installation OAuth Shopify
// Appelé par l'app quand l'user clique "Connecter shop [pays]"
// Lit le client_id depuis la table shopify_apps (un app Dev Dashboard par pays)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = 'https://pxzfjnsngtjzfqmahgaj.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) return res.status(500).send('SUPABASE_SERVICE_ROLE_KEY not configured');

  const { shop, country } = req.query;
  if (!shop || !country) return res.status(400).json({ error: 'shop et country requis' });

  // Validation shop domain
  const shopDomain = shop.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
    return res.status(400).json({ error: 'Shop domain invalide. Format attendu : nom-shop.myshopify.com' });
  }

  // Validation country
  if (!/^[A-Z]{2,3}$/.test(country)) {
    return res.status(400).json({ error: 'Country code invalide' });
  }

  // Récupère le client_id depuis la DB (app Dev Dashboard spécifique à ce pays)
  let clientId;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/shopify_apps?country_id=eq.${country}&select=client_id`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    });
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).send(`Aucun app Shopify configuré pour le pays ${country}. Configure d'abord Client ID + Secret dans les Paramètres.`);
    }
    clientId = data[0].client_id;
  } catch (e) {
    return res.status(500).send('Erreur DB : ' + e.message);
  }

  // Scopes requis pour la traduction de thèmes
  const scopes = 'read_themes,write_themes,read_files,write_files,read_content,write_content';

  // Redirect URI (doit matcher avec ce qui est configuré dans Shopify Dev Dashboard)
  const origin = req.headers['origin'] || `https://${req.headers['host']}`;
  const redirectUri = `${origin}/api/shopify-callback`;

  // State = country + random nonce pour sécurité CSRF
  const nonce = Math.random().toString(36).slice(2, 15);
  const state = encodeURIComponent(JSON.stringify({ country, nonce }));

  const installUrl = `https://${shopDomain}/admin/oauth/authorize?` +
    `client_id=${clientId}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&grant_options[]=`;

  // Redirige vers Shopify
  res.redirect(302, installUrl);
}
