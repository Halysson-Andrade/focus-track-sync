-- Protege PAUSA/ALMOÇO: nenhum cliente pode marcar INATIVO nem fechar uma pausa
-- em curso por conta própria.
--
-- Sintoma corrigido: quem entrava em almoço (pelo app desktop ou por outra aba)
-- via o registro morrer com ~10-11 min e o expediente "encerrado por inatividade".
-- Causa: o monitor de inatividade do app web decide pelo estado React da aba
-- (`current.status === 'ATIVO'`), não pelo banco. Uma aba OCULTA e defasada —
-- o poll de segurança só rodava com a aba visível — continuava achando que o
-- status era ATIVO e, após INACTIVITY_LIMIT_MS (10 min), chamava
-- abrir_registro('INATIVO'), que fecha TODAS as linhas abertas (inclusive o
-- ALMOCO real). 15 min depois o cron encerrava a linha INATIVO.
--
-- A defesa vive no backend porque é a única camada que alcança abas antigas
-- ainda abertas com bundle velho e desktops desatualizados — mesmo padrão do
-- gate de início de expediente (20260614210000_inicio_expediente_via_rpc.sql).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_bloqueia_fechamento_pausa ON public.registros_atividade;
--   DROP FUNCTION IF EXISTS public.bloqueia_fechamento_pausa();
--   -- e reaplicar abrir_registro da migration 20260818143405 (versão sem a guarda).

-- ===========================================================================
-- 1) abrir_registro: pedir INATIVO durante PAUSA/ALMOCO (ou já em INATIVO) vira
--    NO-OP. Devolve a linha REAL aberta, sem fechar nada — o cliente defasado
--    recebe o objeto e se autocorrige. Todo o restante (gate de monitoração,
--    advisory lock, fechar_registros_abertos) é idêntico a 20260818143405.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.abrir_registro(p_status text, p_observacao text DEFAULT NULL)
RETURNS public.registros_atividade
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_new public.registros_atividade;
  v_open public.registros_atividade;
  v_janela constant interval := interval '3 minutes';
  v_ext_ok boolean;
  v_desk_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_active(v_uid) THEN
    RAISE EXCEPTION 'user not active';
  END IF;
  IF p_status NOT IN ('ATIVO', 'PAUSA', 'ALMOCO', 'INATIVO') THEN
    RAISE EXCEPTION 'invalid open status: %', p_status;
  END IF;

  -- Trava por usuário: impede que desktop e web abram dois registros em paralelo.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 42));

  SELECT * INTO v_open
    FROM public.registros_atividade
   WHERE usuario_id = v_uid AND fim IS NULL
   ORDER BY inicio DESC
   LIMIT 1;

  -- Inatividade automática NUNCA interrompe uma pausa/almoço em curso, e não
  -- repica uma linha INATIVO já aberta (que só picotaria o registro).
  IF p_status = 'INATIVO'
     AND v_open.id IS NOT NULL
     AND v_open.status IN ('PAUSA', 'ALMOCO', 'INATIVO') THEN
    RETURN v_open;
  END IF;

  IF p_status = 'ATIVO' AND public.gate_monitoramento_ativo() THEN
    SELECT EXISTS (
      SELECT 1 FROM public.presenca_extensao pe
       WHERE pe.usuario_id = v_uid AND pe.ultimo_visto > v_now - v_janela
    ) INTO v_ext_ok;
    IF NOT v_ext_ok THEN
      RAISE EXCEPTION 'extension_offline';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.presenca_desktop pd
       WHERE pd.usuario_id = v_uid
         AND GREATEST(COALESCE(pd.ultimo_visto, 'epoch'::timestamptz),
                      COALESCE(pd.ultimo_ativo, 'epoch'::timestamptz)) > v_now - v_janela
    ) INTO v_desk_ok;
    IF NOT v_desk_ok THEN
      RAISE EXCEPTION 'desktop_offline';
    END IF;
  END IF;

  -- Fecha TODOS os registros abertos (antes fechava só o mais recente, o que
  -- deixava linhas órfãs abertas e gerava sobreposição no dia inteiro).
  PERFORM public.fechar_registros_abertos(v_uid, v_now);

  INSERT INTO public.registros_atividade (usuario_id, status, inicio, observacao)
    VALUES (v_uid, p_status::public.activity_status, v_now, p_observacao)
    RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.abrir_registro(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.abrir_registro(text, text) TO authenticated;

-- ===========================================================================
-- 2) Fechamento DIRETO de pausa/almoço por cliente autenticado é ignorado.
--    Cobre abas com bundle antigo, que fazem `UPDATE fim=now()` antes da RPC:
--    sem isto, a RPC virar no-op ainda deixaria a pausa fechada e órfã.
--
--    SECURITY INVOKER de propósito: precisamos ver o role REAL do chamador.
--    Dentro de SECURITY DEFINER (abrir_registro, fechar_registros_abertos,
--    fechar_abertos_ao_inserir, encerrar_sessoes_ociosas) current_user é o owner
--    da função, não 'authenticated' — logo esses caminhos passam.
--
--    Encerrar a jornada durante o almoço continua funcionando: web e desktop
--    inserem o marcador ENCERRADO, e o trigger AFTER INSERT
--    fechar_abertos_ao_inserir (20260818143405) fecha a pausa no mesmo instante.
--
--    Sem chamada a is_superadmin/has_role de propósito: a função rodaria com o
--    privilégio do cliente e um EXECUTE ausente derrubaria TODO update da
--    tabela. A gestão corrige jornada pelo overlay de ajustes (não-destrutivo,
--    não toca registros_atividade); correção manual crua segue possível via
--    SQL Editor / service_role, que não são o role `authenticated`.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.bloqueia_fechamento_pausa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('PAUSA', 'ALMOCO')
     AND OLD.fim IS NULL
     AND NEW.fim IS NOT NULL
     AND current_user = 'authenticated' THEN
    RETURN NULL; -- cancela silenciosamente: o cliente não recebe erro
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloqueia_fechamento_pausa ON public.registros_atividade;
CREATE TRIGGER trg_bloqueia_fechamento_pausa
BEFORE UPDATE ON public.registros_atividade
FOR EACH ROW EXECUTE FUNCTION public.bloqueia_fechamento_pausa();
