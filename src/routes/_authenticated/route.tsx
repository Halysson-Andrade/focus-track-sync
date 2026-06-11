import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
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
  const location = useLocation();
  const [mustChange, setMustChange] = useState<boolean | null>(null);
  usePageTracker(user?.id, null);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("must_change_password").eq("id", user.id).maybeSingle()
      .then(({ data }) => setMustChange(!!data?.must_change_password));
  }, [user?.id]);

  useEffect(() => {
    if (mustChange && location.pathname !== "/change-password") {
      window.location.replace("/change-password");
    }
  }, [mustChange, location.pathname]);

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
