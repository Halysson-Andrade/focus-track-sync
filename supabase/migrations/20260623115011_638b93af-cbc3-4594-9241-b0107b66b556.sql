CREATE TABLE IF NOT EXISTS public.categoria_catalogo (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  grupo TEXT NOT NULL DEFAULT 'Outras',
  produtiva BOOLEAN NOT NULL DEFAULT true,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.categoria_catalogo TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.categoria_catalogo TO authenticated;
GRANT ALL ON public.categoria_catalogo TO service_role;

ALTER TABLE public.categoria_catalogo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read categoria_catalogo" ON public.categoria_catalogo;
CREATE POLICY "Authenticated users can read categoria_catalogo"
  ON public.categoria_catalogo FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Only admins can insert categoria_catalogo" ON public.categoria_catalogo;
CREATE POLICY "Only admins can insert categoria_catalogo"
  ON public.categoria_catalogo FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Only admins can update categoria_catalogo" ON public.categoria_catalogo;
CREATE POLICY "Only admins can update categoria_catalogo"
  ON public.categoria_catalogo FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Only admins can delete categoria_catalogo" ON public.categoria_catalogo;
CREATE POLICY "Only admins can delete categoria_catalogo"
  ON public.categoria_catalogo FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_categoria_catalogo_nome
  ON public.categoria_catalogo (LOWER(nome));

INSERT INTO public.categoria_catalogo (nome, grupo, produtiva)
VALUES
  ('Sistema interno', 'Sistemas & Trabalho', true),
  ('Ferramenta de trabalho', 'Sistemas & Trabalho', true),
  ('Uso de IA', 'Sistemas & Trabalho', true),
  ('Desenvolvimento', 'Sistemas & Trabalho', true),
  ('Documentação', 'Sistemas & Trabalho', true),
  ('Telefone', 'Comunicação', true),
  ('Comunicação', 'Comunicação', true),
  ('Reunião', 'Comunicação', true),
  ('Notícias', 'Informação & Lazer', false),
  ('Mídia Social', 'Informação & Lazer', false),
  ('Distração', 'Informação & Lazer', false)
ON CONFLICT (LOWER(nome)) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'categoria_catalogo'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.categoria_catalogo';
  END IF;
END $$;