-- Tolerância na Jornada Padrão.
--
-- Margem (em minutos) aplicada por dia no cálculo do espelho de ponto: quando o
-- saldo do dia (realizado − previsto) fica dentro de ±tolerancia, ele é tratado
-- como zero (tudo-ou-nada, simétrico) — não vira pendente nem hora extra. Acima
-- da tolerância, o saldo conta integralmente. Default 15 min.

ALTER TABLE public.jornada_padrao
  ADD COLUMN IF NOT EXISTS tolerancia_min integer NOT NULL DEFAULT 15;
