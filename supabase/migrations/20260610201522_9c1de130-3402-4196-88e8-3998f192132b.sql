
CREATE TABLE public.navegacao_paginas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  registro_id uuid REFERENCES public.registros_atividade(id) ON DELETE SET NULL,
  path text NOT NULL,
  title text,
  inicio timestamptz NOT NULL DEFAULT now(),
  fim timestamptz,
  duracao_segundos numeric,
  inativo_segundos numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_navegacao_user_inicio ON public.navegacao_paginas(usuario_id, inicio DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.navegacao_paginas TO authenticated;
GRANT ALL ON public.navegacao_paginas TO service_role;

ALTER TABLE public.navegacao_paginas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own navegacao"
  ON public.navegacao_paginas FOR ALL
  TO authenticated
  USING ((auth.uid() = usuario_id) OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((auth.uid() = usuario_id) OR has_role(auth.uid(), 'admin'::app_role));
