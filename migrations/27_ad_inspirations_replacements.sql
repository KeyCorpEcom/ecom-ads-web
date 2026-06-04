-- =====================================================================
-- Find & Replace map sur les Ad Inspirations.
--
-- Cas d'usage : Jallal regarde la vidéo concurrent, identifie les mots
-- de marque / produit / matériaux à remplacer. Il stocke ces paires
-- dans l'inspiration. Fadel les voit en chips visuels sur la card et
-- les utilise dans Kapwing (Find & Replace) sans avoir à re-watcher
-- la vidéo source à chaque fois.
--
-- Format JSONB :
--   [
--     { "find": "Boxhero",  "replace": "Olvera" },
--     { "find": "bambou",   "replace": "coton" },
--     { "find": "matelas",  "replace": "soutien-gorge" }
--   ]
--
-- Liste plate ordonnée : on respecte l'ordre saisi par l'admin
-- (typiquement nom de la marque en premier, puis termes spécifiques).
-- =====================================================================

ALTER TABLE public.ad_inspirations
  ADD COLUMN IF NOT EXISTS replacements JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.ad_inspirations.replacements IS
  'Paires find/replace à appliquer dans Kapwing pour adapter la vidéo concurrent. Format: [{"find":"Boxhero","replace":"Olvera"}, ...]';

NOTIFY pgrst, 'reload schema';

-- Vérification
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ad_inspirations'
  AND column_name = 'replacements';
