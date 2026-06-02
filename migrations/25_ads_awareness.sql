-- =====================================================================
-- Awareness tracking sur public.ads (Eugene Schwartz / direct response).
--
-- Cas d'usage : taguer chaque ad pour analyser la distribution sur les
-- 5 niveaux d'awareness + le concept créatif. Permet de détecter les
-- "trous" dans le funnel (ex: 8% Problem Aware = trou critique).
--
-- - awareness_level : 5 niveaux classiques (unaware → most_aware)
-- - concept : texte libre court (ex: "transformation skin", "before/after",
--   "social proof", "founder story") — pas d'enum pour rester flexible
--
-- Tagging fait depuis le hub /awareness, lecture pour analytics par produit.
-- =====================================================================

ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS awareness_level TEXT
    CHECK (awareness_level IS NULL OR awareness_level IN ('unaware','problem','solution','product','most')),
  ADD COLUMN IF NOT EXISTS concept TEXT;

COMMENT ON COLUMN public.ads.awareness_level IS
  'Niveau d''awareness Eugene Schwartz : unaware (audience ignore le problème) → problem (sait qu''il a un problème) → solution (cherche solutions) → product (compare produits) → most (prêt à acheter). NULL = pas encore tagué.';

COMMENT ON COLUMN public.ads.concept IS
  'Concept créatif libre court — ex: "transformation skin", "before/after", "founder story", "demo", "social proof". Sert à analyser quel concept marche par niveau d''awareness.';

-- Index partiel pour les queries analytics (on cherche que les tagged)
CREATE INDEX IF NOT EXISTS ads_awareness_level_idx
  ON public.ads(awareness_level)
  WHERE awareness_level IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Vérification
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ads'
  AND column_name IN ('awareness_level', 'concept')
ORDER BY column_name;
