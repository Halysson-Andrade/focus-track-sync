-- Aplica abrir_registro RPC (estava pendente) + define departamento padrão = 'Produção'.

-- 1) RPC abrir_registro
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
    VALUES (v_uid, p_status, v_now, p_observacao)
    RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.abrir_registro(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_registro(text, text) TO authenticated;

DROP POLICY IF EXISTS "Users manage own registros" ON public.registros_atividade;
DROP POLICY IF EXISTS "registros_select_own" ON public.registros_atividade;
CREATE POLICY "registros_select_own" ON public.registros_atividade
  FOR SELECT TO authenticated
  USING ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "registros_update_own" ON public.registros_atividade;
CREATE POLICY "registros_update_own" ON public.registros_atividade
  FOR UPDATE TO authenticated
  USING ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "registros_delete_own" ON public.registros_atividade;
CREATE POLICY "registros_delete_own" ON public.registros_atividade
  FOR DELETE TO authenticated
  USING ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "registros_insert_closed_only" ON public.registros_atividade;
CREATE POLICY "registros_insert_closed_only" ON public.registros_atividade
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (auth.uid() = usuario_id AND public.is_active(auth.uid()) AND fim IS NOT NULL)
  );

-- 2) Departamento padrão = 'Produção' para todos os perfis sem setor.
UPDATE public.profiles
   SET departamento = 'Produção'
 WHERE departamento IS NULL OR btrim(departamento) = '';
