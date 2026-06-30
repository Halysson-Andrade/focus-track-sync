import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { usePageTracker } from "@/hooks/use-page-tracker";
import { useNotificacoesRecebidas } from "@/hooks/use-mensagens";
import { useDecisaoAjusteToast } from "@/hooks/use-ajustes";
import { withRetry, withTimeout } from "@/lib/async-timeout";
import { isPasswordOk, markPasswordOk } from "@/lib/auth-gate-cache";

// O gate antigo chamava `getUser()` (vai à REDE) em TODA navegação — sob pico
// virava dezenas de GET /auth/v1/user simultâneos. Agora o caminho quente usa
// `getSession()` (lê do localStorage, zero rede) e a validação forte com
// `getUser()` é esporádica (revalida no máximo a cada REVALIDATE_MS).
const REVALIDATE_MS = 10 * 60 * 1000; // 10 min
let lastStrongCheck = 0;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Caminho quente: sessão local (sem rede). O retry cobre apenas hidratação
    // concorrente / lock contention rara do SDK; um timeout NÃO desloga.
    const { data } = await withRetry(() => supabase.auth.getSession(), {
      timeoutMs: 8_000,
      retries: 1,
      message: "Tempo esgotado ao validar sessão.",
    }).catch(() => ({ data: { session: null } }));
    const user = data.session?.user ?? null;
    if (!user) throw redirect({ to: "/auth" });

    // Validação forte esporádica: confirma com o servidor que a sessão não foi
    // revogada. Só DESLOGA se o servidor responder explicitamente "sem usuário"
    // — um timeout/erro de rede é tratado como transitório (mantém a sessão).
    const now = Date.now();
    if (now - lastStrongCheck > REVALIDATE_MS) {
      const verified = await withTimeout(
        supabase.auth.getUser(),
        8_000,
        "Tempo esgotado ao validar sessão.",
      ).catch(() => null);
      if (verified) {
        if (verified.error || !verified.data.user) throw redirect({ to: "/auth" });
        lastStrongCheck = now;
      }
    }

    // Reset de senha obrigatório: redireciona ANTES de qualquer render do
    // AppShell (evita a "piscada" do popup da extensão durante o fluxo). Só
    // consulta fora da própria /change-password e quando ainda não validada
    // nesta sessão — evita loop e poupa a query a cada navegação.
    if (location.pathname !== "/change-password" && !isPasswordOk(user.id)) {
      const { data: profile } = await withTimeout(
        supabase.from("profiles").select("must_change_password").eq("id", user.id).maybeSingle(),
        8_000,
        "Tempo esgotado ao validar perfil.",
      ).catch(() => ({ data: null }));
      if (profile?.must_change_password) throw redirect({ to: "/change-password" });
      // profile === null => não cacheia (query falhou); reavalia na próxima.
      if (profile) markPasswordOk(user.id);
    }
    return { user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = useAuth();
  usePageTracker(user?.id, null);
  // Toast ao vivo de mensagens recebidas (mensageria mão única do painel).
  useNotificacoesRecebidas(user?.id);
  // Toast ao solicitante quando seu ajuste de jornada é aprovado/rejeitado.
  useDecisaoAjusteToast(user?.id);

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
