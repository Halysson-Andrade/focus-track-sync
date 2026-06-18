-- Escritório virtual com visibilidade por nível (user / admin / superadmin).
--
-- Até aqui /operacional era admin-only e dependia do RLS "admin lê tudo". Agora o
-- escritório é aberto a TODOS os perfis, mas o que cada um ENXERGA é recortado:
--   • base (mapa, posição, status, online, cards do topo) → TODOS, via office_overview;
--   • detalhe (monitor de acesso + barra lateral: navegação/apps/ócio) → só os
--     usuários que o chamador pode inspecionar, via office_detail:
--       - superadmin → todos;
--       - admin      → mesma área (profiles.departamento), reusando same_area;
--       - user       → ninguém (listas vazias).
--
-- O recorte por área é feito AQUI (SECURITY DEFINER). Dados sensíveis de outras
-- áreas nunca chegam ao navegador do admin. NÃO mexemos no RLS global das tabelas
-- (Relatórios/Dashboard Geral seguem com "admin lê tudo").
--
-- Espelha os padrões existentes (has_role/is_active/is_superadmin/same_area).

-- ===========================================================================
-- 1) BASE SEGURA — office_overview: dados não-sensíveis de TODOS os perfis.
--    Sem email, sem navegação. Alimenta o mapa + cards do escritório.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.office_overview(p_since timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN jsonb_build_object(
    'profiles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'cargo', p.cargo, 'departamento', p.departamento))
        FROM public.profiles p
       WHERE p.ativo = true), '[]'::jsonb),
    'registros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'usuario_id', r.usuario_id, 'status', r.status,
               'inicio', r.inicio, 'fim', r.fim, 'duracao_minutos', r.duracao_minutos))
        FROM public.registros_atividade r
       WHERE r.inicio >= p_since), '[]'::jsonb),
    'presenca', COALESCE((
      SELECT jsonb_agg(j) FROM (
        SELECT jsonb_build_object('usuario_id', pd.usuario_id, 'ultimo_ativo', pd.ultimo_ativo,
                                  'fonte', 'desktop') AS j
          FROM public.presenca_desktop pd
        UNION ALL
        SELECT jsonb_build_object('usuario_id', pw.usuario_id, 'ultimo_ativo', pw.ultimo_ativo,
                                  'fonte', 'web')
          FROM public.presenca_web pw
      ) u), '[]'::jsonb),
    'admin_ids', COALESCE((
      SELECT jsonb_agg(ur.user_id)
        FROM public.user_roles ur
       WHERE ur.role = 'admin'), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.office_overview(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_overview(timestamptz) TO authenticated;

-- ===========================================================================
-- 2) DETALHE POR ÁREA — office_detail: navegação/apps/ócio só dos inspecionáveis.
--    superadmin → todos; admin → same_area; user → vazio.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.office_detail(p_since timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_super boolean;
  v_admin boolean;
  v_ids   uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_super := public.is_superadmin(v_uid);
  v_admin := public.has_role(v_uid, 'admin');

  -- Sem privilégio de detalhe (user comum): tudo vazio.
  IF NOT v_super AND NOT v_admin THEN
    RETURN jsonb_build_object(
      'inspectable_ids', '[]'::jsonb,
      'nav_app', '[]'::jsonb, 'nav_ext', '[]'::jsonb, 'nav_desk', '[]'::jsonb,
      'presenca_ext', '[]'::jsonb, 'eventos', '[]'::jsonb);
  END IF;

  -- Conjunto inspecionável.
  IF v_super THEN
    SELECT array_agg(p.id) INTO v_ids
      FROM public.profiles p WHERE p.ativo = true;
  ELSE
    SELECT array_agg(p.id) INTO v_ids
      FROM public.profiles p
     WHERE p.ativo = true AND public.same_area(v_uid, p.id);
  END IF;
  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);

  RETURN jsonb_build_object(
    'inspectable_ids', to_jsonb(v_ids),
    'nav_app', COALESCE((SELECT jsonb_agg(t) FROM (
        SELECT n.usuario_id, n.inicio, n.fim, n.duracao_segundos, n.inativo_segundos, n.path, n.title
          FROM public.navegacao_paginas n
         WHERE n.usuario_id = ANY(v_ids) AND n.inicio >= p_since
         ORDER BY n.inicio DESC LIMIT 2000) t), '[]'::jsonb),
    'nav_ext', COALESCE((SELECT jsonb_agg(t) FROM (
        SELECT n.usuario_id, n.inicio, n.fim, n.duracao_segundos, n.inativo_segundos, n.url, n.title, n.domain
          FROM public.navegacao_externa n
         WHERE n.usuario_id = ANY(v_ids) AND n.inicio >= p_since
         ORDER BY n.inicio DESC LIMIT 2000) t), '[]'::jsonb),
    'nav_desk', COALESCE((SELECT jsonb_agg(t) FROM (
        SELECT n.usuario_id, n.inicio, n.fim, n.duracao_segundos, n.inativo_segundos, n.process_name, n.app_label
          FROM public.uso_aplicativos n
         WHERE n.usuario_id = ANY(v_ids) AND n.inicio >= p_since
         ORDER BY n.inicio DESC LIMIT 2000) t), '[]'::jsonb),
    'presenca_ext', COALESCE((SELECT jsonb_agg(t) FROM (
        SELECT pe.usuario_id, pe.ultimo_visto, pe.ext_version
          FROM public.presenca_extensao pe
         WHERE pe.usuario_id = ANY(v_ids)) t), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(t) FROM (
        SELECT e.usuario_id, e.inicio, e.fim
          FROM public.eventos_ociosidade e
         WHERE e.usuario_id = ANY(v_ids) AND e.inicio >= p_since
         ORDER BY e.inicio DESC LIMIT 2000) t), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.office_detail(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_detail(timestamptz) TO authenticated;

-- ===========================================================================
-- 3) Mensagem peer-to-peer: qualquer usuário ATIVO pode enviar (antes só admin).
--    Mantém remetente_id = auth.uid() e remetente_nome de profiles. Como é
--    SECURITY DEFINER, o INSERT contorna a policy de INSERT admin-only existente.
-- ===========================================================================
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
  IF NOT public.is_active(v_uid) THEN
    RAISE EXCEPTION 'user not active';
  END IF;
  IF p_conteudo IS NULL OR length(btrim(p_conteudo)) = 0 THEN
    RAISE EXCEPTION 'empty content';
  END IF;
  IF p_destinatario IS NULL THEN
    RAISE EXCEPTION 'missing recipient';
  END IF;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.notificacoes (remetente_id, remetente_nome, destinatario_id, conteudo)
    VALUES (v_uid, COALESCE(v_nome, 'Colega'), p_destinatario, btrim(p_conteudo))
    RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enviar_notificacao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enviar_notificacao(uuid, text) TO authenticated;
