-- ===========================================================================
-- office_overview: dados não-sensíveis de TODOS os perfis ativos.
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
-- office_detail: navegação/apps/ócio dos inspecionáveis.
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

  IF NOT v_super AND NOT v_admin THEN
    RETURN jsonb_build_object(
      'inspectable_ids', '[]'::jsonb,
      'nav_app', '[]'::jsonb, 'nav_ext', '[]'::jsonb, 'nav_desk', '[]'::jsonb,
      'presenca_ext', '[]'::jsonb, 'eventos', '[]'::jsonb);
  END IF;

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
-- enviar_notificacao: liberada para qualquer usuário ativo.
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

-- ===========================================================================
-- admin_acoes_log: tabela de auditoria.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.admin_acoes_log (
  id        uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ator_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ator_nome text,
  alvo_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acao      text NOT NULL,
  motivo    text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_acoes_log_alvo_idx
  ON public.admin_acoes_log (alvo_id, criado_em DESC);

GRANT SELECT ON public.admin_acoes_log TO authenticated;
GRANT ALL ON public.admin_acoes_log TO service_role;

ALTER TABLE public.admin_acoes_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_acoes_log_select" ON public.admin_acoes_log;
CREATE POLICY "admin_acoes_log_select" ON public.admin_acoes_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ===========================================================================
-- encerrar_expediente_admin: superadmin encerra expediente alheio + log.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.encerrar_expediente_admin(
  p_usuario uuid,
  p_motivo  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_now   timestamptz := now();
  v_nome  text;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_superadmin(v_uid) THEN
    RAISE EXCEPTION 'only superadmin';
  END IF;
  IF p_usuario IS NULL THEN
    RAISE EXCEPTION 'missing target';
  END IF;

  UPDATE public.registros_atividade
     SET fim = v_now,
         duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - inicio)) / 60),
         observacao = 'Encerrado pelo superadmin'
   WHERE usuario_id = p_usuario AND fim IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.navegacao_paginas
     SET fim = v_now,
         duracao_segundos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - inicio)))
   WHERE usuario_id = p_usuario AND fim IS NULL;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.admin_acoes_log (ator_id, ator_nome, alvo_id, acao, motivo)
    VALUES (v_uid, COALESCE(v_nome, 'superadmin'), p_usuario, 'encerrar_expediente', p_motivo);

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.encerrar_expediente_admin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_expediente_admin(uuid, text) TO authenticated;