-- Presença da extensão do Chrome mediada por banco.
--
-- Hoje a extensão só sinaliza "viva" via postMessage in-browser (content.js ->
-- página), que o app desktop (processo separado) não enxerga. Para o desktop
-- poder exigir a extensão ativa antes de iniciar o expediente, a extensão passa
-- a gravar um heartbeat "vivo" aqui (~1 min enquanto logada, mesmo ociosa) e o
-- desktop lê esta tabela. Espelha o conceito de `presenca_desktop`.
--
-- `ext_version` permite acompanhar a adoção da nova versão da extensão na frota.

CREATE TABLE IF NOT EXISTS public.presenca_extensao (
  usuario_id   UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ultimo_visto TIMESTAMPTZ NOT NULL DEFAULT now(),
  ext_version  TEXT
);

GRANT SELECT, INSERT, UPDATE ON public.presenca_extensao TO authenticated;
GRANT ALL ON public.presenca_extensao TO service_role;

ALTER TABLE public.presenca_extensao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ext presence" ON public.presenca_extensao
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Admins read all ext presence" ON public.presenca_extensao
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Realtime: o painel do escritório virtual (useOfficeData) assina mudanças
-- desta tabela para atualizar o selo de "monitoração ativa" da extensão. Paridade
-- com presenca_desktop, que já está na publicação (20260612130000_realtime_office).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'presenca_extensao'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.presenca_extensao';
  END IF;
END $$;
