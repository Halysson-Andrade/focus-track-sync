import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { usePageTracker } from "@/hooks/use-page-tracker";
import { useNotificacoesRecebidas } from "@/hooks/use-mensagens";
import { useDecisaoAjusteToast } from "@/hooks/use-ajustes";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Caminho quente: sessão local (sem rede). Evita travar troca de menu quando
    // o serviço de autenticação está lento, sem criar novas chamadas /auth/user.
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    const user = data.session?.user ?? null;
    if (!user) throw redirect({ to: "/auth" });
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
