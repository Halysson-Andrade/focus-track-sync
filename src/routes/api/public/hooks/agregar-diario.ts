import { createFileRoute } from "@tanstack/react-router";

/**
 * Agrega o dia anterior nas tabelas `*_diario` e (opcionalmente) purga linhas
 * brutas mais antigas que `retencao_dias`. Chamado pelo pg_cron 1x/dia.
 *
 * Por padrão NÃO faz purge — assim o usuário valida o agregado por alguns dias
 * antes de habilitar a limpeza. Para ligar, basta enviar `{"purgar": true}`.
 *
 * Esta rota fica em /api/public/* (bypass de auth no published site). Como o
 * service-role bypass faz tudo, exigimos `apikey` igual à anon key para evitar
 * que qualquer um na internet dispare a agregação.
 */
export const Route = createFileRoute("/api/public/hooks/agregar-diario")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: { dia?: string; purgar?: boolean; retencao_dias?: number } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* corpo opcional */
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // "Ontem" em UTC por padrão. Aceita override para reprocessar manualmente.
        const targetDay =
          body.dia ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const { error: aggErr } = await supabaseAdmin.rpc("agregar_dia", { p_dia: targetDay });
        if (aggErr) {
          console.error("agregar_dia error", aggErr);
          return new Response(JSON.stringify({ ok: false, step: "agregar", error: aggErr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let purgeResult: unknown = null;
        if (body.purgar === true) {
          const { data, error: purgeErr } = await supabaseAdmin.rpc("purgar_brutos_antigos", {
            p_dias_retencao: body.retencao_dias ?? 30,
          });
          if (purgeErr) {
            console.error("purgar_brutos_antigos error", purgeErr);
            return new Response(
              JSON.stringify({ ok: false, step: "purgar", error: purgeErr.message, dia: targetDay }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }
          purgeResult = data;
        }

        return new Response(
          JSON.stringify({ ok: true, dia: targetDay, purge: purgeResult }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
