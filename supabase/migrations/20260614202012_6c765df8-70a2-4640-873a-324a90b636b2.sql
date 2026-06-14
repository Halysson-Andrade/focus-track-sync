
-- Prevent self-escalation via profiles UPDATE: block non-admins from
-- changing `ativo` or `must_change_password` on any row, and block
-- deactivated users from updating profiles at all.
CREATE OR REPLACE FUNCTION public.prevent_self_ativo_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
      RAISE EXCEPTION 'Only admins can change account activation status';
    END IF;
    IF NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
       AND NEW.must_change_password = false
       AND OLD.must_change_password = true THEN
      -- Allow clearing the flag only via the auth flow (password updated).
      -- Verify the user actually changed their password recently.
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
$function$;

-- Tighten UPDATE policy: deactivated users cannot update any profile row.
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='profiles' AND cmd='UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "profiles_update_self_or_admin"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  (auth.uid() = id AND public.is_active(auth.uid()))
  OR public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  (auth.uid() = id AND public.is_active(auth.uid()))
  OR public.has_role(auth.uid(), 'admin')
);
