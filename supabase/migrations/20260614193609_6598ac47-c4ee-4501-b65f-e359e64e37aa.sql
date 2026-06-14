-- ========================================================================
-- A2) presenca_web — heartbeat leve do app web
-- ========================================================================
CREATE TABLE public.presenca_web (
  usuario_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ultimo_ativo TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.presenca_web TO authenticated;
GRANT ALL ON public.presenca_web TO service_role;

ALTER TABLE public.presenca_web ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own presenca_web" ON public.presenca_web
  FOR ALL TO authenticated
  USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Admins read all presenca_web" ON public.presenca_web
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ========================================================================
-- B) eventos_ociosidade
-- ========================================================================
CREATE TABLE public.eventos_ociosidade (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inicio TIMESTAMPTZ NOT NULL,
  fim TIMESTAMPTZ NOT NULL,
  fonte TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.eventos_ociosidade TO authenticated;
GRANT ALL ON public.eventos_ociosidade TO service_role;

ALTER TABLE public.eventos_ociosidade ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own eventos_ociosidade" ON public.eventos_ociosidade
  FOR ALL TO authenticated
  USING (auth.uid() = usuario_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = usuario_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX eventos_ociosidade_usuario_inicio_idx
  ON public.eventos_ociosidade (usuario_id, inicio DESC);

-- ========================================================================
-- A) encerrar_sessoes_ociosas
-- ========================================================================
CREATE OR REPLACE FUNCTION public.encerrar_sessoes_ociosas(p_timeout_min INTEGER DEFAULT 15)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_corte TIMESTAMPTZ := now() - (p_timeout_min || ' minutes')::interval;
BEGIN
  WITH abertas AS (
    SELECT r.id, r.usuario_id, r.status, r.inicio
    FROM public.registros_atividade r
    WHERE r.fim IS NULL AND r.status <> 'ENCERRADO'
  ),
  vistos AS (
    SELECT
      a.id, a.usuario_id, a.status, a.inicio,
      GREATEST(
        a.inicio,
        COALESCE((SELECT pd.ultimo_ativo FROM public.presenca_desktop pd
                   WHERE pd.usuario_id = a.usuario_id), a.inicio),
        COALESCE((SELECT pw.ultimo_ativo FROM public.presenca_web pw
                   WHERE pw.usuario_id = a.usuario_id), a.inicio),
        COALESCE((SELECT MAX(COALESCE(ne.fim,
                    ne.inicio + (COALESCE(ne.duracao_segundos, 0) || ' seconds')::interval))
                   FROM public.navegacao_externa ne
                   WHERE ne.usuario_id = a.usuario_id AND ne.inicio >= a.inicio), a.inicio),
        COALESCE((SELECT MAX(COALESCE(ua.fim,
                    ua.inicio + (COALESCE(ua.duracao_segundos, 0) || ' seconds')::interval))
                   FROM public.uso_aplicativos ua
                   WHERE ua.usuario_id = a.usuario_id AND ua.inicio >= a.inicio), a.inicio),
        COALESCE((SELECT MAX(COALESCE(np.fim,
                    np.inicio + (COALESCE(np.duracao_segundos, 0) || ' seconds')::interval))
                   FROM public.navegacao_paginas np
                   WHERE np.usuario_id = a.usuario_id AND np.inicio >= a.inicio), a.inicio)
      ) AS visto_em
    FROM abertas a
  ),
  alvos AS (
    SELECT v.id, GREATEST(v.visto_em, v.inicio) AS fim_calc
    FROM vistos v
    WHERE
      (v.status IN ('ATIVO', 'INATIVO') AND v.visto_em < v_corte)
      OR (v.status IN ('PAUSA', 'ALMOCO') AND v.visto_em < now() - interval '12 hours')
  )
  UPDATE public.registros_atividade r
  SET fim = alvos.fim_calc,
      duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (alvos.fim_calc - r.inicio)) / 60),
      observacao = CASE
        WHEN COALESCE(r.observacao, '') = '' THEN '[auto-encerrado: sem sinal]'
        ELSE r.observacao || ' [auto-encerrado: sem sinal]'
      END
  FROM alvos
  WHERE r.id = alvos.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.encerrar_sessoes_ociosas(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_sessoes_ociosas(INTEGER) TO service_role;

-- ========================================================================
-- Retenção
-- ========================================================================
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
  v_ocio BIGINT;
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

  WITH d AS (DELETE FROM public.eventos_ociosidade WHERE inicio < v_corte RETURNING 1)
  SELECT count(*) INTO v_ocio FROM d;

  RETURN QUERY VALUES
    ('navegacao_externa', v_navext),
    ('uso_aplicativos', v_uso),
    ('navegacao_paginas', v_pag),
    ('eventos_ociosidade', v_ocio);
END;
$$;

-- ========================================================================
-- Realtime
-- ========================================================================
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['presenca_web', 'eventos_ociosidade']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ========================================================================
-- pg_cron: agenda auto-encerramento a cada 5 min
-- ========================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encerrar-ociosas') THEN
    PERFORM cron.unschedule('encerrar-ociosas');
  END IF;
  PERFORM cron.schedule(
    'encerrar-ociosas',
    '*/5 * * * *',
    $cron$ SELECT public.encerrar_sessoes_ociosas(15) $cron$
  );
END $$;
