import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { usePageTracker } from "@/hooks/use-page-tracker";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    // Reset de senha obrigatório: redireciona ANTES de qualquer render do
    // AppShell (evita a "piscada" do popup da extensão durante o fluxo). Só
    // consulta fora da própria /change-password — evita loop e poupa a query.
    if (location.pathname !== "/change-password") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", data.user.id)
        .maybeSingle();
      if (profile?.must_change_password) throw redirect({ to: "/change-password" });
    }
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = useAuth();
  usePageTracker(user?.id, null);

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
