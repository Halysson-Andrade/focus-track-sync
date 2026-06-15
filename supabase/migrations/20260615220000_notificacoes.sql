-- Mensageria por notificação: o admin envia uma mensagem a um colaborador pelo
-- painel operacional e ela sobe como notificação nativa do Chrome (extensão) e
-- como toast no app web. Mão única (sem resposta) nesta primeira versão.
--
-- A extensão (processo separado, sem acesso ao app web) faz polling REST desta
-- tabela com o token do próprio usuário. Por isso `remetente_nome` é
-- denormalizado: a extensão exibe "Mensagem de <nome>" sem precisar de JOIN com
-- profiles (cujo FK seria via auth.users, não embutível no PostgREST).
--
-- Estados: criado_em (envio) -> entregue_em (extensão exibiu) -> lido_em (visto).

CREATE TABLE IF NOT EXISTS public.notificacoes (
  id              UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  remetente_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  remetente_nome  TEXT NOT NULL,
  destinatario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conteudo        TEXT NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  entregue_em     TIMESTAMPTZ,
  lido_em         TIMESTAMPTZ
);

-- Histórico por destinatário (Sheet do painel) ordenado por data.
CREATE INDEX IF NOT EXISTS notificacoes_destinatario_idx
  ON public.notificacoes (destinatario_id, criado_em DESC);

-- Poll da extensão: só as pendentes de entrega de um destinatário.
CREATE INDEX IF NOT EXISTS notificacoes_pendentes_idx
  ON public.notificacoes (destinatario_id)
  WHERE entregue_em IS NULL;

GRANT SELECT, UPDATE ON public.notificacoes TO authenticated;
GRANT ALL ON public.notificacoes TO service_role;

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

-- SELECT: destinatário (poll/toast), remetente e admin (histórico) leem.
DROP POLICY IF EXISTS "notificacoes_select" ON public.notificacoes;
CREATE POLICY "notificacoes_select" ON public.notificacoes
  FOR SELECT TO authenticated
  USING (
    auth.uid() = destinatario_id
    OR auth.uid() = remetente_id
    OR public.has_role(auth.uid(), 'admin')
  );

-- UPDATE: o destinatário marca entregue_em/lido_em na própria notificação.
-- (admin também pode, para correções.)
DROP POLICY IF EXISTS "notificacoes_update_destinatario" ON public.notificacoes;
CREATE POLICY "notificacoes_update_destinatario" ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (auth.uid() = destinatario_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = destinatario_id OR public.has_role(auth.uid(), 'admin'));

-- INSERT direto: apenas admin (e ainda assim o caminho normal é a RPC, que
-- garante remetente_id = auth.uid() e preenche remetente_nome). Sem política de
-- INSERT para usuário comum: enviar é privilégio de admin.
DROP POLICY IF EXISTS "notificacoes_insert_admin" ON public.notificacoes;
CREATE POLICY "notificacoes_insert_admin" ON public.notificacoes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND auth.uid() = remetente_id);

-- RPC: única via recomendada de envio. SECURITY DEFINER espelha abrir_registro:
-- valida admin, resolve o nome do remetente e insere com remetente_id = auth.uid().
CREATE OR REPLACE FUNCTION public.enviar_notificacao(
  p_destinatario uuid,
  p_conteudo text
)
RETURNS public.notificacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nome text;
  v_new public.notificacoes;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'only admins can send notifications';
  END IF;
  IF p_conteudo IS NULL OR length(btrim(p_conteudo)) = 0 THEN
    RAISE EXCEPTION 'empty content';
  END IF;
  IF p_destinatario IS NULL THEN
    RAISE EXCEPTION 'missing recipient';
  END IF;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.notificacoes (remetente_id, remetente_nome, destinatario_id, conteudo)
    VALUES (v_uid, COALESCE(v_nome, 'Gestor'), p_destinatario, btrim(p_conteudo))
    RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enviar_notificacao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enviar_notificacao(uuid, text) TO authenticated;

-- Realtime: histórico no Sheet (status ao vivo) e toast do destinatário.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notificacoes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes';
  END IF;
END $$;
