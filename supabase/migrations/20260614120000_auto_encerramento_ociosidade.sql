-- Tempos assertivos:
--   A) Auto-encerramento server-side de sessões presas (registros_atividade
--      abertos sem sinal recente) — descarta o "tempo morto" fixando o `fim` no
--      último heartbeat real, em vez de contar até now().
--   A2) Heartbeat do web (presenca_web) como rede de segurança para usuário
--       só-web (sem extensão/desktop), evitando auto-encerramento por engano.
--   B) Intervalos PRECISOS de ociosidade (eventos_ociosidade) emitidos pelo
--      desktop (apps nativos) e pela extensão (navegador), para a linha do tempo
--      mostrar EM QUE MOMENTO da jornada houve ócio.

-- ========================================================================
-- A2) presenca_web — heartbeat leve do app web (espelha presenca_desktop).
--     IMPORTANTE: o web NÃO lê esta tabela de volta para sua detecção de
--     INATIVO (senão se auto-alimentaria). Serve ao auto-encerramento e ao
--     cálculo de presença online no painel operacional.
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
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Admins read all presenca_web" ON public.presenca_web
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ========================================================================
-- B) eventos_ociosidade — um intervalo [inicio, fim] por período ocioso.
--    `fonte` = 'desktop' (apps nativos) | 'extension' (navegador). As fontes
--    são complementares (não cobrem a mesma janela), então não há dupla
--    contagem ao unir/desenhar os dois conjuntos.
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
-- A) encerrar_sessoes_ociosas — fecha registros abertos sem sinal recente.
--    `fim` = último instante conhecido de atividade (visto_em), nunca now():
--    assim o intervalo morto entre a última atividade e a detecção some da
--    jornada (tempo indevido deixa de ser contabilizado).
--
--    Regra por status:
--      - ATIVO / INATIVO: encerra quando visto_em < now() - p_timeout_min.
--      - PAUSA / ALMOCO : ausência é esperada; só encerra abandonos antigos
--        (aberto há > 12h), evitando cortar quem está legitimamente em pausa.
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

GRANT EXECUTE ON FUNCTION public.encerrar_sessoes_ociosas(INTEGER) TO service_role;

-- ========================================================================
-- Retenção: estende purgar_brutos_antigos para também limpar eventos_ociosidade
-- (dado bruto que cresce). presenca_web NÃO entra: é 1 linha por usuário
-- (upsert), não acumula. Mantém o contrato/assinatura da versão atual e só
-- acrescenta a nova tabela ao resultado.
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
-- Realtime: reflete heartbeat web e ociosidade ao vivo no painel/timeline.
-- ========================================================================
DO $$
DECLARE
  t text;
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
