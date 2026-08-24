-- Justificativa de ociosidade — camada de OVERLAY sobre o ócio derivado.

-- ===========================================================================
-- 1) Tabela
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.justificativas_ociosidade (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usuario_nome          text NOT NULL,
  departamento          text,
  dia                   date NOT NULL,
  inicio                timestamptz NOT NULL,
  fim                   timestamptz NOT NULL,
  justificativa         text NOT NULL,
  status                public.ajuste_status NOT NULL DEFAULT 'pendente',
  decidido_por          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_por_nome     text,
  justificativa_decisao text,
  decidido_em           timestamptz,
  criado_por            uuid NOT NULL,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT justificativas_ociosidade_periodo_chk CHECK (fim > inicio)
);

CREATE INDEX IF NOT EXISTS justificativas_ociosidade_usuario_dia_idx
  ON public.justificativas_ociosidade (usuario_id, dia);
CREATE INDEX IF NOT EXISTS justificativas_ociosidade_dia_idx
  ON public.justificativas_ociosidade (dia);
CREATE INDEX IF NOT EXISTS justificativas_ociosidade_pendentes_idx
  ON public.justificativas_ociosidade (status)
  WHERE status = 'pendente';

GRANT SELECT ON public.justificativas_ociosidade TO authenticated;
GRANT ALL ON public.justificativas_ociosidade TO service_role;

ALTER TABLE public.justificativas_ociosidade ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "justificativas_ociosidade_select" ON public.justificativas_ociosidade;
CREATE POLICY "justificativas_ociosidade_select" ON public.justificativas_ociosidade
  FOR SELECT TO authenticated
  USING (
    auth.uid() = usuario_id
    OR public.is_superadmin(auth.uid())
    OR (public.has_role(auth.uid(), 'admin') AND public.same_area(auth.uid(), usuario_id))
  );

-- Realtime: fila de aprovação + toast de decisão dependem disso.
ALTER TABLE public.justificativas_ociosidade REPLICA IDENTITY FULL;
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'justificativas_ociosidade'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.justificativas_ociosidade';
  END IF;
END
$do$;

-- ===========================================================================
-- 2) Registro (gestão aplica direto / colaborador solicita)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.registrar_justificativa_ociosidade(
  p_usuario       uuid,
  p_dia           date,
  p_inicio        timestamptz,
  p_fim           timestamptz,
  p_justificativa text
)
RETURNS public.justificativas_ociosidade
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_alvo       uuid := COALESCE(p_usuario, auth.uid());
  v_nome       text;
  v_dept       text;
  v_gestor     text;
  v_admin_alvo boolean;
  v_auto       boolean;
  v_new        public.justificativas_ociosidade;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_dia IS NULL OR p_inicio IS NULL OR p_fim IS NULL THEN
    RAISE EXCEPTION 'missing parameters';
  END IF;
  IF p_fim <= p_inicio THEN
    RAISE EXCEPTION 'fim must be after inicio';
  END IF;
  IF p_justificativa IS NULL OR length(btrim(p_justificativa)) = 0 THEN
    RAISE EXCEPTION 'empty justification';
  END IF;

  -- Autoridade do solicitante SOBRE O ALVO (mesma hierarquia da decisão).
  v_admin_alvo := public.is_superadmin(v_uid)
    OR (public.has_role(v_uid, 'admin') AND public.same_area(v_uid, v_alvo));

  IF v_alvo <> v_uid AND NOT v_admin_alvo THEN
    RAISE EXCEPTION 'not allowed to justify this user';
  END IF;

  v_auto := (public.is_superadmin(v_uid) OR public.has_role(v_uid, 'admin'))
    AND (v_alvo = v_uid OR v_admin_alvo);

  SELECT nome, departamento INTO v_nome, v_dept FROM public.profiles WHERE id = v_alvo;
  SELECT nome INTO v_gestor FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.justificativas_ociosidade
    (usuario_id, usuario_nome, departamento, dia, inicio, fim, justificativa, status,
     decidido_por, decidido_por_nome, justificativa_decisao, decidido_em, criado_por)
  VALUES
    (v_alvo, COALESCE(v_nome, 'Colaborador'), v_dept, p_dia, p_inicio, p_fim,
     btrim(p_justificativa),
     CASE WHEN v_auto THEN 'aprovada'::public.ajuste_status
                      ELSE 'pendente'::public.ajuste_status END,
     CASE WHEN v_auto THEN v_uid ELSE NULL END,
     CASE WHEN v_auto THEN COALESCE(v_gestor, 'Gestor') ELSE NULL END,
     CASE WHEN v_auto THEN 'Justificativa aplicada pela gestão' ELSE NULL END,
     CASE WHEN v_auto THEN now() ELSE NULL END,
     v_uid)
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_justificativa_ociosidade(uuid, date, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_justificativa_ociosidade(uuid, date, timestamptz, timestamptz, text) TO authenticated;

-- ===========================================================================
-- 3) Decisão (aprovar / rejeitar / revogar) — permite re-decidir, por design.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.decidir_justificativa_ociosidade(
  p_id            uuid,
  p_aprovar       boolean,
  p_justificativa text
)
RETURNS public.justificativas_ociosidade
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_row  public.justificativas_ociosidade;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_justificativa IS NULL OR length(btrim(p_justificativa)) = 0 THEN
    RAISE EXCEPTION 'empty decision justification';
  END IF;

  SELECT * INTO v_row FROM public.justificativas_ociosidade WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'justificativa not found';
  END IF;

  -- Hierarquia: superadmin decide qualquer; admin só a própria área.
  IF NOT (
    public.is_superadmin(v_uid)
    OR (public.has_role(v_uid, 'admin') AND public.same_area(v_uid, v_row.usuario_id))
  ) THEN
    RAISE EXCEPTION 'not allowed to decide this justificativa';
  END IF;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_uid;

  UPDATE public.justificativas_ociosidade
     SET status = CASE WHEN p_aprovar
                       THEN 'aprovada'::public.ajuste_status
                       ELSE 'rejeitada'::public.ajuste_status END,
         decidido_por          = v_uid,
         decidido_por_nome     = COALESCE(v_nome, 'Gestor'),
         justificativa_decisao = btrim(p_justificativa),
         decidido_em           = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decidir_justificativa_ociosidade(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_justificativa_ociosidade(uuid, boolean, text) TO authenticated;

-- ===========================================================================
-- 4) espelho_ponto: entrega as justificativas do alvo no período.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.espelho_ponto(p_usuario uuid, p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ini timestamptz;
  v_fim timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (
    public.is_superadmin(v_uid)
    OR public.can_espelho_geral(v_uid)
    OR v_uid = p_usuario
    OR (public.has_role(v_uid, 'admin') AND public.same_area(v_uid, p_usuario))
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  IF p_usuario IS NULL OR p_de IS NULL OR p_ate IS NULL THEN
    RAISE EXCEPTION 'missing parameters';
  END IF;
  IF p_ate < p_de THEN
    RAISE EXCEPTION 'p_ate must be >= p_de';
  END IF;

  v_ini := p_de::timestamptz;
  v_fim := (p_ate + INTERVAL '1 day')::timestamptz;

  RETURN jsonb_build_object(
    'perfil', (
      SELECT jsonb_build_object(
        'id', p.id, 'nome', p.nome, 'email', p.email,
        'cargo', p.cargo, 'departamento', p.departamento, 'ativo', p.ativo)
      FROM public.profiles p WHERE p.id = p_usuario
    ),
    'registros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'status', r.status,
        'inicio', r.inicio, 'fim', r.fim,
        'duracao_minutos', r.duracao_minutos,
        'observacao', r.observacao
      ) ORDER BY r.inicio)
      FROM public.registros_atividade r
      WHERE r.usuario_id = p_usuario
        AND r.inicio >= v_ini AND r.inicio < v_fim
    ), '[]'::jsonb),
    'ajustes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'dia', a.dia, 'tipo', a.tipo, 'status', a.status,
        'inicio', a.inicio, 'fim', a.fim, 'status_alvo', a.status_alvo,
        'justificativa', a.justificativa,
        'decidido_por_nome', a.decidido_por_nome,
        'justificativa_decisao', a.justificativa_decisao,
        'decidido_em', a.decidido_em
      ) ORDER BY a.dia)
      FROM public.ajustes_jornada a
      WHERE a.usuario_id = p_usuario
        AND a.dia >= p_de AND a.dia <= p_ate
    ), '[]'::jsonb),
    'eventos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'inicio', e.inicio, 'fim', e.fim
      ) ORDER BY e.inicio)
      FROM public.eventos_ociosidade e
      WHERE e.usuario_id = p_usuario
        AND e.inicio >= v_ini AND e.inicio < v_fim
    ), '[]'::jsonb),
    'justificativas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', j.id, 'usuario_id', j.usuario_id, 'usuario_nome', j.usuario_nome,
        'departamento', j.departamento, 'dia', j.dia,
        'inicio', j.inicio, 'fim', j.fim,
        'justificativa', j.justificativa, 'status', j.status,
        'decidido_por_nome', j.decidido_por_nome,
        'justificativa_decisao', j.justificativa_decisao,
        'decidido_em', j.decidido_em, 'criado_em', j.criado_em
      ) ORDER BY j.dia, j.inicio)
      FROM public.justificativas_ociosidade j
      WHERE j.usuario_id = p_usuario
        AND j.dia >= p_de AND j.dia <= p_ate
    ), '[]'::jsonb),
    'apps', COALESCE((
      SELECT jsonb_agg(t) FROM (
        SELECT u.process_name,
               MAX(u.app_label) AS app_label,
               SUM(u.segundos_totais)::bigint AS segundos_totais,
               SUM(u.segundos_inativos)::bigint AS segundos_inativos,
               SUM(u.sessoes)::bigint AS sessoes
        FROM public.uso_app_diario u
        WHERE u.usuario_id = p_usuario
          AND u.dia >= p_de AND u.dia <= p_ate
        GROUP BY u.process_name
      ) t
    ), '[]'::jsonb),
    'sites', COALESCE((
      SELECT jsonb_agg(t) FROM (
        SELECT n.domain,
               SUM(n.segundos_totais)::bigint AS segundos_totais,
               SUM(n.segundos_inativos)::bigint AS segundos_inativos,
               SUM(n.visitas)::bigint AS visitas
        FROM public.navegacao_diaria n
        WHERE n.usuario_id = p_usuario
          AND n.dia >= p_de AND n.dia <= p_ate
        GROUP BY n.domain
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.espelho_ponto(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.espelho_ponto(uuid, date, date) TO authenticated;

-- ===========================================================================
-- 5) relatorio_inatividade: entrega as justificativas da equipe visível.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.relatorio_inatividade(p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ini timestamptz;
  v_fim timestamptz;
  v_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_de IS NULL OR p_ate IS NULL THEN
    RAISE EXCEPTION 'missing parameters';
  END IF;
  IF p_ate < p_de THEN
    RAISE EXCEPTION 'p_ate must be >= p_de';
  END IF;

  IF public.is_superadmin(v_uid) OR public.can_espelho_geral(v_uid) THEN
    SELECT array_agg(p.id) INTO v_ids
      FROM public.profiles p WHERE p.ativo = true;
  ELSIF public.has_role(v_uid, 'admin') THEN
    SELECT array_agg(p.id) INTO v_ids
      FROM public.profiles p
     WHERE p.ativo = true AND public.same_area(v_uid, p.id);
  ELSE
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);

  v_ini := p_de::timestamptz;
  v_fim := (p_ate + INTERVAL '1 day')::timestamptz;

  RETURN jsonb_build_object(
    'profiles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'departamento', p.departamento))
        FROM public.profiles p
       WHERE p.id = ANY(v_ids)), '[]'::jsonb),
    'registros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'usuario_id', r.usuario_id, 'inicio', r.inicio, 'fim', r.fim,
               'duracao_minutos', r.duracao_minutos) ORDER BY r.inicio)
        FROM public.registros_atividade r
       WHERE r.usuario_id = ANY(v_ids)
         AND r.status = 'ATIVO'
         AND r.inicio >= v_ini AND r.inicio < v_fim), '[]'::jsonb),
    'eventos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'usuario_id', e.usuario_id, 'inicio', e.inicio, 'fim', e.fim) ORDER BY e.inicio)
        FROM public.eventos_ociosidade e
       WHERE e.usuario_id = ANY(v_ids)
         AND e.inicio >= v_ini AND e.inicio < v_fim), '[]'::jsonb),
    'justificativas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', j.id, 'usuario_id', j.usuario_id, 'usuario_nome', j.usuario_nome,
               'departamento', j.departamento, 'dia', j.dia,
               'inicio', j.inicio, 'fim', j.fim,
               'justificativa', j.justificativa, 'status', j.status,
               'decidido_por_nome', j.decidido_por_nome,
               'justificativa_decisao', j.justificativa_decisao,
               'decidido_em', j.decidido_em, 'criado_em', j.criado_em) ORDER BY j.dia, j.inicio)
        FROM public.justificativas_ociosidade j
       WHERE j.usuario_id = ANY(v_ids)
         AND j.dia >= p_de AND j.dia <= p_ate), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.relatorio_inatividade(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_inatividade(date, date) TO authenticated;