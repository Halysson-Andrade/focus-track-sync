import { createFileRoute } from "@tanstack/react-router";

/**
 * Auto-encerra sessões presas: registros_atividade abertos (`fim IS NULL`) sem
 * sinal recente. O `fim` é fixado no último heartbeat real (não em now()), então
 * o tempo morto NÃO é contabilizado. Pensado para rodar a cada ~5 min via
 * pg_cron (dashboard Supabase) ou scheduler externo — mesmo mecanismo do
 * `agregar-diario`.
 *
 * Esta rota fica em /api/public/* (bypass de auth no published site). Como o
 * service-role bypass faz tudo, exigimos `apikey` igual à anon key para evitar
 * que qualquer um na internet dispare o encerramento.
 */
export const Route = createFileRoute("/api/public/hooks/encerrar-ociosas")({
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

        let body: { timeout_min?: number } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* corpo opcional */
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data, error } = await supabaseAdmin.rpc("encerrar_sessoes_ociosas", {
          p_timeout_min: body.timeout_min ?? 15,
        });
        if (error) {
          console.error("encerrar_sessoes_ociosas error", error);
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ ok: true, encerrados: data ?? 0 }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
