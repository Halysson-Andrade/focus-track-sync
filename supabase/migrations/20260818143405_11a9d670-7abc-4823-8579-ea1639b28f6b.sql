-- 1) Backup table for the legacy sanitation (rollback source). No raw row is deleted.
CREATE TABLE IF NOT EXISTS public.registros_atividade_overlap_backup (
  registro_id uuid PRIMARY KEY,
  fim_antigo timestamptz,
  duracao_antiga numeric,
  fim_novo timestamptz,
  saneado_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.registros_atividade_overlap_backup TO service_role;
ALTER TABLE public.registros_atividade_overlap_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS overlap_backup_superadmin_read ON public.registros_atividade_overlap_backup;
CREATE POLICY overlap_backup_superadmin_read
  ON public.registros_atividade_overlap_backup FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()));

-- 2) Close ALL open rows (not just the latest) at a given instant.
CREATE OR REPLACE FUNCTION public.fechar_registros_abertos(_uid uuid, _ts timestamptz, _exceto uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.registros_atividade
     SET fim = GREATEST(_ts, inicio),
         duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(_ts, inicio) - inicio)) / 60)
   WHERE usuario_id = _uid
     AND fim IS NULL
     AND (_exceto IS NULL OR id <> _exceto);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.fechar_registros_abertos(uuid, timestamptz, uuid) FROM public, anon;

-- 3) Safety net: any new row closes every still-open earlier row at its start.
CREATE OR REPLACE FUNCTION public.fechar_abertos_ao_inserir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.registros_atividade
     SET fim = GREATEST(NEW.inicio, inicio),
         duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(NEW.inicio, inicio) - inicio)) / 60)
   WHERE usuario_id = NEW.usuario_id
     AND id <> NEW.id
     AND fim IS NULL
     AND inicio <= NEW.inicio;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_fechar_abertos_ao_inserir ON public.registros_atividade;
CREATE TRIGGER trg_fechar_abertos_ao_inserir
AFTER INSERT ON public.registros_atividade
FOR EACH ROW EXECUTE FUNCTION public.fechar_abertos_ao_inserir();

-- 4) abrir_registro: serialize per user + close ALL open rows.
CREATE OR REPLACE FUNCTION public.abrir_registro(p_status text, p_observacao text DEFAULT NULL)
RETURNS public.registros_atividade
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
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

  -- Trava por usuário: impede que desktop e web abram dois registros em paralelo.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 42));

  IF p_status = 'ATIVO' AND public.gate_monitoramento_ativo() THEN
    SELECT EXISTS (
      SELECT 1 FROM public.presenca_extensao pe
       WHERE pe.usuario_id = v_uid AND pe.ultimo_visto > v_now - v_janela
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

  -- Fecha TODOS os registros abertos (antes fechava só o mais recente, o que
  -- deixava linhas órfãs abertas e gerava sobreposição no dia inteiro).
  PERFORM public.fechar_registros_abertos(v_uid, v_now);

  INSERT INTO public.registros_atividade (usuario_id, status, inicio, observacao)
    VALUES (v_uid, p_status::public.activity_status, v_now, p_observacao)
    RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.abrir_registro(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.abrir_registro(text, text) TO authenticated;