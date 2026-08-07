CREATE OR REPLACE FUNCTION public.relatorio_inatividade(p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ini timestamptz;
  v_fim timestamptz;
  v_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_de IS NULL OR p_ate IS NULL THEN
    RAISE EXCEPTION 'missing parameters';
  END IF;
  IF p_ate < p_de THEN
    RAISE EXCEPTION 'p_ate must be >= p_de';
  END IF;

  IF public.is_superadmin(v_uid) OR public.can_espelho_geral(v_uid) THEN
    SELECT array_agg(p.id) INTO v_ids
      FROM public.profiles p WHERE p.ativo = true;
  ELSIF public.has_role(v_uid, 'admin') THEN
    SELECT array_agg(p.id) INTO v_ids
      FROM public.profiles p
     WHERE p.ativo = true AND public.same_area(v_uid, p.id);
  ELSE
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);

  v_ini := p_de::timestamptz;
  v_fim := (p_ate + INTERVAL '1 day')::timestamptz;

  RETURN jsonb_build_object(
    'profiles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'departamento', p.departamento))
        FROM public.profiles p
       WHERE p.id = ANY(v_ids)), '[]'::jsonb),
    'registros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'usuario_id', r.usuario_id, 'inicio', r.inicio, 'fim', r.fim,
               'duracao_minutos', r.duracao_minutos) ORDER BY r.inicio)
        FROM public.registros_atividade r
       WHERE r.usuario_id = ANY(v_ids)
         AND r.status = 'ATIVO'
         AND r.inicio >= v_ini AND r.inicio < v_fim), '[]'::jsonb),
    'eventos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'usuario_id', e.usuario_id, 'inicio', e.inicio, 'fim', e.fim) ORDER BY e.inicio)
        FROM public.eventos_ociosidade e
       WHERE e.usuario_id = ANY(v_ids)
         AND e.inicio >= v_ini AND e.inicio < v_fim), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.relatorio_inatividade(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_inatividade(date, date) TO authenticated;