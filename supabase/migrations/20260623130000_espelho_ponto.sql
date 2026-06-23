-- Espelho de ponto (relatório consolidado por usuário/período) — somente superadmin.
--
-- Reúne, num único acesso AUTORIZADO e por intervalo, todos os dados que o front
-- precisa para montar o "espelho de ponto" (marcações de entrada/almoço/saída,
-- KPIs do período, abonos/edições com motivos, top apps/sites):
--   - registros_atividade (tracking bruto: marcações + jornada)
--   - ajustes_jornada (overlay aprovado/decidido, com as justificativas)
--   - eventos_ociosidade (ócio reconciliado — o front NÃO lê esta tabela direto:
--       o RLS é "Users manage own", então a leitura de terceiros só é possível
--       aqui, via SECURITY DEFINER)
--   - uso_app_diario / navegacao_diaria (agregados de longo prazo p/ top apps/sites)
--
-- A derivação (aplicar overlay, marcações, totais, ociosidade) é feita no cliente,
-- reaproveitando as mesmas libs do dashboard (jornada-efetiva.ts, ocio.ts) — esta
-- RPC só ENTREGA os dados crus do período, sem duplicar a lógica de jornada.
--
-- Gate: superadmin (is_superadmin). Espelha o padrão de office_overview/detail e
-- ajustes_jornada (RPC SECURITY DEFINER como única via autorizada).

CREATE OR REPLACE FUNCTION public.espelho_ponto(
  p_usuario uuid,
  p_de      date,
  p_ate     date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_de_ts  timestamptz := p_de::timestamptz;                       -- início inclusivo
  v_ate_ts timestamptz := (p_ate + INTERVAL '1 day')::timestamptz; -- fim exclusivo (dia inteiro)
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  -- Somente superadmin pode exportar o espelho de qualquer colaborador.
  IF NOT public.is_superadmin(v_uid) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  IF p_usuario IS NULL OR p_de IS NULL OR p_ate IS NULL THEN
    RAISE EXCEPTION 'missing args';
  END IF;
  IF p_ate < p_de THEN
    RAISE EXCEPTION 'ate must be >= de';
  END IF;

  SELECT jsonb_build_object(
    -- Cabeçalho do espelho.
    'perfil', (
      SELECT jsonb_build_object(
        'nome', nome, 'cargo', cargo, 'departamento', departamento, 'email', email
      )
      FROM public.profiles WHERE id = p_usuario
    ),

    -- Tracking bruto do período (marcações + jornada). Intocado.
    'registros', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id, 'status', status, 'inicio', inicio, 'fim', fim,
          'duracao_minutos', duracao_minutos
        ) ORDER BY inicio
      )
      FROM public.registros_atividade
      WHERE usuario_id = p_usuario AND inicio >= v_de_ts AND inicio < v_ate_ts
    ), '[]'::jsonb),

    -- Overlay decidido (aprovado/rejeitado), com as duas justificativas.
    'ajustes', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id, 'dia', dia, 'tipo', tipo, 'inicio', inicio, 'fim', fim,
          'status', status, 'status_alvo', status_alvo,
          'justificativa', justificativa, 'justificativa_decisao', justificativa_decisao,
          'decidido_por_nome', decidido_por_nome, 'decidido_em', decidido_em
        ) ORDER BY dia
      )
      FROM public.ajustes_jornada
      WHERE usuario_id = p_usuario AND dia >= p_de AND dia <= p_ate
    ), '[]'::jsonb),

    -- Intervalos discretos de ociosidade (fonte do ócio reconciliado no cliente).
    'eventos', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('inicio', inicio, 'fim', fim) ORDER BY inicio
      )
      FROM public.eventos_ociosidade
      WHERE usuario_id = p_usuario AND inicio >= v_de_ts AND inicio < v_ate_ts
    ), '[]'::jsonb),

    -- Top apps (agregado diário somado no período).
    'apps', COALESCE((
      SELECT jsonb_agg(t)
      FROM (
        SELECT process_name,
               MAX(app_label)              AS app_label,
               SUM(segundos_totais)        AS segundos_totais,
               SUM(segundos_inativos)      AS segundos_inativos
        FROM public.uso_app_diario
        WHERE usuario_id = p_usuario AND dia >= p_de AND dia <= p_ate
        GROUP BY process_name
      ) t
    ), '[]'::jsonb),

    -- Top sites (agregado diário somado no período).
    'sites', COALESCE((
      SELECT jsonb_agg(t)
      FROM (
        SELECT domain,
               SUM(segundos_totais)   AS segundos_totais,
               SUM(segundos_inativos) AS segundos_inativos
        FROM public.navegacao_diaria
        WHERE usuario_id = p_usuario AND dia >= p_de AND dia <= p_ate
        GROUP BY domain
      ) t
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.espelho_ponto(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.espelho_ponto(uuid, date, date) TO authenticated;
