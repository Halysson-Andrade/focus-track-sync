-- Lista de exceções para detecção de ociosidade: apps/sites onde a ausência de
-- mouse/teclado NÃO deve contar como ocioso (reuniões, players de vídeo, leitura).
-- Lida pelas 3 camadas (desktop por process_name, extensão/web por domínio).
CREATE TABLE public.monitor_idle_whitelist (
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

-- Qualquer usuário autenticado lê (as 3 camadas precisam consultar).
CREATE POLICY "Authenticated read idle whitelist" ON public.monitor_idle_whitelist
  FOR SELECT TO authenticated
  USING (true);

-- Só admin gerencia.
CREATE POLICY "Admins manage idle whitelist" ON public.monitor_idle_whitelist
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed: defaults de apps e domínios passivos.
INSERT INTO public.monitor_idle_whitelist (tipo, identificador, label) VALUES
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
  ('dominio', 'netflix.com', 'Netflix');

-- Fecha sessões abertas duplicadas (mantém só a mais recente por usuário) para
-- permitir o índice único parcial sem violação em bases já populadas.
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

-- Garante no máximo uma sessão aberta por usuário (web + desktop auto-start não
-- podem criar duas linhas ATIVO simultâneas).
CREATE UNIQUE INDEX registros_atividade_one_open_idx
  ON public.registros_atividade (usuario_id)
  WHERE fim IS NULL;
