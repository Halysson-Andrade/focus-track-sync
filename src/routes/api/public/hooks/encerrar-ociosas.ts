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
        const provided =
          request.headers.get("x-webhook-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const expected = process.env.WEBHOOK_SECRET;
        if (!expected || !provided || provided !== expected) {
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

        // Mínimo de 5 min — evita encerramento agressivo via parâmetro malicioso.
        const timeoutMin = Math.max(5, Math.floor(body.timeout_min ?? 15));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data, error } = await supabaseAdmin.rpc("encerrar_sessoes_ociosas", {
          p_timeout_min: timeoutMin,
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
