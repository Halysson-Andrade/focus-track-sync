ALTER TABLE public.jornada_padrao
  ADD COLUMN IF NOT EXISTS tolerancia_min integer NOT NULL DEFAULT 15;