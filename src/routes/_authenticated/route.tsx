import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { usePageTracker } from "@/hooks/use-page-tracker";
import { useNotificacoesRecebidas } from "@/hooks/use-mensagens";

// Cache do check de must_change_password: roda UMA vez por usuário por carga do
// app (não a cada navegação). Evita uma query de rede em todo clique de menu.
let mustChangeCheckedFor: string | null = null;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // getSession() lê o token localmente (JWT assinado) e só vai à rede para
    // refresh quando perto de expirar — diferente de getUser(), que faz um
    // round-trip ao servidor em TODA navegação. Isso evita que a navegação
    // trave/fique em branco quando o backend está lento. A proteção real dos
    // dados é o RLS no servidor; o beforeLoad é apenas roteamento/UX.
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) throw redirect({ to: "/auth" });
    // Reset de senha obrigatório: redireciona ANTES de qualquer render do
    // AppShell. Consulta só UMA vez por usuário (cache) e fora de
    // /change-password — evita loop e a query repetida a cada navegação.
    if (location.pathname !== "/change-password" && mustChangeCheckedFor !== user.id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", user.id)
        .maybeSingle();
      mustChangeCheckedFor = user.id;
      if (profile?.must_change_password) throw redirect({ to: "/change-password" });
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

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
