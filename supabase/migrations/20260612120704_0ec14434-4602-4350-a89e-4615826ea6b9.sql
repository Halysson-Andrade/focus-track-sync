
REVOKE ALL ON FUNCTION public.agregar_dia(DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purgar_brutos_antigos(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agregar_dia(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.purgar_brutos_antigos(INTEGER) TO service_role;
