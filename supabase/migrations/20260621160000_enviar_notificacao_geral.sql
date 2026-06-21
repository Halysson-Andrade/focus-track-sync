-- Broadcast de notificação para TODOS os usuários ativos (aviso geral).
--
-- Hoje só existe enviar_notificacao(destinatario, conteudo) — 1 por pessoa.
-- Para avisos gerais (ex.: "atualize a extensão e o app desktop") isso é inviável
-- manualmente. Esta RPC insere uma notificação para cada usuário ATIVO, de uma vez.
--
-- Espelha enviar_notificacao: SECURITY DEFINER, admin-only, remetente_id = auth.uid(),
-- remetente_nome denormalizado. Cada linha é entregue pelos mesmos canais já
-- existentes: toast no app web (realtime) + notificação nativa do Chrome (a
-- extensão faz polling de notificacoes pendentes do próprio usuário).

CREATE OR REPLACE FUNCTION public.enviar_notificacao_geral(
  p_conteudo text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_qtd  integer;
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

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.notificacoes (remetente_id, remetente_nome, destinatario_id, conteudo)
  SELECT v_uid, COALESCE(v_nome, 'Gestor'), p.id, btrim(p_conteudo)
    FROM public.profiles p
   WHERE COALESCE(p.ativo, true) = true;

  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd; -- nº de usuários notificados
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enviar_notificacao_geral(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enviar_notificacao_geral(text) TO authenticated;
