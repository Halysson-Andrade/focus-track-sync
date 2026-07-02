import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { usePageTracker } from "@/hooks/use-page-tracker";
import { useNotificacoesRecebidas } from "@/hooks/use-mensagens";
import { useDecisaoAjusteToast } from "@/hooks/use-ajustes";
import { isPasswordOk, markPasswordOk } from "@/lib/auth-gate-cache";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Caminho quente: sessão local (sem rede). Evita travar troca de menu quando
    // o serviço de autenticação está lento, sem criar novas chamadas /auth/user.
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    const user = data.session?.user ?? null;
    if (!user) throw redirect({ to: "/auth" });

    // Reset de senha obrigatório: redireciona ANTES de qualquer render do
    // AppShell (evita a "piscada" do popup da extensão durante o fluxo). Só
    // consulta fora da própria /change-password e quando ainda não validada
    // nesta sessão — evita loop e poupa a query a cada navegação.
    if (location.pathname !== "/change-password" && !isPasswordOk(user.id)) {
      let profile: { must_change_password: boolean } | null = null;
      try {
        const result = await supabase
          .from("profiles")
          .select("must_change_password")
          .eq("id", user.id)
          .maybeSingle();
        profile = result.data;
      } catch {
        profile = null;
      }
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
