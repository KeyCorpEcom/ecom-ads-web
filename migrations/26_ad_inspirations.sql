-- =====================================================================
-- Ad Inspirations : références vidéo concurrents indirects à recréer
-- avec nos B-Rolls produit.
--
-- Cas d'usage : Jallal trouve une vidéo qui claque sur une autre niche
-- (ex: matelas), upload le .mp4 sur Drive dans Inspirations/[product_id]/,
-- crée une inspiration assignée à un video_editor. Celui-ci voit la vidéo
-- source dans l'onglet Inspirations de la page produit, switch sur
-- l'onglet B-Rolls juste à côté pour piocher les plans produit, refait
-- la vidéo dans CapCut, upload le rendu → status 'done' → admin valide.
--
-- Fichiers stockés sur Drive (pas en bucket Supabase) — on garde juste
-- les drive_file_id en métadonnées, comme pour les scripts/masters.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ad_inspirations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,

  -- Le brief
  title TEXT NOT NULL,
  notes TEXT,
  source_url TEXT,  -- lien original (FB Ad Library / TikTok / IG / YouTube) pour traçabilité

  -- Vidéo source uploadée sur Drive
  drive_file_id TEXT,              -- la vidéo source (référence à recréer)
  thumbnail_url TEXT,              -- preview optionnelle pour les cards

  -- Assignment + workflow
  assigned_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done', 'approved', 'rejected')),
  result_drive_file_id TEXT,       -- le rendu final uploadé par video_editor
  rejection_reason TEXT,           -- raison de rejet (admin)

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_inspirations_workspace ON public.ad_inspirations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ad_inspirations_product   ON public.ad_inspirations(product_id);
CREATE INDEX IF NOT EXISTS idx_ad_inspirations_assigned  ON public.ad_inspirations(assigned_to_user_id)
  WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ad_inspirations_status    ON public.ad_inspirations(status);

COMMENT ON TABLE public.ad_inspirations IS
  'Inspirations vidéo (concurrents indirects) à recréer par un video_editor avec les B-Rolls du produit. Stockage des médias sur Drive — on garde uniquement les drive_file_id.';

-- ============ RLS ============
ALTER TABLE public.ad_inspirations ENABLE ROW LEVEL SECURITY;

-- SELECT : tous les membres du workspace voient les inspirations
DROP POLICY IF EXISTS "ad_inspirations_select" ON public.ad_inspirations;
CREATE POLICY "ad_inspirations_select" ON public.ad_inspirations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = ad_inspirations.workspace_id AND wm.user_id = auth.uid()
    )
  );

-- INSERT : admin du workspace uniquement
DROP POLICY IF EXISTS "ad_inspirations_insert" ON public.ad_inspirations;
CREATE POLICY "ad_inspirations_insert" ON public.ad_inspirations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = ad_inspirations.workspace_id AND wm.user_id = auth.uid()
    )
  );

-- UPDATE : admin OR video_editor assigné (pour avancer son statut + upload rendu)
DROP POLICY IF EXISTS "ad_inspirations_update" ON public.ad_inspirations;
CREATE POLICY "ad_inspirations_update" ON public.ad_inspirations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = ad_inspirations.workspace_id AND wm.user_id = auth.uid()
    )
    AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR ad_inspirations.assigned_to_user_id = auth.uid()
    )
  );

-- DELETE : admin only
DROP POLICY IF EXISTS "ad_inspirations_delete" ON public.ad_inspirations;
CREATE POLICY "ad_inspirations_delete" ON public.ad_inspirations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = ad_inspirations.workspace_id AND wm.user_id = auth.uid()
    )
  );

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.tg_ad_inspirations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ad_inspirations_set_updated_at ON public.ad_inspirations;
CREATE TRIGGER ad_inspirations_set_updated_at
  BEFORE UPDATE ON public.ad_inspirations
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_inspirations_updated_at();

NOTIFY pgrst, 'reload schema';

-- Vérification
SELECT 'table created' AS what, COUNT(*) AS n FROM public.ad_inspirations;
