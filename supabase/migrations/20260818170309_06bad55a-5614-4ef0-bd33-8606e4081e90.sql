DO $$
DECLARE v_count int;
BEGIN
  CREATE TEMP TABLE _fix ON COMMIT DROP AS
  SELECT a.id AS registro_id, a.fim AS fim_antigo, a.duracao_minutos AS duracao_antiga,
         MIN(b.inicio) AS fim_novo
  FROM public.registros_atividade a
  JOIN public.registros_atividade b
    ON b.usuario_id = a.usuario_id
   AND b.id <> a.id
   AND b.inicio > a.inicio
   AND b.inicio < a.fim
  WHERE a.fim IS NOT NULL
  GROUP BY a.id, a.fim, a.duracao_minutos;

  INSERT INTO public.registros_atividade_overlap_backup (registro_id, fim_antigo, duracao_antiga, fim_novo, saneado_em)
  SELECT registro_id, fim_antigo, duracao_antiga, fim_novo, now() FROM _fix;

  UPDATE public.registros_atividade r
  SET fim = f.fim_novo,
      duracao_minutos = GREATEST(EXTRACT(EPOCH FROM (f.fim_novo - r.inicio)) / 60.0, 0)
  FROM _fix f
  WHERE r.id = f.registro_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'registros saneados: %', v_count;
END $$;