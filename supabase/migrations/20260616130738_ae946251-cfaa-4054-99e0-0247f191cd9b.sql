-- Apontamento de atividades por item (estilo Time Doctor).

CREATE TABLE IF NOT EXISTS public.atividades (
  id             UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fonte          TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  external_url   TEXT,
  titulo         TEXT NOT NULL,
  contexto       TEXT,
  total_segundos NUMERIC NOT NULL DEFAULT 0,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT atividades_item_uniq UNIQUE (usuario_id, fonte, external_id)
);

CREATE INDEX IF NOT EXISTS atividades_usuario_idx
  ON public.atividades (usuario_id, atualizado_em DESC);

CREATE TABLE IF NOT EXISTS public.atividade_apontamentos (
  id               UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  atividade_id     UUID NOT NULL REFERENCES public.atividades(id) ON DELETE CASCADE,
  usuario_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  registro_id      UUID REFERENCES public.registros_atividade(id) ON DELETE SET NULL,
  inicio           TIMESTAMPTZ NOT NULL DEFAULT now(),
  fim              TIMESTAMPTZ,
  duracao_segundos NUMERIC,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apontamentos_usuario_idx
  ON public.atividade_apontamentos (usuario_id, inicio DESC);
CREATE INDEX IF NOT EXISTS apontamentos_atividade_idx
  ON public.atividade_apontamentos (atividade_id, inicio DESC);

CREATE UNIQUE INDEX IF NOT EXISTS apontamentos_one_open_idx
  ON public.atividade_apontamentos (usuario_id)
  WHERE fim IS NULL;

ALTER TABLE public.atividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atividade_apontamentos ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.atividades TO authenticated;
GRANT SELECT ON public.atividade_apontamentos TO authenticated;
GRANT ALL ON public.atividades TO service_role;
GRANT ALL ON public.atividade_apontamentos TO service_role;

DROP POLICY IF EXISTS "atividades_select" ON public.atividades;
CREATE POLICY "atividades_select" ON public.atividades
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = usuario_id AND public.is_active(auth.uid()))
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "atividades_write_admin" ON public.atividades;
CREATE POLICY "atividades_write_admin" ON public.atividades
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "apontamentos_select" ON public.atividade_apontamentos;
CREATE POLICY "apontamentos_select" ON public.atividade_apontamentos
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = usuario_id AND public.is_active(auth.uid()))
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "apontamentos_write_admin" ON public.atividade_apontamentos;
CREATE POLICY "apontamentos_write_admin" ON public.atividade_apontamentos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.fechar_apontamento_aberto(
  p_uid uuid,
  p_fim timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open public.atividade_apontamentos;
  v_dur  numeric;
BEGIN
  SELECT * INTO v_open
    FROM public.atividade_apontamentos
   WHERE usuario_id = p_uid AND fim IS NULL
   ORDER BY inicio DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_dur := GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(p_fim, v_open.inicio) - v_open.inicio)));

  UPDATE public.atividade_apontamentos
     SET fim = GREATEST(p_fim, v_open.inicio),
         duracao_segundos = v_dur
   WHERE id = v_open.id;

  UPDATE public.atividades
     SET total_segundos = total_segundos + v_dur,
         atualizado_em = now()
   WHERE id = v_open.atividade_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fechar_apontamento_aberto(uuid, timestamptz) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.iniciar_atividade(
  p_fonte text,
  p_external_id text,
  p_external_url text,
  p_titulo text,
  p_contexto text DEFAULT NULL
)
RETURNS public.atividade_apontamentos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_now       timestamptz := now();
  v_registro  public.registros_atividade;
  v_atividade public.atividades;
  v_new       public.atividade_apontamentos;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_active(v_uid) THEN
    RAISE EXCEPTION 'user not active';
  END IF;
  IF p_fonte IS NULL OR p_fonte NOT IN ('trello', 'azure', 'gmail', 'outlook', 'manual') THEN
    RAISE EXCEPTION 'invalid fonte: %', p_fonte;
  END IF;
  IF p_external_id IS NULL OR length(btrim(p_external_id)) = 0 THEN
    RAISE EXCEPTION 'missing external_id';
  END IF;
  IF p_titulo IS NULL OR length(btrim(p_titulo)) = 0 THEN
    RAISE EXCEPTION 'missing titulo';
  END IF;

  SELECT * INTO v_registro
    FROM public.registros_atividade
   WHERE usuario_id = v_uid AND fim IS NULL
   ORDER BY inicio DESC
   LIMIT 1;
  IF NOT FOUND OR v_registro.status <> 'ATIVO' THEN
    RAISE EXCEPTION 'expediente não está ativo';
  END IF;

  INSERT INTO public.atividades (usuario_id, fonte, external_id, external_url, titulo, contexto)
    VALUES (v_uid, p_fonte, btrim(p_external_id), p_external_url, btrim(p_titulo), p_contexto)
  ON CONFLICT (usuario_id, fonte, external_id) DO UPDATE
    SET titulo = EXCLUDED.titulo,
        external_url = COALESCE(EXCLUDED.external_url, public.atividades.external_url),
        contexto = COALESCE(EXCLUDED.contexto, public.atividades.contexto),
        atualizado_em = now()
  RETURNING * INTO v_atividade;

  PERFORM public.fechar_apontamento_aberto(v_uid, v_now);

  INSERT INTO public.atividade_apontamentos (atividade_id, usuario_id, registro_id, inicio)
    VALUES (v_atividade.id, v_uid, v_registro.id, v_now)
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.iniciar_atividade(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_atividade(text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.parar_atividade()
RETURNS public.atividade_apontamentos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_row public.atividade_apontamentos;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT id INTO v_id
    FROM public.atividade_apontamentos
   WHERE usuario_id = v_uid AND fim IS NULL
   ORDER BY inicio DESC
   LIMIT 1;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.fechar_apontamento_aberto(v_uid, now());

  SELECT * INTO v_row FROM public.atividade_apontamentos WHERE id = v_id;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.parar_atividade() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parar_atividade() TO authenticated;

CREATE OR REPLACE FUNCTION public.fechar_apontamentos_ao_sair_de_ativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.fim IS NOT NULL OR NEW.status <> 'ATIVO' THEN
    PERFORM public.fechar_apontamento_aberto(NEW.usuario_id, COALESCE(NEW.fim, now()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fechar_apontamentos ON public.registros_atividade;
CREATE TRIGGER trg_fechar_apontamentos
  AFTER INSERT OR UPDATE ON public.registros_atividade
  FOR EACH ROW
  EXECUTE FUNCTION public.fechar_apontamentos_ao_sair_de_ativo();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'atividades'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.atividades';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'atividade_apontamentos'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.atividade_apontamentos';
  END IF;
END $$;