CREATE OR REPLACE FUNCTION public.espelho_ponto(p_usuario uuid, p_de date, p_ate date)
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_superadmin(v_uid) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  IF p_usuario IS NULL OR p_de IS NULL OR p_ate IS NULL THEN
    RAISE EXCEPTION 'missing parameters';
  END IF;
  IF p_ate < p_de THEN
    RAISE EXCEPTION 'p_ate must be >= p_de';
  END IF;

  v_ini := p_de::timestamptz;
  v_fim := (p_ate + INTERVAL '1 day')::timestamptz;

  RETURN jsonb_build_object(
    'perfil', (
      SELECT jsonb_build_object(
        'id', p.id, 'nome', p.nome, 'email', p.email,
        'cargo', p.cargo, 'departamento', p.departamento, 'ativo', p.ativo)
      FROM public.profiles p WHERE p.id = p_usuario
    ),
    'registros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'status', r.status,
        'inicio', r.inicio, 'fim', r.fim,
        'duracao_minutos', r.duracao_minutos,
        'observacao', r.observacao
      ) ORDER BY r.inicio)
      FROM public.registros_atividade r
      WHERE r.usuario_id = p_usuario
        AND r.inicio >= v_ini AND r.inicio < v_fim
    ), '[]'::jsonb),
    'ajustes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'dia', a.dia, 'tipo', a.tipo, 'status', a.status,
        'inicio', a.inicio, 'fim', a.fim, 'status_alvo', a.status_alvo,
        'justificativa', a.justificativa,
        'decidido_por_nome', a.decidido_por_nome,
        'justificativa_decisao', a.justificativa_decisao,
        'decidido_em', a.decidido_em
      ) ORDER BY a.dia)
      FROM public.ajustes_jornada a
      WHERE a.usuario_id = p_usuario
        AND a.dia >= p_de AND a.dia <= p_ate
    ), '[]'::jsonb),
    'eventos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'inicio', e.inicio, 'fim', e.fim
      ) ORDER BY e.inicio)
      FROM public.eventos_ociosidade e
      WHERE e.usuario_id = p_usuario
        AND e.inicio >= v_ini AND e.inicio < v_fim
    ), '[]'::jsonb),
    'apps', COALESCE((
      SELECT jsonb_agg(t) FROM (
        SELECT u.process_name,
               MAX(u.app_label) AS app_label,
               SUM(u.segundos_totais)::bigint AS segundos_totais,
               SUM(u.segundos_inativos)::bigint AS segundos_inativos,
               SUM(u.sessoes)::bigint AS sessoes
        FROM public.uso_app_diario u
        WHERE u.usuario_id = p_usuario
          AND u.dia >= p_de AND u.dia <= p_ate
        GROUP BY u.process_name
      ) t
    ), '[]'::jsonb),
    'sites', COALESCE((
      SELECT jsonb_agg(t) FROM (
        SELECT n.domain,
               SUM(n.segundos_totais)::bigint AS segundos_totais,
               SUM(n.segundos_inativos)::bigint AS segundos_inativos,
               SUM(n.visitas)::bigint AS visitas
        FROM public.navegacao_diaria n
        WHERE n.usuario_id = p_usuario
          AND n.dia >= p_de AND n.dia <= p_ate
        GROUP BY n.domain
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.espelho_ponto(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.espelho_ponto(uuid, date, date) TO authenticated;