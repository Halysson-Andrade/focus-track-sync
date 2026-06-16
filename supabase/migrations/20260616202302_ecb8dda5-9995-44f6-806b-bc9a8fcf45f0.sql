CREATE TABLE IF NOT EXISTS public.categoria_atividade (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('dominio', 'processo')),
  identificador TEXT NOT NULL,
  categoria TEXT NOT NULL,
  produtiva BOOLEAN NOT NULL DEFAULT true,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.categoria_atividade TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.categoria_atividade TO authenticated;
GRANT ALL ON public.categoria_atividade TO service_role;

ALTER TABLE public.categoria_atividade ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read categories"
  ON public.categoria_atividade
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can insert categories"
  ON public.categoria_atividade
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update categories"
  ON public.categoria_atividade
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete categories"
  ON public.categoria_atividade
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_categoria_atividade_tipo_identificador
  ON public.categoria_atividade (tipo, LOWER(identificador));

INSERT INTO public.categoria_atividade (tipo, identificador, categoria, produtiva)
VALUES
  ('dominio', 'github.com', 'Desenvolvimento', true),
  ('dominio', 'meet.google.com', 'Reunião', true),
  ('dominio', 'teams.microsoft.com', 'Reunião', true),
  ('dominio', 'mail.google.com', 'Comunicação', true),
  ('dominio', 'youtube.com', 'Distração', false),
  ('processo', 'Code.exe', 'Desenvolvimento', true),
  ('processo', 'WINWORD.EXE', 'Documentação', true)
ON CONFLICT (tipo, LOWER(identificador)) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'categoria_atividade'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.categoria_atividade';
  END IF;
END $$;
