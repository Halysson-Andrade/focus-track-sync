-- 1) office_overview: include desktop app_version
CREATE OR REPLACE FUNCTION public.office_overview(p_since timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN jsonb_build_object(
    'profiles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'cargo', p.cargo, 'departamento', p.departamento))
        FROM public.profiles p
       WHERE p.ativo = true), '[]'::jsonb),
    'registros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'usuario_id', r.usuario_id, 'status', r.status,
               'inicio', r.inicio, 'fim', r.fim, 'duracao_minutos', r.duracao_minutos))
        FROM public.registros_atividade r
       WHERE r.inicio >= p_since), '[]'::jsonb),
    'presenca', COALESCE((
      SELECT jsonb_agg(j) FROM (
        SELECT jsonb_build_object('usuario_id', pd.usuario_id, 'ultimo_ativo', pd.ultimo_ativo,
                                  'fonte', 'desktop', 'versao', pd.app_version) AS j
          FROM public.presenca_desktop pd
        UNION ALL
        SELECT jsonb_build_object('usuario_id', pw.usuario_id, 'ultimo_ativo', pw.ultimo_ativo,
                                  'fonte', 'web')
          FROM public.presenca_web pw
      ) u), '[]'::jsonb),
    'admin_ids', COALESCE((
      SELECT jsonb_agg(ur.user_id)
        FROM public.user_roles ur
       WHERE ur.role = 'admin'), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.office_overview(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_overview(timestamptz) TO authenticated;

-- 2) Restrict self-update on profiles to safe columns via column-level grants.
-- Admin-side mutations (activate/deactivate, role, profile edits) go through
-- server functions that use the service role, so they are unaffected.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (nome, cargo, departamento, must_change_password) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
