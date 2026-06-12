-- Escritório Virtual (painel operacional): habilita Supabase Realtime nas
-- tabelas que alimentam o mapa em tempo real. O painel do gestor reage a
-- qualquer mudança (postgres_changes) refazendo o fetch de forma debounced.
-- Também adiciona colunas opcionais de cargo/departamento ao perfil para
-- enriquecer o hover-card do avatar (o app degrada para nome/email se ausentes).

-- 1) Colunas opcionais no perfil (idempotente).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cargo TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS departamento TEXT;

-- 2) Garante que a publicação de realtime exista.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- 3) Adiciona as tabelas à publicação (idempotente — ignora as já presentes).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'registros_atividade',
    'presenca_desktop',
    'navegacao_externa',
    'uso_aplicativos'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
