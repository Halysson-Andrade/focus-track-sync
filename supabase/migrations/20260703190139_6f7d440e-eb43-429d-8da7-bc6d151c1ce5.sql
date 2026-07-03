CREATE TABLE IF NOT EXISTS public.ajustes_jornada_exclusoes (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ajuste_id             uuid NOT NULL,
  usuario_id            uuid NOT NULL,
  usuario_nome          text NOT NULL,
  departamento          text,
  dia                   date NOT NULL,
  tipo                  public.ajuste_tipo NOT NULL,
  inicio                timestamptz,
  fim                   timestamptz,
  status_alvo           public.activity_status,
  justificativa         text,
  aprovado_por_nome     text,
  justificativa_exclusao text NOT NULL,
  excluido_por          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  excluido_por_nome     text,
  excluido_em           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ajustes_jornada_exclusoes_usuario_idx
  ON public.ajustes_jornada_exclusoes (usuario_id, dia);

GRANT SELECT ON public.ajustes_jornada_exclusoes TO authenticated;
GRANT ALL ON public.ajustes_jornada_exclusoes TO service_role;

ALTER TABLE public.ajustes_jornada_exclusoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ajustes_jornada_exclusoes_select" ON public.ajustes_jornada_exclusoes;
CREATE POLICY "ajustes_jornada_exclusoes_select" ON public.ajustes_jornada_exclusoes
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin') AND public.same_area(auth.uid(), usuario_id))
  );

CREATE OR REPLACE FUNCTION public.excluir_ajuste_jornada(
  p_id            uuid,
  p_justificativa text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_row  public.ajustes_jornada;
  v_log  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_justificativa IS NULL OR length(btrim(p_justificativa)) = 0 THEN
    RAISE EXCEPTION 'empty justification';
  END IF;

  SELECT * INTO v_row FROM public.ajustes_jornada WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ajuste not found';
  END IF;
  IF v_row.status <> 'aprovada' THEN
    RAISE EXCEPTION 'only approved ajustes can be deleted';
  END IF;

  IF NOT (
    public.is_superadmin(v_uid)
    OR (public.has_role(v_uid, 'admin') AND public.same_area(v_uid, v_row.usuario_id))
  ) THEN
    RAISE EXCEPTION 'not allowed to delete this ajuste';
  END IF;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.ajustes_jornada_exclusoes
    (ajuste_id, usuario_id, usuario_nome, departamento, dia, tipo, inicio, fim,
     status_alvo, justificativa, aprovado_por_nome, justificativa_exclusao,
     excluido_por, excluido_por_nome)
  VALUES
    (v_row.id, v_row.usuario_id, v_row.usuario_nome, v_row.departamento, v_row.dia,
     v_row.tipo, v_row.inicio, v_row.fim, v_row.status_alvo, v_row.justificativa,
     v_row.decidido_por_nome, btrim(p_justificativa), v_uid, COALESCE(v_nome, 'Gestor'))
  RETURNING id INTO v_log;

  DELETE FROM public.ajustes_jornada WHERE id = p_id;

  RETURN v_log;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.excluir_ajuste_jornada(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_ajuste_jornada(uuid, text) TO authenticated;