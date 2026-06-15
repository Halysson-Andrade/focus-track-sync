-- Heartbeat "app vivo" do desktop, separado da atividade real do usuário.
--
-- `ultimo_ativo` (já existente) é gravado SÓ quando há input real e é lido pela
-- detecção de INATIVO da web (use-current-session) — não pode pulsar com o
-- usuário ausente. Para o gate "exigir o desktop antes de iniciar" precisamos de
-- um sinal de "app logado/vivo" que pulsa mesmo ocioso. Esse sinal vai em
-- `ultimo_visto` (coluna separada), nunca em `ultimo_ativo`.
--
-- `app_version` permite acompanhar a adoção da nova versão na frota (rollout
-- escalonado do gate da web). Ambas as colunas são nullable/aditivas: o desktop
-- antigo (1.0.7) faz upsert só de {usuario_id, ultimo_ativo, platform} e não
-- toca estas colunas, então continua funcionando inalterado.

ALTER TABLE public.presenca_desktop
  ADD COLUMN IF NOT EXISTS ultimo_visto TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS app_version  TEXT;
