-- =====================================================================
-- Fix RLS : autoriser TOUT video_editor du workspace à UPDATE une inspiration
--
-- Bug rapporté par Fadel le 5 juin 2026 :
-- - Toast vert "Rendu uploadé ✓ — en attente de validation admin"
-- - Mais badge reste "À FAIRE" et admin (Jallal) ne voit rien arriver
--
-- Cause : la migration 26 limitait l'UPDATE à (admin OR assigned_to_user_id).
-- Mais le fix UI #126 a assoupli la condition pour qu'un video_editor non
-- assigné voie quand même le dropzone (utile pour les pools où plusieurs
-- editors peuvent piocher). La RLS n'avait pas suivi → l'UPDATE renvoyait
-- 0 rows + error: null (PostgREST ne lève pas d'erreur quand RLS filtre
-- toutes les lignes), donc le code passait par le toast vert mais sans
-- rien changer en DB.
--
-- Fix : autoriser admin OR video_editor (peu importe assignment) à UPDATE
-- les inspirations de son workspace. Cohérent avec l'UI.
-- =====================================================================

DROP POLICY IF EXISTS "ad_inspirations_update" ON public.ad_inspirations;
CREATE POLICY "ad_inspirations_update" ON public.ad_inspirations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = ad_inspirations.workspace_id AND wm.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'video_editor')
    )
  );

NOTIFY pgrst, 'reload schema';

-- Vérification
SELECT 'policy updated' AS what,
       polname,
       pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.ad_inspirations'::regclass
  AND polname = 'ad_inspirations_update';
