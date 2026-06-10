import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentSession } from "@/hooks/use-current-session";
import { usePageTracker } from "@/hooks/use-page-tracker";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = useAuth();
  const session = useCurrentSession(user?.id);
  usePageTracker(user?.id, session.current?.id ?? null);
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
