
CREATE OR REPLACE FUNCTION public.enviar_notificacao_geral(p_conteudo text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_nome text;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.is_superadmin(v_uid)) THEN
    RAISE EXCEPTION 'only admin or superadmin can broadcast';
  END IF;
  IF p_conteudo IS NULL OR length(btrim(p_conteudo)) = 0 THEN
    RAISE EXCEPTION 'empty content';
  END IF;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

  WITH inseridas AS (
    INSERT INTO public.notificacoes (remetente_id, remetente_nome, destinatario_id, conteudo)
    SELECT v_uid, COALESCE(v_nome, 'Administração'), p.id, btrim(p_conteudo)
      FROM public.profiles p
     WHERE p.ativo = true
       AND p.id <> v_uid
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inseridas;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.enviar_notificacao_geral(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_notificacao_geral(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_notificacao_geral(text) TO authenticated;
