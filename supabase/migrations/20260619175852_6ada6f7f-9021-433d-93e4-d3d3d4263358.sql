-- Solicitação e aprovação de ajustes de jornada (correção de período, atestado, abono).
DO $$ BEGIN
  CREATE TYPE public.ajuste_tipo AS ENUM ('ajuste_periodo', 'atestado', 'abono');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ajuste_status AS ENUM ('pendente', 'aprovada', 'rejeitada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ajustes_jornada (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usuario_nome          text NOT NULL,
  departamento          text,
  dia                   date NOT NULL,
  tipo                  public.ajuste_tipo NOT NULL,
  inicio                timestamptz,
  fim                   timestamptz,
  status_alvo           public.activity_status,
  justificativa         text NOT NULL,
  status                public.ajuste_status NOT NULL DEFAULT 'pendente',
  decidido_por          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_por_nome     text,
  justificativa_decisao text,
  decidido_em           timestamptz,
  criado_em             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ajustes_jornada_usuario_dia_idx
  ON public.ajustes_jornada (usuario_id, dia);
CREATE INDEX IF NOT EXISTS ajustes_jornada_pendentes_idx
  ON public.ajustes_jornada (status)
  WHERE status = 'pendente';

GRANT SELECT ON public.ajustes_jornada TO authenticated;
GRANT ALL ON public.ajustes_jornada TO service_role;

ALTER TABLE public.ajustes_jornada ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ajustes_jornada_select" ON public.ajustes_jornada;
CREATE POLICY "ajustes_jornada_select" ON public.ajustes_jornada
  FOR SELECT TO authenticated
  USING (
    auth.uid() = usuario_id
    OR public.is_superadmin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin') AND public.same_area(auth.uid(), usuario_id))
  );

CREATE OR REPLACE FUNCTION public.solicitar_ajuste_jornada(
  p_dia           date,
  p_tipo          public.ajuste_tipo,
  p_justificativa text,
  p_inicio        timestamptz DEFAULT NULL,
  p_fim           timestamptz DEFAULT NULL,
  p_status_alvo   public.activity_status DEFAULT NULL
)
RETURNS public.ajustes_jornada
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_dept text;
  v_new  public.ajustes_jornada;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_dia IS NULL THEN
    RAISE EXCEPTION 'missing dia';
  END IF;
  IF p_justificativa IS NULL OR length(btrim(p_justificativa)) = 0 THEN
    RAISE EXCEPTION 'empty justification';
  END IF;
  IF p_tipo = 'ajuste_periodo' THEN
    IF p_status_alvo IS NULL THEN
      RAISE EXCEPTION 'ajuste_periodo requires status_alvo';
    END IF;
    IF p_inicio IS NULL OR p_fim IS NULL THEN
      RAISE EXCEPTION 'ajuste_periodo requires inicio and fim';
    END IF;
  END IF;
  IF p_inicio IS NOT NULL AND p_fim IS NOT NULL AND p_fim <= p_inicio THEN
    RAISE EXCEPTION 'fim must be after inicio';
  END IF;

  SELECT nome, departamento INTO v_nome, v_dept FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.ajustes_jornada
    (usuario_id, usuario_nome, departamento, dia, tipo, inicio, fim, status_alvo, justificativa)
  VALUES
    (v_uid, COALESCE(v_nome, 'Colaborador'), v_dept, p_dia, p_tipo,
     p_inicio, p_fim, p_status_alvo, btrim(p_justificativa))
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.solicitar_ajuste_jornada(date, public.ajuste_tipo, text, timestamptz, timestamptz, public.activity_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_ajuste_jornada(date, public.ajuste_tipo, text, timestamptz, timestamptz, public.activity_status) TO authenticated;

CREATE OR REPLACE FUNCTION public.decidir_ajuste_jornada(
  p_id            uuid,
  p_aprovar       boolean,
  p_justificativa text
)
RETURNS public.ajustes_jornada
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_row  public.ajustes_jornada;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_justificativa IS NULL OR length(btrim(p_justificativa)) = 0 THEN
    RAISE EXCEPTION 'empty decision justification';
  END IF;

  SELECT * INTO v_row FROM public.ajustes_jornada WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ajuste not found';
  END IF;
  IF v_row.status <> 'pendente' THEN
    RAISE EXCEPTION 'ajuste already decided';
  END IF;

  IF NOT (
    public.is_superadmin(v_uid)
    OR (public.has_role(v_uid, 'admin') AND public.same_area(v_uid, v_row.usuario_id))
  ) THEN
    RAISE EXCEPTION 'not allowed to decide this ajuste';
  END IF;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

  UPDATE public.ajustes_jornada
     SET status = CASE WHEN p_aprovar
                       THEN 'aprovada'::public.ajuste_status
                       ELSE 'rejeitada'::public.ajuste_status END,
         decidido_por          = v_uid,
         decidido_por_nome     = COALESCE(v_nome, 'Gestor'),
         justificativa_decisao = btrim(p_justificativa),
         decidido_em           = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decidir_ajuste_jornada(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_ajuste_jornada(uuid, boolean, text) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ajustes_jornada'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ajustes_jornada';
  END IF;
END $$;