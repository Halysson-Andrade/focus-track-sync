CREATE OR REPLACE FUNCTION public.itens_categorizacao(p_dias int)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_since timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_superadmin(v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_dias IS NULL OR p_dias <= 0 THEN
    v_since := '-infinity'::timestamptz;
  ELSE
    v_since := now() - make_interval(days => p_dias);
  END IF;

  RETURN jsonb_build_object(
    'dominios', COALESCE((
      SELECT jsonb_agg(t) FROM (
        SELECT lower(ne.domain) AS identificador,
               sum(greatest(coalesce(ne.duracao_segundos, 0)
                            - coalesce(ne.inativo_segundos, 0), 0))::bigint AS segundos,
               count(*)::bigint AS ocorrencias,
               max(ne.inicio) AS ultima_vez
          FROM public.navegacao_externa ne
         WHERE ne.inicio >= v_since
           AND ne.domain IS NOT NULL
           AND btrim(ne.domain) <> ''
         GROUP BY lower(ne.domain)
      ) t), '[]'::jsonb),
    'processos', COALESCE((
      SELECT jsonb_agg(t) FROM (
        SELECT lower(ua.process_name) AS identificador,
               max(ua.app_label) AS label,
               sum(greatest(coalesce(ua.duracao_segundos, 0)
                            - coalesce(ua.inativo_segundos, 0), 0))::bigint AS segundos,
               count(*)::bigint AS ocorrencias,
               max(ua.inicio) AS ultima_vez
          FROM public.uso_aplicativos ua
         WHERE ua.inicio >= v_since
           AND ua.process_name IS NOT NULL
           AND btrim(ua.process_name) <> ''
         GROUP BY lower(ua.process_name)
      ) t), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.itens_categorizacao(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.itens_categorizacao(int) TO authenticated;