
-- ========== uso_app_diario ==========
CREATE TABLE public.uso_app_diario (
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia DATE NOT NULL,
  process_name TEXT NOT NULL,
  app_label TEXT,
  segundos_totais NUMERIC NOT NULL DEFAULT 0,
  segundos_inativos NUMERIC NOT NULL DEFAULT 0,
  sessoes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, dia, process_name)
);
GRANT SELECT ON public.uso_app_diario TO authenticated;
GRANT ALL ON public.uso_app_diario TO service_role;
ALTER TABLE public.uso_app_diario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own uso_app_diario" ON public.uso_app_diario
  FOR SELECT TO authenticated
  USING ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'));

-- ========== navegacao_diaria ==========
CREATE TABLE public.navegacao_diaria (
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia DATE NOT NULL,
  domain TEXT NOT NULL,
  segundos_totais NUMERIC NOT NULL DEFAULT 0,
  segundos_inativos NUMERIC NOT NULL DEFAULT 0,
  visitas INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, dia, domain)
);
GRANT SELECT ON public.navegacao_diaria TO authenticated;
GRANT ALL ON public.navegacao_diaria TO service_role;
ALTER TABLE public.navegacao_diaria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own navegacao_diaria" ON public.navegacao_diaria
  FOR SELECT TO authenticated
  USING ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'));

-- ========== atividade_diaria ==========
CREATE TABLE public.atividade_diaria (
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia DATE NOT NULL,
  minutos_ativo NUMERIC NOT NULL DEFAULT 0,
  minutos_pausa NUMERIC NOT NULL DEFAULT 0,
  minutos_almoco NUMERIC NOT NULL DEFAULT 0,
  minutos_inativo NUMERIC NOT NULL DEFAULT 0,
  inicio_jornada TIMESTAMPTZ,
  fim_jornada TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, dia)
);
GRANT SELECT ON public.atividade_diaria TO authenticated;
GRANT ALL ON public.atividade_diaria TO service_role;
ALTER TABLE public.atividade_diaria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own atividade_diaria" ON public.atividade_diaria
  FOR SELECT TO authenticated
  USING ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'));

-- ========== agregador idempotente ==========
CREATE OR REPLACE FUNCTION public.agregar_dia(p_dia DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- uso_app_diario: soma sessões fechadas cuja "inicio" cai no dia
  DELETE FROM public.uso_app_diario WHERE dia = p_dia;
  INSERT INTO public.uso_app_diario (usuario_id, dia, process_name, app_label, segundos_totais, segundos_inativos, sessoes)
  SELECT
    usuario_id,
    p_dia,
    process_name,
    MAX(app_label) AS app_label,
    COALESCE(SUM(duracao_segundos), 0),
    COALESCE(SUM(inativo_segundos), 0),
    COUNT(*)
  FROM public.uso_aplicativos
  WHERE inicio >= p_dia::timestamptz
    AND inicio < (p_dia + INTERVAL '1 day')::timestamptz
    AND fim IS NOT NULL
  GROUP BY usuario_id, process_name;

  -- navegacao_diaria
  DELETE FROM public.navegacao_diaria WHERE dia = p_dia;
  INSERT INTO public.navegacao_diaria (usuario_id, dia, domain, segundos_totais, segundos_inativos, visitas)
  SELECT
    usuario_id,
    p_dia,
    domain,
    COALESCE(SUM(duracao_segundos), 0),
    COALESCE(SUM(inativo_segundos), 0),
    COUNT(*)
  FROM public.navegacao_externa
  WHERE inicio >= p_dia::timestamptz
    AND inicio < (p_dia + INTERVAL '1 day')::timestamptz
    AND fim IS NOT NULL
  GROUP BY usuario_id, domain;

  -- atividade_diaria
  DELETE FROM public.atividade_diaria WHERE dia = p_dia;
  INSERT INTO public.atividade_diaria (
    usuario_id, dia,
    minutos_ativo, minutos_pausa, minutos_almoco, minutos_inativo,
    inicio_jornada, fim_jornada
  )
  SELECT
    usuario_id,
    p_dia,
    COALESCE(SUM(duracao_minutos) FILTER (WHERE status = 'ATIVO'), 0),
    COALESCE(SUM(duracao_minutos) FILTER (WHERE status = 'PAUSA'), 0),
    COALESCE(SUM(duracao_minutos) FILTER (WHERE status = 'ALMOCO'), 0),
    COALESCE(SUM(duracao_minutos) FILTER (WHERE status = 'INATIVO'), 0),
    MIN(inicio),
    MAX(COALESCE(fim, inicio))
  FROM public.registros_atividade
  WHERE inicio >= p_dia::timestamptz
    AND inicio < (p_dia + INTERVAL '1 day')::timestamptz
  GROUP BY usuario_id;
END;
$$;

-- ========== purga (não roda automático ainda) ==========
CREATE OR REPLACE FUNCTION public.purgar_brutos_antigos(p_dias_retencao INTEGER DEFAULT 30)
RETURNS TABLE(tabela TEXT, removidos BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_corte TIMESTAMPTZ := now() - (p_dias_retencao || ' days')::interval;
  v_navext BIGINT;
  v_uso BIGINT;
  v_pag BIGINT;
BEGIN
  IF p_dias_retencao < 7 THEN
    RAISE EXCEPTION 'Retenção mínima é 7 dias (recebido: %)', p_dias_retencao;
  END IF;

  WITH d AS (DELETE FROM public.navegacao_externa WHERE inicio < v_corte AND fim IS NOT NULL RETURNING 1)
  SELECT count(*) INTO v_navext FROM d;

  WITH d AS (DELETE FROM public.uso_aplicativos WHERE inicio < v_corte AND fim IS NOT NULL RETURNING 1)
  SELECT count(*) INTO v_uso FROM d;

  WITH d AS (DELETE FROM public.navegacao_paginas WHERE inicio < v_corte AND fim IS NOT NULL RETURNING 1)
  SELECT count(*) INTO v_pag FROM d;

  RETURN QUERY VALUES
    ('navegacao_externa', v_navext),
    ('uso_aplicativos', v_uso),
    ('navegacao_paginas', v_pag);
END;
$$;

-- ========== Backfill: agrega os últimos 60 dias para já ter histórico ==========
DO $$
DECLARE d DATE;
BEGIN
  FOR d IN SELECT (CURRENT_DATE - i)::date FROM generate_series(0, 60) AS i LOOP
    PERFORM public.agregar_dia(d);
  END LOOP;
END $$;
