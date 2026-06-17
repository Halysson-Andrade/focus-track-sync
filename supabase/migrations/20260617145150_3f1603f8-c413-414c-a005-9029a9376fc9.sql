INSERT INTO public.user_roles (user_id, role)
SELECT u.id, r.role
  FROM auth.users u
  CROSS JOIN (VALUES ('admin'::public.app_role), ('superadmin'::public.app_role)) AS r(role)
 WHERE u.email = 'guicheweb@guicheweb.com.br'
ON CONFLICT (user_id, role) DO NOTHING;

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