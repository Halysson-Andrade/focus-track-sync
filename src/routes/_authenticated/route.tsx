import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { usePageTracker } from "@/hooks/use-page-tracker";
import { useNotificacoesRecebidas } from "@/hooks/use-mensagens";
import { useDecisaoAjusteToast } from "@/hooks/use-ajustes";
import { withTimeout } from "@/lib/async-timeout";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await withTimeout(
      supabase.auth.getUser(),
      8_000,
      "Tempo esgotado ao validar sessão.",
    ).catch(() => ({ data: { user: null }, error: new Error("auth timeout") }));
    if (error || !data.user) throw redirect({ to: "/auth" });
    // Reset de senha obrigatório: redireciona ANTES de qualquer render do
    // AppShell (evita a "piscada" do popup da extensão durante o fluxo). Só
    // consulta fora da própria /change-password — evita loop e poupa a query.
    if (location.pathname !== "/change-password") {
      const { data: profile } = await withTimeout(
        supabase
          .from("profiles")
          .select("must_change_password")
          .eq("id", data.user.id)
          .maybeSingle(),
        8_000,
        "Tempo esgotado ao validar perfil.",
      ).catch(() => ({ data: null }));
      if (profile?.must_change_password) throw redirect({ to: "/change-password" });
    }
    return { user: data.user };
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
