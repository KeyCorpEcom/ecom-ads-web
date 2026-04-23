# ECOM Ads Tracker — Web (multi-user)

Application web de tracking d'ads ecom, multi-utilisateurs, basée sur Supabase et déployée sur Vercel.

## Stack
- **Frontend** : HTML + Vanilla JS (pas de framework)
- **Backend** : Supabase (PostgreSQL + Auth + RLS)
- **Hosting** : Vercel
- **Drive** : Google Drive API via OAuth par user

## Rôles
- **admin** : tout (gérer users, produits, suppression, config Drive)
- **editor** : créer/modifier produits, ads, toggle Trad/Meta, upload Drive
- **viewer** : lecture seule

## Déploiement
Push sur `main` → Vercel redéploie automatiquement.

## Dev local
Ouvre simplement `index.html` dans le navigateur (pas de serveur nécessaire).
Les credentials Supabase sont hardcodés dans l'HTML (publishable key, safe).
