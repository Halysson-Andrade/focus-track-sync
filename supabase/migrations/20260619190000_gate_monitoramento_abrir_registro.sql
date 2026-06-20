-- Gate de monitoração obrigatória no início/retomada do expediente.
--
-- Problema: o botão "voltar ao trabalho" (e o início normal) abriam o expediente
-- em ATIVO sem garantir que a extensão do Chrome E o app desktop estivessem
-- logados/online — permitindo trabalhar sem monitoração. Este gate é aplicado no
-- BACKEND (autoridade final), então vale para qualquer caminho: web, desktop e
-- os popups de "sessão perdida / voltar ao trabalho".
--
-- Regras:
--   * Só afeta a abertura de status ATIVO. PAUSA/ALMOCO/INATIVO/ENCERRADO seguem
--     livres (são transições de quem já estava sendo monitorado).
--   * Exige heartbeat recente (3 min, alinhado ao EXT_ONLINE_WINDOW_MS do app):
--       - extensão: presenca_extensao.ultimo_visto
--       - desktop : GREATEST(presenca_desktop.ultimo_visto, ultimo_ativo)
--     Aceitar ultimo_ativo além de ultimo_visto mantém o DESKTOP ANTIGO (que só
--     grava ultimo_ativo) funcionando — compatibilidade retroativa.
--   * Kill-switch: app_config.gate_monitoramento_ativo. Default ligado; se causar
--     problema em produção, basta desligar (UPDATE) — sem redeploy de clientes,
--     voltando ao comportamento atual. "Nada pode parar".

-- 1) Config simples key/value para flags operacionais.
CREATE TABLE IF NOT EXISTS public.app_config (
  chave         text PRIMARY KEY,
  valor         jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_config_select ON public.app_config;
CREATE POLICY app_config_select ON public.app_config
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS app_config_write ON public.app_config;
CREATE POLICY app_config_write ON public.app_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid()));

-- Kill-switch do gate (default LIGADO).
INSERT INTO public.app_config (chave, valor)
  VALUES ('gate_monitoramento_ativo', 'true'::jsonb)
  ON CONFLICT (chave) DO NOTHING;

-- Helper: gate ligado? (default true se a linha não existir)
CREATE OR REPLACE FUNCTION public.gate_monitoramento_ativo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT valor = 'true'::jsonb FROM public.app_config WHERE chave = 'gate_monitoramento_ativo'),
    true
  )
$$;

-- 2) abrir_registro com o gate. Mantém a assinatura e toda a lógica anterior
--    (cast para activity_status, fechamento da linha aberta) — só adiciona o
--    bloco de verificação de presença quando p_status = 'ATIVO'.
CREATE OR REPLACE FUNCTION public.abrir_registro(
  p_status text,
  p_observacao text DEFAULT NULL
)
RETURNS public.registros_atividade
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_open public.registros_atividade;
  v_new public.registros_atividade;
  v_janela constant interval := interval '3 minutes';
  v_ext_ok boolean;
  v_desk_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_active(v_uid) THEN
    RAISE EXCEPTION 'user not active';
  END IF;
  IF p_status NOT IN ('ATIVO', 'PAUSA', 'ALMOCO', 'INATIVO') THEN
    RAISE EXCEPTION 'invalid open status: %', p_status;
  END IF;

  -- GATE de monitoração: só ao abrir ATIVO e quando o kill-switch está ligado.
  IF p_status = 'ATIVO' AND public.gate_monitoramento_ativo() THEN
    SELECT EXISTS (
      SELECT 1 FROM public.presenca_extensao pe
       WHERE pe.usuario_id = v_uid
         AND pe.ultimo_visto > v_now - v_janela
    ) INTO v_ext_ok;
    IF NOT v_ext_ok THEN
      RAISE EXCEPTION 'extension_offline';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.presenca_desktop pd
       WHERE pd.usuario_id = v_uid
         AND GREATEST(COALESCE(pd.ultimo_visto, 'epoch'::timestamptz),
                      COALESCE(pd.ultimo_ativo, 'epoch'::timestamptz)) > v_now - v_janela
    ) INTO v_desk_ok;
    IF NOT v_desk_ok THEN
      RAISE EXCEPTION 'desktop_offline';
    END IF;
  END IF;

  -- Fecha a sessão aberta atual do usuário (defensivo).
  SELECT * INTO v_open
    FROM public.registros_atividade
   WHERE usuario_id = v_uid AND fim IS NULL
   ORDER BY inicio DESC
   LIMIT 1;
  IF FOUND THEN
    UPDATE public.registros_atividade
       SET fim = v_now,
           duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - inicio)) / 60)
     WHERE id = v_open.id;
  END IF;

  INSERT INTO public.registros_atividade (usuario_id, status, inicio, observacao)
    VALUES (v_uid, p_status::public.activity_status, v_now, p_observacao)
    RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

-- Permissões inalteradas (a função já era executável por authenticated).
REVOKE EXECUTE ON FUNCTION public.abrir_registro(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_registro(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gate_monitoramento_ativo() TO authenticated;
