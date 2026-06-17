-- Recorte de visibilidade por ÁREA na aba Atividades.
--
-- Regra de visibilidade (3 níveis):
--   • user        → vê só as próprias atividades;
--   • admin       → vê os usuários da MESMA área (profiles.departamento);
--   • superadmin  → vê tudo (acesso global — conta guicheweb@guicheweb.com.br).
--
-- "Área" = coluna TEXT profiles.departamento (não há tabela de áreas).
-- Admin SEM departamento cai só nas próprias atividades (same_area => false).
--
-- Esta migration depende de 20260617090000 (valor de enum 'superadmin') já
-- commitado. Espelha os padrões de has_role/is_active (SECURITY DEFINER + RLS).

-- ===========================================================================
-- 1) Atribui os papéis 'admin' e 'superadmin' à conta guicheweb (idempotente).
--    Mantém 'admin' para preservar o acesso dela às demais telas de admin
--    (operacional/escritório), que seguem com a regra admin = todos.
-- ===========================================================================
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, r.role
  FROM auth.users u
  CROSS JOIN (VALUES ('admin'::public.app_role), ('superadmin'::public.app_role)) AS r(role)
 WHERE u.email = 'guicheweb@guicheweb.com.br'
ON CONFLICT (user_id, role) DO NOTHING;

-- ===========================================================================
-- 2) Helpers de autorização (SECURITY DEFINER, espelham has_role/is_active).
-- ===========================================================================

-- Acesso global: usuário tem o papel 'superadmin'.
CREATE OR REPLACE FUNCTION public.is_superadmin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'superadmin'
  )
$$;

-- Mesma área: compara o departamento (normalizado) de viewer e dono.
-- Retorna false se a área do viewer for NULL/vazia → admin sem área vê só as próprias.
CREATE OR REPLACE FUNCTION public.same_area(_viewer uuid, _owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles va
      JOIN public.profiles ow ON ow.id = _owner
     WHERE va.id = _viewer
       AND va.departamento IS NOT NULL
       AND btrim(va.departamento) <> ''
       AND lower(btrim(va.departamento)) = lower(btrim(ow.departamento))
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_superadmin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.same_area(uuid, uuid) FROM PUBLIC, anon;

-- ===========================================================================
-- 3) Reescreve as policies de SELECT (own / mesma área / superadmin = tudo).
--    Substitui o "OR has_role('admin')" que dava 100% a qualquer admin.
--    As policies de escrita (*_write_admin) ficam como estão — a escrita real
--    passa pelas RPCs iniciar_atividade/parar_atividade (DEFINER, do dono).
-- ===========================================================================
DROP POLICY IF EXISTS "atividades_select" ON public.atividades;
CREATE POLICY "atividades_select" ON public.atividades
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = usuario_id AND public.is_active(auth.uid()))
    OR public.is_superadmin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin') AND public.same_area(auth.uid(), usuario_id))
  );

DROP POLICY IF EXISTS "apontamentos_select" ON public.atividade_apontamentos;
CREATE POLICY "apontamentos_select" ON public.atividade_apontamentos
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = usuario_id AND public.is_active(auth.uid()))
    OR public.is_superadmin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin') AND public.same_area(auth.uid(), usuario_id))
  );
