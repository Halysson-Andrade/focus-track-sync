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