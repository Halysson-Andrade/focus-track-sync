-- Correção da trava de início de expediente.
--
-- A política "registros_insert_closed_only" (migration 20260614210000) ISENTAVA
-- admin do bloqueio de INSERT de linha aberta. Resultado: o app desktop ANTIGO
-- de um usuário ADMIN ainda conseguia auto-iniciar o expediente (INSERT direto
-- de linha ATIVO com fim NULL), porque o admin passava no WITH CHECK.
--
-- Aqui removemos a isenção: NINGUÉM (nem admin) abre sessão por INSERT direto.
-- Abrir sessão é exclusivamente via public.abrir_registro (SECURITY DEFINER),
-- que o front web usa. INSERT direto continua permitido apenas para linha JÁ
-- FECHADA (fim NOT NULL, ex.: marcador ENCERRADO do stop()).
--
-- Não toca em auth: a recusa do INSERT apenas faz o desktop antigo dar `return`
-- (if (error) return), sem deslogar. SELECT/UPDATE/DELETE de admin permanecem.

DROP POLICY IF EXISTS "registros_insert_closed_only" ON public.registros_atividade;
CREATE POLICY "registros_insert_closed_only" ON public.registros_atividade
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = usuario_id
    AND public.is_active(auth.uid())
    AND fim IS NOT NULL
  );
