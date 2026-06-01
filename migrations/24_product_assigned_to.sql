-- =====================================================================
-- Assignment d'un projet Product Page à un utilisateur.
--
-- Cas d'usage : Mechac (page builder) veut commencer un projet F0015.
-- Il clique sur le bouton "Prendre ce projet" sur #pages/F0015 →
-- assigned_to_user_id = son user_id. Son badge avec ses initiales
-- apparaît dans le header de la page + sur la card dans la liste #pages.
--
-- Granularité : GLOBALE au produit (un seul assigné pour tous les pays).
-- Reassignment libre : un autre user peut click → ça reprend.
--
-- ON DELETE SET NULL : si un user est supprimé, on garde le produit
-- sans assignation plutôt que de casser la row.
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.products.assigned_to_user_id IS
  'User assigné au projet Product Page de ce produit. Globale au produit (tous les pays). Reassignable librement par n''importe qui en cliquant sur le bouton "Prendre ce projet" sur #pages/{id}.';

-- Index partiel : seuls les produits assignés sont indexés (la majorité ne le sont pas).
CREATE INDEX IF NOT EXISTS products_assigned_to_user_id_idx
  ON public.products(assigned_to_user_id)
  WHERE assigned_to_user_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Vérification
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'products'
  AND column_name = 'assigned_to_user_id';
