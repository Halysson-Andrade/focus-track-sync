DROP POLICY IF EXISTS "registros_insert_closed_only" ON public.registros_atividade;

CREATE POLICY "registros_insert_closed_only" ON public.registros_atividade
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = usuario_id
    AND public.is_active(auth.uid())
    AND fim IS NOT NULL
  );