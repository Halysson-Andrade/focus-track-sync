INSERT INTO public.registros_atividade_overlap_backup (registro_id, fim_antigo, duracao_antiga, fim_novo, saneado_em)
SELECT id, fim, duracao_minutos, inicio, now()
FROM public.registros_atividade
WHERE fim IS NOT NULL AND fim < inicio;

UPDATE public.registros_atividade
SET fim = inicio, duracao_minutos = 0
WHERE fim IS NOT NULL AND fim < inicio;