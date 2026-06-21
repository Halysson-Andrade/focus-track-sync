-- 1) app_config
CREATE TABLE IF NOT EXISTS public.app_config (
  chave         text PRIMARY KEY,
  valor         jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_config TO authenticated;
GRANT ALL ON public.app_config TO service_role;

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

INSERT INTO public.app_config (chave, valor)
  VALUES ('gate_monitoramento_ativo', 'true'::jsonb)
  ON CONFLICT (chave) DO NOTHING;

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

-- 2) abrir_registro com gate
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

REVOKE EXECUTE ON FUNCTION public.abrir_registro(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_registro(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gate_monitoramento_ativo() TO authenticated;