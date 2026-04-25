# KeyCorp Ecom — Carte du projet

Source de vérité pour tous les développeurs (humains ou Claude) qui touchent à ce projet.

## 🌍 Architecture globale

KeyCorp est un écosystème **multi-repos** déployé sur Vercel pour gérer un business e-commerce dropshipping multi-pays.

### Repos & déploiements

| Service | URL prod | Repo GitHub | Hébergeur | Tech |
|---|---|---|---|---|
| **App principale** (ads, pages landing, drive) | `https://www.keycorp-ecom.com` | `Keycorpecom/ecom-ads-web` | Vercel | HTML + Vanilla JS |
| **Portail SAV** (Service Après-Vente) | `https://www.keycorp-ecom.com/sav` | (autre repo, à compléter) | Vercel | (à compléter) |

### Domaines

- `keycorp-ecom.com` → app principale
- `keycorp-ecom.com/sav` → portail SAV séparé (autre projet Vercel)

## 📦 App principale — `ecom-ads-web`

### Stack
- **Frontend** : `index.html` monolithique en Vanilla JS (pas de framework)
- **Backend** : Supabase (PostgreSQL + Auth + RLS + Storage)
- **API serverless** : Vercel functions dans `/api/*.js`
- **Drive** : Google Drive API via OAuth par user

### Sections (nav sidebar)
- 📊 Dashboard
- 📺 Ads (workflow trad/meta des vidéos)
- 📦 Produits (catalogue avec progress bars Trad ads + Pages landing)
- 📈 Analytics
- 🌍 Product Page (workflow page builder, copie depuis URL concurrent)
- 🛟 SAV (lien externe vers `/sav` — projet séparé)
- ☁️ Google Drive
- 👥 Utilisateurs (admin only)
- ⚙️ Paramètres (admin only)

### Rôles users
- **admin** : tout (créer/modifier produits, valider pages, etc.)
- **editor** : remonter URL built, marquer pages "en review", upload Drive — pas de validation/rejet
- **page_builder** : idem editor, focalisé pages landing
- **viewer** : lecture seule

### Workflow Pages Landing
1. Admin crée produit avec : ID, nom, pays actifs, **priorité** (urgent/haute/normale/basse), **URL concurrent** (référence à copier)
2. Page builder voit la liste des tâches dans `/pages` (triée par priorité)
3. Pour chaque produit×pays, page builder :
   - Ouvre URL concurrent
   - Copie/recrée la page dans Shopify (manuel)
   - Remonte URL built dans l'app
   - Marque "📤 En review"
4. Admin valide ✅ ou rejette ❌ avec feedback obligatoire
5. Si rejeté → page builder corrige → repasse en review
6. Pages 100% validées masquées par défaut

### Tables Supabase clés
- `products` : id, name, enabled_countries, cut_countries, master_country_id, priority, concurrent_page_url, drive_folder_id
- `ads` : product_id, name, position, ad_copy (jsonb)
- `ad_countries` : ad_id, country_id, trad, meta
- `product_pages` : product_id, country_id, status (pending/built/approved/rejected), built_url, notes
- `countries` : id, name, color, sort_order
- `profiles` : id, role, full_name
- `shopify_apps` : country_id, client_id, client_secret (legacy de Phase 3 abandonnée)
- `shopify_connections` : country_id, shop_domain, access_token (legacy)

### Storage
- Bucket `product-images` : (legacy de Phase 3 abandonnée, peut être vidé)

### Vercel env vars critiques
- `SUPABASE_SERVICE_ROLE_KEY` (utilisé par `/api/invite-user.js`)
- `ANTHROPIC_API_KEY` (legacy de Phase 3 abandonnée — peut être supprimé si plus utilisé)

## 🛟 Portail SAV — `/sav`

**Projet séparé**, pas dans ce repo.

Features actuelles (vue depuis screenshot user) :
- Tableau de bord avec tickets
- Boîte de réception
- Commandes Shopify
- Adresses à confirmer
- Analytics
- Modèles de réponse
- Boutiques
- Paramètres

⚠️ **NE PAS recréer un fichier `sav.html` dans ce repo** — Vercel servirait notre version au lieu du vrai portail SAV.

## 🚫 Phases abandonnées (à ignorer)

- **Phase 3 — Shopify API + Claude duplication** : abandonnée car limite "1 shop par app Custom Distribution" rendait la maintenance impossible. Le code endpoints `/api/shopify-*.js` et `/api/duplicate-product.js` est resté en dead code (peut être supprimé). Tables `shopify_apps`, `shopify_connections`, et bucket `product-images` aussi inutilisés.

## 🛠️ Développement

### Dev local
Ouvrir `index.html` dans le navigateur. Les credentials Supabase sont en clair dans le HTML (publishable key, safe).

### Push pour déployer
Le repo est dans `Keycorpecom/ecom-ads-web` sur GitHub. Pousser sur `main` → Vercel redéploie auto.

```bash
cd /chemin/vers/repo
git pull --rebase
git add .
git commit -m "..."
git push
```

### Workflow Claude Code typique
1. Copier `index.html` (et autres fichiers) depuis dossier de travail vers le repo cloné
2. `git add` + `git commit` + `git push`
3. Vercel redéploie en ~1 min

## 🚨 Règles pour Claude

Quand tu touches à ce projet :

1. **Lis ce README en premier** — il liste ce qui existe et ce qu'il NE FAUT PAS toucher
2. **Ne crée pas de fichier `sav.html`** — le SAV est un projet séparé
3. **Ne touche pas à `/api/shopify-*.js` ni `/api/duplicate-product.js`** sans raison — c'est du legacy abandonné
4. **Préviens avant de toucher à la table `products`** — partagée entre Ads et Pages Landing, casser une = casser deux features
5. **Vérifie l'historique git** avant d'ajouter des features qui peuvent déjà exister (`git log --all --oneline -- nom_fichier.html`)

## 📞 Si tu n'es pas sûr de quelque chose

Demande à l'utilisateur. Plutôt que de supposer ou de créer des choses qui pourraient écraser du travail existant.
