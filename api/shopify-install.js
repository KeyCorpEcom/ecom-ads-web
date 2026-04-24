// Vercel Serverless — génère l'URL d'installation OAuth Shopify
// Appelé par l'app quand l'user clique "Connecter shop [pays]"

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
  if (!CLIENT_ID) return res.status(500).json({ error: 'SHOPIFY_CLIENT_ID not configured' });

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

  // Scopes requis pour la traduction de thèmes
  const scopes = 'read_themes,write_themes,read_files,write_files,read_content,write_content';

  // Redirect URI (doit matcher avec ce qui est configuré dans Shopify Partners)
  const origin = req.headers['origin'] || `https://${req.headers['host']}`;
  const redirectUri = `${origin}/api/shopify-callback`;

  // State = country + random nonce pour sécurité CSRF
  const nonce = Math.random().toString(36).slice(2, 15);
  const state = encodeURIComponent(JSON.stringify({ country, nonce }));

  const installUrl = `https://${shopDomain}/admin/oauth/authorize?` +
    `client_id=${CLIENT_ID}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&grant_options[]=`;

  // Redirige vers Shopify
  res.redirect(302, installUrl);
}
