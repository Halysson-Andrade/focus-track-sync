-- Novo papel 'superadmin' no enum app_role.
--
-- Precisa ficar numa migration SEPARADA da que o utiliza: o PostgreSQL não
-- permite usar um valor de enum recém-adicionado dentro da MESMA transação em
-- que ele foi criado. Como cada arquivo de migration roda em sua própria
-- transação, o valor já estará commitado quando a migration seguinte
-- (20260617090100_atividades_area_scope.sql) atribuir o papel e criar as RLS.
--
-- 'superadmin' = acesso global (vê atividades/dashboard de todas as áreas).
-- 'admin'      = vê apenas a própria área (profiles.departamento).
-- 'user'       = vê apenas a si próprio.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'superadmin';
