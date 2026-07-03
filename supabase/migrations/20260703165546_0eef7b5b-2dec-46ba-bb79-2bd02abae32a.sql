CREATE OR REPLACE FUNCTION public.registrar_ajuste_jornada(
  p_usuario       uuid,
  p_dia           date,
  p_tipo          public.ajuste_tipo,
  p_justificativa text,
  p_inicio        timestamptz DEFAULT NULL,
  p_fim           timestamptz DEFAULT NULL,
  p_status_alvo   public.activity_status DEFAULT NULL
)
RETURNS public.ajustes_jornada
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
  v_new        public.ajustes_jornada;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_dia IS NULL THEN
    RAISE EXCEPTION 'missing dia';
  END IF;
  IF p_justificativa IS NULL OR length(btrim(p_justificativa)) = 0 THEN
    RAISE EXCEPTION 'empty justification';
  END IF;
  IF p_tipo = 'ajuste_periodo' THEN
    IF p_status_alvo IS NULL THEN
      RAISE EXCEPTION 'ajuste_periodo requires status_alvo';
    END IF;
    IF p_inicio IS NULL OR p_fim IS NULL THEN
      RAISE EXCEPTION 'ajuste_periodo requires inicio and fim';
    END IF;
  END IF;
  IF p_inicio IS NOT NULL AND p_fim IS NOT NULL AND p_fim <= p_inicio THEN
    RAISE EXCEPTION 'fim must be after inicio';
  END IF;

  v_admin_alvo := public.is_superadmin(v_uid)
    OR (public.has_role(v_uid, 'admin') AND public.same_area(v_uid, v_alvo));

  IF v_alvo <> v_uid AND NOT v_admin_alvo THEN
    RAISE EXCEPTION 'not allowed to adjust this user';
  END IF;

  v_auto := (public.is_superadmin(v_uid) OR public.has_role(v_uid, 'admin'))
    AND (v_alvo = v_uid OR v_admin_alvo);

  SELECT nome, departamento INTO v_nome, v_dept FROM public.profiles WHERE id = v_alvo;
  SELECT nome INTO v_gestor FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.ajustes_jornada
    (usuario_id, usuario_nome, departamento, dia, tipo, inicio, fim, status_alvo,
     justificativa, status, decidido_por, decidido_por_nome, justificativa_decisao,
     decidido_em)
  VALUES
    (v_alvo, COALESCE(v_nome, 'Colaborador'), v_dept, p_dia, p_tipo, p_inicio, p_fim,
     p_status_alvo, btrim(p_justificativa),
     CASE WHEN v_auto THEN 'aprovada'::public.ajuste_status
                      ELSE 'pendente'::public.ajuste_status END,
     CASE WHEN v_auto THEN v_uid ELSE NULL END,
     CASE WHEN v_auto THEN COALESCE(v_gestor, 'Gestor') ELSE NULL END,
     CASE WHEN v_auto THEN 'Ajuste aplicado pela gestão' ELSE NULL END,
     CASE WHEN v_auto THEN now() ELSE NULL END)
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_ajuste_jornada(uuid, date, public.ajuste_tipo, text, timestamptz, timestamptz, public.activity_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ajuste_jornada(uuid, date, public.ajuste_tipo, text, timestamptz, timestamptz, public.activity_status) TO authenticated;