-- Módulo de Horário Padrão (jornada esperada) + feriados.
--
-- Define MODELOS de jornada (entrada / início e fim de almoço / saída + tipo de
-- cada dia da semana) que o espelho de ponto usa para calcular previsto vs.
-- realizado: horas pendentes, horas extras (HE), faltas e adicional noturno.
-- Cada colaborador é vinculado a um modelo (jornada_usuario); quem não tem
-- vínculo cai no modelo marcado `padrao_sistema`.
--
-- Tipos de dia: trabalho (jornada esperada), compensado (ex.: sábado já coberto
-- pela jornada estendida seg–sex), dsr (descanso semanal remunerado, ex.: domingo)
-- e folga. Em compensado/dsr/folga/feriado o previsto é 0 e o que for trabalhado
-- vira HE (sem percentuais por ora).
--
-- Espelha o padrão de categoria_catalogo (RLS: leitura p/ authenticated; escrita
-- só superadmin) e os enums de ajustes_jornada.

-- ===========================================================================
-- 1) Enum do tipo de dia
-- ===========================================================================
DO $$ BEGIN
  CREATE TYPE public.dia_tipo AS ENUM ('trabalho', 'compensado', 'dsr', 'folga');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 2) Modelos de jornada
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.jornada_padrao (
  id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome               text NOT NULL,
  hora_entrada       time NOT NULL,
  hora_almoco_inicio time,
  hora_almoco_fim    time,
  hora_saida         time NOT NULL,
  -- Tipo de cada dia da semana (default: seg–sex trabalho, sáb compensado, dom DSR).
  dia_dom            public.dia_tipo NOT NULL DEFAULT 'dsr',
  dia_seg            public.dia_tipo NOT NULL DEFAULT 'trabalho',
  dia_ter            public.dia_tipo NOT NULL DEFAULT 'trabalho',
  dia_qua            public.dia_tipo NOT NULL DEFAULT 'trabalho',
  dia_qui            public.dia_tipo NOT NULL DEFAULT 'trabalho',
  dia_sex            public.dia_tipo NOT NULL DEFAULT 'trabalho',
  dia_sab            public.dia_tipo NOT NULL DEFAULT 'compensado',
  padrao_sistema     boolean NOT NULL DEFAULT false,
  ativo              boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Garante NO MÁXIMO um modelo "padrão do sistema".
CREATE UNIQUE INDEX IF NOT EXISTS jornada_padrao_um_default_idx
  ON public.jornada_padrao (padrao_sistema)
  WHERE padrao_sistema;

GRANT SELECT ON public.jornada_padrao TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.jornada_padrao TO authenticated;
GRANT ALL ON public.jornada_padrao TO service_role;

ALTER TABLE public.jornada_padrao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jornada_padrao_select" ON public.jornada_padrao;
CREATE POLICY "jornada_padrao_select" ON public.jornada_padrao
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "jornada_padrao_insert" ON public.jornada_padrao;
CREATE POLICY "jornada_padrao_insert" ON public.jornada_padrao
  FOR INSERT TO authenticated WITH CHECK (public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "jornada_padrao_update" ON public.jornada_padrao;
CREATE POLICY "jornada_padrao_update" ON public.jornada_padrao
  FOR UPDATE TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "jornada_padrao_delete" ON public.jornada_padrao;
CREATE POLICY "jornada_padrao_delete" ON public.jornada_padrao
  FOR DELETE TO authenticated USING (public.is_superadmin(auth.uid()));

-- ===========================================================================
-- 3) Vínculo colaborador → modelo
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.jornada_usuario (
  usuario_id        uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  jornada_padrao_id uuid NOT NULL REFERENCES public.jornada_padrao(id) ON DELETE CASCADE,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.jornada_usuario TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.jornada_usuario TO authenticated;
GRANT ALL ON public.jornada_usuario TO service_role;

ALTER TABLE public.jornada_usuario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jornada_usuario_select" ON public.jornada_usuario;
CREATE POLICY "jornada_usuario_select" ON public.jornada_usuario
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "jornada_usuario_insert" ON public.jornada_usuario;
CREATE POLICY "jornada_usuario_insert" ON public.jornada_usuario
  FOR INSERT TO authenticated WITH CHECK (public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "jornada_usuario_update" ON public.jornada_usuario;
CREATE POLICY "jornada_usuario_update" ON public.jornada_usuario
  FOR UPDATE TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "jornada_usuario_delete" ON public.jornada_usuario;
CREATE POLICY "jornada_usuario_delete" ON public.jornada_usuario
  FOR DELETE TO authenticated USING (public.is_superadmin(auth.uid()));

-- ===========================================================================
-- 4) Feriados (globais por enquanto)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.feriados (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data       date NOT NULL UNIQUE,
  descricao  text NOT NULL DEFAULT '',
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.feriados TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.feriados TO authenticated;
GRANT ALL ON public.feriados TO service_role;

ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feriados_select" ON public.feriados;
CREATE POLICY "feriados_select" ON public.feriados
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "feriados_insert" ON public.feriados;
CREATE POLICY "feriados_insert" ON public.feriados
  FOR INSERT TO authenticated WITH CHECK (public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "feriados_update" ON public.feriados;
CREATE POLICY "feriados_update" ON public.feriados
  FOR UPDATE TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "feriados_delete" ON public.feriados;
CREATE POLICY "feriados_delete" ON public.feriados
  FOR DELETE TO authenticated USING (public.is_superadmin(auth.uid()));

-- ===========================================================================
-- 5) Seed: modelo padrão do sistema 07:30 / 12:00 / 13:30 / 17:48
-- ===========================================================================
INSERT INTO public.jornada_padrao
  (nome, hora_entrada, hora_almoco_inicio, hora_almoco_fim, hora_saida, padrao_sistema)
SELECT 'Padrão (44h)', '07:30', '12:00', '13:30', '17:48', true
WHERE NOT EXISTS (SELECT 1 FROM public.jornada_padrao WHERE padrao_sistema);

-- ===========================================================================
-- 6) Realtime (opcional, espelha o catálogo)
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'jornada_padrao'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.jornada_padrao';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'jornada_usuario'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.jornada_usuario';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'feriados'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.feriados';
  END IF;
END $$;
