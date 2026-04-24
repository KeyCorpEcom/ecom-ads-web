// Vercel Serverless — Duplique un produit du shop master vers un shop target
// avec traduction Claude du titre + variants, et images spécifiques au pays

export const config = { maxDuration: 60 }; // Vercel Pro: 60s max; Hobby: 10s

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = 'https://pxzfjnsngtjzfqmahgaj.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // Vérif auth user
  const authHeader = req.headers['authorization'] || '';
  const callerJwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerJwt) return res.status(401).json({ error: 'Not authenticated' });
  const checkUser = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${callerJwt}`, 'apikey': SERVICE_KEY }
  });
  if (!checkUser.ok) return res.status(401).json({ error: 'Invalid session' });
  const callerUser = await checkUser.json();

  // Check role (admin, editor, page_builder)
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${callerUser.id}&select=role`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
  });
  const profiles = await profRes.json();
  const role = profiles[0]?.role;
  if (!['admin', 'editor', 'page_builder'].includes(role)) {
    return res.status(403).json({ error: 'Permission refusée' });
  }

  const { productId, targetCountryId } = req.body || {};
  if (!productId || !targetCountryId) {
    return res.status(400).json({ error: 'productId et targetCountryId requis' });
  }

  // 1. Load product + master country
  const prodRes = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=*`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
  });
  const prods = await prodRes.json();
  if (!prods[0]) return res.status(404).json({ error: `Produit ${productId} introuvable` });
  const product = prods[0];
  const masterCountry = product.master_country_id;
  if (!masterCountry) return res.status(400).json({ error: `Pas de master_country_id défini pour ${productId}` });
  if (masterCountry === targetCountryId) return res.status(400).json({ error: `Le pays cible est déjà le master (${masterCountry})` });

  // 2. Load master Shopify product ID depuis product_pages
  const masterPageRes = await fetch(
    `${SUPABASE_URL}/rest/v1/product_pages?product_id=eq.${encodeURIComponent(productId)}&country_id=eq.${masterCountry}&select=shopify_product_id`,
    { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
  );
  const masterPages = await masterPageRes.json();
  const masterShopifyId = masterPages[0]?.shopify_product_id;
  if (!masterShopifyId) {
    return res.status(400).json({ error: `Pas de shopify_product_id pour le master ${masterCountry}. Lie-le d'abord dans l'app.` });
  }

  // 3. Load shop connections (master + target)
  const [masterConnRes, targetConnRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/shopify_connections?country_id=eq.${masterCountry}&select=*`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    }),
    fetch(`${SUPABASE_URL}/rest/v1/shopify_connections?country_id=eq.${targetCountryId}&select=*`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    })
  ]);
  const masterConns = await masterConnRes.json();
  const targetConns = await targetConnRes.json();
  if (!masterConns[0]) return res.status(400).json({ error: `Shop master ${masterCountry} non connecté. Connecte-le d'abord.` });
  if (!targetConns[0]) return res.status(400).json({ error: `Shop cible ${targetCountryId} non connecté. Connecte-le d'abord.` });
  const masterConn = masterConns[0];
  const targetConn = targetConns[0];

  // 4. Fetch master product from Shopify
  const masterShopRes = await fetch(
    `https://${masterConn.shop_domain}/admin/api/2024-10/products/${masterShopifyId}.json`,
    { headers: { 'X-Shopify-Access-Token': masterConn.access_token } }
  );
  if (!masterShopRes.ok) {
    const errTxt = await masterShopRes.text();
    return res.status(500).json({ error: `Erreur fetch master product Shopify : ${errTxt}` });
  }
  const masterProductData = await masterShopRes.json();
  const masterProduct = masterProductData.product;

  // 5. Load target country images from Supabase
  const imgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/product_page_images?product_id=eq.${encodeURIComponent(productId)}&country_id=eq.${targetCountryId}&order=position.asc&select=public_url,name`,
    { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
  );
  const targetImages = await imgRes.json();

  // 6. Translate title + variant options via Claude
  const translationInput = {
    title: masterProduct.title,
    options: masterProduct.options?.map(o => ({ name: o.name, values: o.values })) || []
  };

  // Language mapping (extensible)
  const langMap = {
    FR: 'French', DE: 'German', NL: 'Dutch', IT: 'Italian', ES: 'Spanish',
    PT: 'Portuguese', UK: 'English (British)', US: 'English (American)', PL: 'Polish',
    SE: 'Swedish', NO: 'Norwegian', DK: 'Danish', FI: 'Finnish'
  };
  const targetLang = langMap[targetCountryId] || targetCountryId;

  const claudePrompt = `Translate the following e-commerce product data from ${langMap[masterCountry] || masterCountry} to ${targetLang}. Return ONLY valid JSON matching the input structure. Translate natural language only — keep SKUs, codes, and technical identifiers untouched.

Input:
${JSON.stringify(translationInput, null, 2)}

Return JSON with same structure (title, options array with name and values).`;

  let translated;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: claudePrompt }]
      })
    });
    if (!claudeRes.ok) {
      const errTxt = await claudeRes.text();
      return res.status(500).json({ error: `Claude API error : ${errTxt}` });
    }
    const claudeData = await claudeRes.json();
    const raw = claudeData.content[0].text.trim();
    // Extract JSON (au cas où Claude ajoute du texte autour)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');
    translated = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return res.status(500).json({ error: `Erreur traduction Claude : ${e.message}` });
  }

  // 7. Build new product payload for target shop
  const newProductPayload = {
    product: {
      title: translated.title || masterProduct.title,
      body_html: masterProduct.body_html || '',
      vendor: masterProduct.vendor || '',
      product_type: masterProduct.product_type || '',
      tags: masterProduct.tags || '',
      template_suffix: masterProduct.template_suffix || null, // ← COPIE le template custom (landing page) du master
      handle: masterProduct.handle || undefined, // ← copie le handle (URL slug) du master pour cohérence
      status: 'draft', // créer en draft pour review avant publish
      options: (masterProduct.options || []).map((opt, i) => ({
        name: translated.options?.[i]?.name || opt.name,
        values: translated.options?.[i]?.values || opt.values
      })),
      variants: (masterProduct.variants || []).map(v => {
        // Reconstruit les valeurs d'options traduites pour chaque variant
        const translatedOptionValues = (masterProduct.options || []).map((opt, i) => {
          const originalValue = v[`option${i + 1}`];
          if (!originalValue) return null;
          const idx = opt.values.indexOf(originalValue);
          return translated.options?.[i]?.values?.[idx] || originalValue;
        });
        return {
          price: v.price,
          sku: v.sku || '',
          inventory_management: v.inventory_management,
          inventory_policy: v.inventory_policy || 'deny',
          fulfillment_service: 'manual',
          taxable: v.taxable !== false,
          weight: v.weight,
          weight_unit: v.weight_unit || 'kg',
          option1: translatedOptionValues[0] || null,
          option2: translatedOptionValues[1] || null,
          option3: translatedOptionValues[2] || null
        };
      }),
      images: targetImages.map((img, i) => ({
        src: img.public_url,
        position: i + 1,
        alt: translated.title || masterProduct.title
      }))
    }
  };

  // Si pas d'images pays, fallback sur images master
  if (targetImages.length === 0 && masterProduct.images?.length > 0) {
    newProductPayload.product.images = masterProduct.images.map((img, i) => ({
      src: img.src,
      position: i + 1
    }));
  }

  // 8. Create product in target shop
  const createRes = await fetch(
    `https://${targetConn.shop_domain}/admin/api/2024-10/products.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': targetConn.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newProductPayload)
    }
  );
  if (!createRes.ok) {
    const errTxt = await createRes.text();
    return res.status(500).json({ error: `Erreur création Shopify : ${errTxt}` });
  }
  const createdData = await createRes.json();
  const createdProduct = createdData.product;

  // 9. Update product_pages with new shopify_product_id
  await fetch(
    `${SUPABASE_URL}/rest/v1/product_pages?product_id=eq.${encodeURIComponent(productId)}&country_id=eq.${targetCountryId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        shopify_product_id: createdProduct.id,
        shopify_product_handle: createdProduct.handle,
        updated_at: new Date().toISOString()
      })
    }
  );
  // Si la row n'existe pas encore, on l'insert
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/product_pages?product_id=eq.${encodeURIComponent(productId)}&country_id=eq.${targetCountryId}&select=product_id`,
    { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
  );
  const existingPages = await checkRes.json();
  if (existingPages.length === 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/product_pages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        product_id: productId,
        country_id: targetCountryId,
        shopify_product_id: createdProduct.id,
        shopify_product_handle: createdProduct.handle
      })
    });
  }

  return res.status(200).json({
    ok: true,
    shopify_product_id: createdProduct.id,
    shopify_product_handle: createdProduct.handle,
    shopify_admin_url: `https://${targetConn.shop_domain}/admin/products/${createdProduct.id}`,
    translated_title: translated.title
  });
}
