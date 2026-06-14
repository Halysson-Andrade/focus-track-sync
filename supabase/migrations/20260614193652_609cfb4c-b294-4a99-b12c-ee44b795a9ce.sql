REVOKE EXECUTE ON FUNCTION public.encerrar_sessoes_ociosas(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purgar_brutos_antigos(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agregar_dia(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encerrar_sessoes_ociosas(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.purgar_brutos_antigos(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.agregar_dia(date) TO service_role;
