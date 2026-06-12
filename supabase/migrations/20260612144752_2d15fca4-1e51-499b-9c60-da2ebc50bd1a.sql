
ALTER TABLE public.registros_atividade REPLICA IDENTITY FULL;
ALTER TABLE public.presenca_desktop REPLICA IDENTITY FULL;
ALTER TABLE public.navegacao_externa REPLICA IDENTITY FULL;
ALTER TABLE public.uso_aplicativos REPLICA IDENTITY FULL;
ALTER TABLE public.navegacao_paginas REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.registros_atividade;
ALTER PUBLICATION supabase_realtime ADD TABLE public.presenca_desktop;
ALTER PUBLICATION supabase_realtime ADD TABLE public.navegacao_externa;
ALTER PUBLICATION supabase_realtime ADD TABLE public.uso_aplicativos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.navegacao_paginas;
