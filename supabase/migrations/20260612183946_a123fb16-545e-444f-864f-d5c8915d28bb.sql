-- ============================================================
-- MIGRATION CONSOLIDADA: aplica idempotentemente o que faltava
-- das migrations 20260611140000, 20260611190000 e 20260612130000
-- ============================================================

-- 1) PRESENÇA DESKTOP (idempotente — já existe, CREATE IF NOT EXISTS não gera erro)
CREATE TABLE IF NOT EXISTS public.presenca_desktop (
  usuario_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ultimo_ativo TIMESTAMPTZ NOT NULL DEFAULT now(),
  platform TEXT
);

GRANT SELECT, INSERT, UPDATE ON public.presenca_desktop TO authenticated;
GRANT ALL ON public.presenca_desktop TO service_role;

ALTER TABLE public.presenca_desktop ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'presenca_desktop' AND policyname = 'Users manage own presence'
  ) THEN
    CREATE POLICY "Users manage own presence" ON public.presenca_desktop
      FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'presenca_desktop' AND policyname = 'Admins read all presence'
  ) THEN
    CREATE POLICY "Admins read all presence" ON public.presenca_desktop
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- 2) IDLE WHITELIST (idempotente)
CREATE TABLE IF NOT EXISTS public.monitor_idle_whitelist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('desktop_process', 'dominio')),
  identificador TEXT NOT NULL,
  label TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo, identificador)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitor_idle_whitelist TO authenticated;
GRANT ALL ON public.monitor_idle_whitelist TO service_role;

ALTER TABLE public.monitor_idle_whitelist ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'monitor_idle_whitelist' AND policyname = 'Authenticated read idle whitelist'
  ) THEN
    CREATE POLICY "Authenticated read idle whitelist" ON public.monitor_idle_whitelist
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'monitor_idle_whitelist' AND policyname = 'Admins manage idle whitelist'
  ) THEN
    CREATE POLICY "Admins manage idle whitelist" ON public.monitor_idle_whitelist
      FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- Seed de whitelist apenas se estiver vazio
INSERT INTO public.monitor_idle_whitelist (tipo, identificador, label)
SELECT * FROM (VALUES
  ('desktop_process', 'teams.exe', 'Microsoft Teams'),
  ('desktop_process', 'ms-teams.exe', 'Microsoft Teams'),
  ('desktop_process', 'zoom.exe', 'Zoom'),
  ('desktop_process', 'webex.exe', 'Webex'),
  ('desktop_process', 'vlc.exe', 'VLC'),
  ('desktop_process', 'mpv.exe', 'mpv'),
  ('desktop_process', 'mpc-hc.exe', 'MPC-HC'),
  ('desktop_process', 'wmplayer.exe', 'Windows Media Player'),
  ('desktop_process', 'acrord32.exe', 'Adobe Reader'),
  ('desktop_process', 'acrobat.exe', 'Adobe Acrobat'),
  ('desktop_process', 'sumatrapdf.exe', 'SumatraPDF'),
  ('desktop_process', 'foxitpdfreader.exe', 'Foxit Reader'),
  ('dominio', 'meet.google.com', 'Google Meet'),
  ('dominio', 'teams.microsoft.com', 'Microsoft Teams'),
  ('dominio', 'zoom.us', 'Zoom'),
  ('dominio', 'youtube.com', 'YouTube'),
  ('dominio', 'youtu.be', 'YouTube'),
  ('dominio', 'vimeo.com', 'Vimeo'),
  ('dominio', 'twitch.tv', 'Twitch'),
  ('dominio', 'netflix.com', 'Netflix')
) AS v(tipo, identificador, label)
WHERE NOT EXISTS (SELECT 1 FROM public.monitor_idle_whitelist);

-- 3) Fecha sessões duplicadas (mantém só a mais recente por usuário)
UPDATE public.registros_atividade r
SET fim = now(),
    duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (now() - r.inicio)) / 60)
WHERE r.fim IS NULL
  AND r.id <> (
    SELECT r2.id FROM public.registros_atividade r2
    WHERE r2.usuario_id = r.usuario_id AND r2.fim IS NULL
    ORDER BY r2.inicio DESC
    LIMIT 1
  );

-- Índice único parcial para evitar múltiplas sessões abertas
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'registros_atividade_one_open_idx'
  ) THEN
    CREATE UNIQUE INDEX registros_atividade_one_open_idx
      ON public.registros_atividade (usuario_id)
      WHERE fim IS NULL;
  END IF;
END $$;

-- 4) REALTIME + COLUNAS PERFIL
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cargo TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS departamento TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['registros_atividade', 'presenca_desktop', 'navegacao_externa', 'uso_aplicativos', 'navegacao_paginas']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
