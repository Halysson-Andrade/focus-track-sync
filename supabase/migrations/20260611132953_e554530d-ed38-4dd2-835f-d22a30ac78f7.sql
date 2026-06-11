
CREATE TABLE public.uso_aplicativos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  process_name TEXT NOT NULL,
  app_label TEXT,
  executable_path TEXT,
  platform TEXT,
  inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  fim TIMESTAMPTZ,
  duracao_segundos NUMERIC,
  inativo_segundos NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX uso_aplicativos_usuario_inicio_idx ON public.uso_aplicativos (usuario_id, inicio DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.uso_aplicativos TO authenticated;
GRANT ALL ON public.uso_aplicativos TO service_role;

ALTER TABLE public.uso_aplicativos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own app usage" ON public.uso_aplicativos
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Admins read all app usage" ON public.uso_aplicativos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
