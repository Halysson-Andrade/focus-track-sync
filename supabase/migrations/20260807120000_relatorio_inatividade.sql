-- Relatório de inatividade (ranking de ociosidade por colaborador/setor num período).
--
-- Entrega, num único acesso AUTORIZADO e por intervalo, os dados CRUS que o front
-- precisa para montar o ranking de ócio da equipe:
--   - profiles (nome, departamento) do conjunto inspecionável
--   - registros_atividade ATIVO (janelas de trabalho — base da interseção do ócio
--       e do tempo ativo)
--   - eventos_ociosidade (intervalos discretos de ócio — o front NÃO lê esta tabela
--       direto: o RLS é "Users manage own", então a leitura de terceiros só é
--       possível aqui, via SECURITY DEFINER)
--
-- O ócio reconciliado (união dos eventos ∩ união das janelas ATIVO) é calculado no
-- CLIENTE, reusando src/lib/ocio.ts (fonte ÚNICA de ócio) — mesmo padrão de
-- espelho_ponto/office_detail. Esta RPC só ENTREGA os dados crus do período; não
-- duplica a lógica de jornada/ócio, evitando divergência com o resto do app.
--
-- Gate por papel (mesma hierarquia de office_detail / espelho_ponto):
--   superadmin OU flag espelho_geral -> todos os colaboradores ativos
--   admin                             -> colaboradores da MESMA área (same_area)
--   demais                            -> Acesso negado
--
-- Retorno jsonb: arrays dentro de um agregado NÃO sofrem o teto de 1000 linhas do
-- PostgREST (o que subnotificaria um ranking de equipe inteira num período longo).

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

  -- Conjunto inspecionável por papel (recorte de segurança feito AQUI).
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

  v_ini := p_de::timestamptz;                       -- início inclusivo
  v_fim := (p_ate + INTERVAL '1 day')::timestamptz; -- fim exclusivo (dia inteiro)

  RETURN jsonb_build_object(
    -- Colaboradores em escopo (o front agrupa o ranking por estes).
    'profiles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'departamento', p.departamento))
        FROM public.profiles p
       WHERE p.id = ANY(v_ids)), '[]'::jsonb),

    -- Janelas ATIVO do período: base da interseção do ócio E do tempo ativo.
    'registros', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'usuario_id', r.usuario_id, 'inicio', r.inicio, 'fim', r.fim,
               'duracao_minutos', r.duracao_minutos) ORDER BY r.inicio)
        FROM public.registros_atividade r
       WHERE r.usuario_id = ANY(v_ids)
         AND r.status = 'ATIVO'
         AND r.inicio >= v_ini AND r.inicio < v_fim), '[]'::jsonb),

    -- Intervalos discretos de ociosidade (fonte do ócio reconciliado no cliente).
    'eventos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'usuario_id', e.usuario_id, 'inicio', e.inicio, 'fim', e.fim) ORDER BY e.inicio)
        FROM public.eventos_ociosidade e
       WHERE e.usuario_id = ANY(v_ids)
         AND e.inicio >= v_ini AND e.inicio < v_fim), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.relatorio_inatividade(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_inatividade(date, date) TO authenticated;
