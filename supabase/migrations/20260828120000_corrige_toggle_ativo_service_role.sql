-- Corrige "Only admins can change account activation status" ao ativar/desativar
-- um usuário pelo painel /admin, inclusive logado como Super Admin.
--
-- Causa raiz
-- ----------
-- A migração 20260621184706 travou a escrita de `profiles.ativo` por
-- column-level grant (authenticated só pode gravar nome/cargo/departamento/
-- must_change_password) e documentou: "Admin-side mutations (activate/deactivate,
-- role, profile edits) go through server functions that use the service role,
-- so they are unaffected".
--
-- A premissa está errada para triggers: a service_role ignora RLS, mas NÃO
-- ignora triggers. O trigger `profiles_prevent_self_ativo_change` continua
-- executando em cima do UPDATE feito pela server function `adminToggleActive`
-- (src/lib/admin.functions.ts) e avalia `has_role(auth.uid(), 'admin')`. Numa
-- conexão service_role não existe JWT de usuário: auth.uid() é NULL,
-- has_role(NULL, 'admin') devolve false e a exceção estoura.
--
-- Efeito: NENHUM perfil conseguia alternar o status — nem admin, nem superadmin.
-- Não era uma regra de privilégio faltando para o superadmin; era o trigger
-- avaliando um usuário que não existe naquela conexão.
--
-- Correção
-- --------
-- O trigger passa a governar apenas sessões de usuário final. Sem usuário
-- autenticado no request (service_role, migrações, jobs internos) a autorização
-- já foi feita antes de chegar aqui — as server functions checam
-- has_role(_, 'admin') e só superadmin concede privilégio elevado — e o trigger
-- não tem o que decidir.
--
-- A exceção é segura: toda sessão `authenticated` tem auth.uid() preenchido, e
-- `anon` não alcança a tabela (as policies são TO authenticated e o GRANT de
-- UPDATE é por coluna). As demais regras seguem idênticas para usuários finais.
--
-- Escopo do trigger permanece `BEFORE UPDATE OF ativo` (inalterado).

CREATE OR REPLACE FUNCTION public.prevent_self_ativo_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Backend confiável: sem auth.uid() não há usuário final para policiar.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
      RAISE EXCEPTION 'Only admins can change account activation status';
    END IF;
    IF NEW.espelho_geral IS DISTINCT FROM OLD.espelho_geral THEN
      RAISE EXCEPTION 'Only admins can change espelho_geral flag';
    END IF;
    IF NEW.departamento IS DISTINCT FROM OLD.departamento THEN
      RAISE EXCEPTION 'Only admins can change departamento';
    END IF;
    IF NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
       AND NEW.must_change_password = false
       AND OLD.must_change_password = true THEN
      IF NOT EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id = auth.uid()
          AND u.updated_at > now() - interval '5 minutes'
      ) THEN
        RAISE EXCEPTION 'must_change_password can only be cleared after a password change';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_self_ativo_change() FROM PUBLIC, anon, authenticated;
