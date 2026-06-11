-- Helper: returns true if profile is active (or no profile row yet)
CREATE OR REPLACE FUNCTION public.is_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT ativo FROM public.profiles WHERE id = _user_id), true)
$$;

-- Rebuild policies on user data tables to require an active profile for the owner path
DROP POLICY IF EXISTS "Users manage own registros" ON public.registros_atividade;
CREATE POLICY "Users manage own registros" ON public.registros_atividade
  FOR ALL TO authenticated
  USING ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users manage own navegacao_externa" ON public.navegacao_externa;
CREATE POLICY "Users manage own navegacao_externa" ON public.navegacao_externa
  FOR ALL TO authenticated
  USING ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users manage own navegacao" ON public.navegacao_paginas;
CREATE POLICY "Users manage own navegacao" ON public.navegacao_paginas
  FOR ALL TO authenticated
  USING ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK ((auth.uid() = usuario_id AND public.is_active(auth.uid())) OR public.has_role(auth.uid(), 'admin'));

-- Prevent non-admins from changing their own `ativo` flag (self-reactivation bypass)
CREATE OR REPLACE FUNCTION public.prevent_self_ativo_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ativo IS DISTINCT FROM OLD.ativo AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change account activation status';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_self_ativo_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_prevent_self_ativo_change ON public.profiles;
CREATE TRIGGER profiles_prevent_self_ativo_change
  BEFORE UPDATE OF ativo ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_ativo_change();