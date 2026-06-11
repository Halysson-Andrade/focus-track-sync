-- Presença do app desktop: heartbeat leve para o painel saber que o usuário
-- está ativo em um aplicativo nativo (ex.: VSCode) mesmo sem tocar no navegador.
-- Espelha o conceito de heartbeat da extensão, porém mediado por banco (o app
-- desktop é um processo separado e não consegue postMessage na aba).

CREATE TABLE public.presenca_desktop (
  usuario_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ultimo_ativo TIMESTAMPTZ NOT NULL DEFAULT now(),
  platform TEXT
);

GRANT SELECT, INSERT, UPDATE ON public.presenca_desktop TO authenticated;
GRANT ALL ON public.presenca_desktop TO service_role;

ALTER TABLE public.presenca_desktop ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own presence" ON public.presenca_desktop
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Admins read all presence" ON public.presenca_desktop
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
