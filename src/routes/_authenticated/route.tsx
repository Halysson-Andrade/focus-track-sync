import { createFileRoute, Outlet, redirect, useLocation, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { usePageTracker } from "@/hooks/use-page-tracker";
import { useNotificacoesRecebidas } from "@/hooks/use-mensagens";
import { useDecisaoAjusteToast } from "@/hooks/use-ajustes";
import { useDecisaoJustificativaOcioToast } from "@/hooks/use-justificativas-ocio";
import { useEffect } from "react";

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
  const { user, profile } = useAuth();
  const router = useRouter();
  const location = useLocation();
  usePageTracker(user?.id, null);
  // Toast ao vivo de mensagens recebidas (mensageria mão única do painel).
  useNotificacoesRecebidas(user?.id);
  // Toast ao solicitante quando seu ajuste de jornada é aprovado/rejeitado.
  useDecisaoAjusteToast(user?.id);
  useDecisaoJustificativaOcioToast(user?.id);

  useEffect(() => {
    if (profile?.must_change_password && location.pathname !== "/change-password") {
      void router.navigate({ to: "/change-password" });
    }
  }, [location.pathname, profile?.must_change_password, router]);

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
