-- "Encerrar expediente" de outro usuário pelo escritório virtual — privilégio de
-- superadmin, com registro de log. Encerra o registro de atividade ABERTO do alvo
-- (fica offline no mapa). NÃO revoga a sessão de autenticação do navegador dele;
-- como o expediente só reabre por clique no web, na prática interrompe o tracking.
--
-- Espelha abrir_registro (SECURITY DEFINER, fecha o registro aberto, calcula
-- duração) e o logout do app (AppShell), que também fecha a navegação aberta.

-- ===========================================================================
-- 1) Tabela de log de ações administrativas (não havia auditoria no projeto).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.admin_acoes_log (
  id        uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ator_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ator_nome text,
  alvo_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acao      text NOT NULL,            -- ex.: 'encerrar_expediente'
  motivo    text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_acoes_log_alvo_idx
  ON public.admin_acoes_log (alvo_id, criado_em DESC);

GRANT SELECT ON public.admin_acoes_log TO authenticated;
GRANT ALL ON public.admin_acoes_log TO service_role;

ALTER TABLE public.admin_acoes_log ENABLE ROW LEVEL SECURITY;

-- Leitura para admin/superadmin (has_role('admin') já cobre superadmin, que
-- também recebe o papel 'admin'). INSERT só pela RPC SECURITY DEFINER abaixo.
DROP POLICY IF EXISTS "admin_acoes_log_select" ON public.admin_acoes_log;
CREATE POLICY "admin_acoes_log_select" ON public.admin_acoes_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ===========================================================================
-- 2) RPC: encerra o expediente do alvo (gate de superadmin) + grava log.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.encerrar_expediente_admin(
  p_usuario uuid,
  p_motivo  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_now   timestamptz := now();
  v_nome  text;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_superadmin(v_uid) THEN
    RAISE EXCEPTION 'only superadmin';
  END IF;
  IF p_usuario IS NULL THEN
    RAISE EXCEPTION 'missing target';
  END IF;

  -- Fecha o(s) registro(s) de atividade aberto(s) do alvo.
  UPDATE public.registros_atividade
     SET fim = v_now,
         duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - inicio)) / 60),
         observacao = 'Encerrado pelo superadmin'
   WHERE usuario_id = p_usuario AND fim IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Defensivo: fecha navegação de página aberta (espelha o logout do app web).
  UPDATE public.navegacao_paginas
     SET fim = v_now,
         duracao_segundos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - inicio)))
   WHERE usuario_id = p_usuario AND fim IS NULL;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.admin_acoes_log (ator_id, ator_nome, alvo_id, acao, motivo)
    VALUES (v_uid, COALESCE(v_nome, 'superadmin'), p_usuario, 'encerrar_expediente', p_motivo);

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.encerrar_expediente_admin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_expediente_admin(uuid, text) TO authenticated;
