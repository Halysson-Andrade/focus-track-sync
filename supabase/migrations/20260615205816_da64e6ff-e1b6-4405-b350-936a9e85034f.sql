-- Add ultimo_visto/app_version to presenca_desktop
ALTER TABLE public.presenca_desktop
  ADD COLUMN IF NOT EXISTS ultimo_visto TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS app_version  TEXT;

-- Create presenca_extensao
CREATE TABLE IF NOT EXISTS public.presenca_extensao (
  usuario_id   UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ultimo_visto TIMESTAMPTZ NOT NULL DEFAULT now(),
  ext_version  TEXT
);

GRANT SELECT, INSERT, UPDATE ON public.presenca_extensao TO authenticated;
GRANT ALL ON public.presenca_extensao TO service_role;

ALTER TABLE public.presenca_extensao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own ext presence" ON public.presenca_extensao;
CREATE POLICY "Users manage own ext presence" ON public.presenca_extensao
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

DROP POLICY IF EXISTS "Admins read all ext presence" ON public.presenca_extensao;
CREATE POLICY "Admins read all ext presence" ON public.presenca_extensao
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Ensure admins can read all presenca_desktop rows
DROP POLICY IF EXISTS "Admins read all desktop presence" ON public.presenca_desktop;
CREATE POLICY "Admins read all desktop presence" ON public.presenca_desktop
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Realtime publication: add missing tables (idempotent)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['presenca_extensao','presenca_web','navegacao_paginas'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;