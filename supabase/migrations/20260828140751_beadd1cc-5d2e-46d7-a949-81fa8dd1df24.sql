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