REVOKE ALL ON FUNCTION public.fechar_abertos_ao_inserir() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fechar_registros_abertos(uuid, timestamptz, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fechar_registros_abertos(uuid, timestamptz, uuid) TO service_role;