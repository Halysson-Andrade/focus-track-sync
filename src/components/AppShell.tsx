import { Link, useLocation, useRouter } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Chrome,
  FileText,
  LogOut,
  Moon,
  Sun,
  Trophy,
  Users,
  Menu,
  Eye,
  Monitor,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExtensionOnboarding } from "@/components/ExtensionOnboarding";

const nav = [
  { to: "/", label: "Dashboard", icon: Activity },
  { to: "/operacional", label: "Operacional", icon: Eye, admin: true },
  { to: "/extensao", label: "Extensão", icon: Chrome },
  { to: "/desktop", label: "App Desktop", icon: Monitor },
  { to: "/relatorios", label: "Relatórios", icon: FileText, admin: true },
  { to: "/ranking", label: "Ranking", icon: Trophy, admin: true },
  { to: "/admin", label: "Usuários", icon: Users, admin: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, isAdmin } = useAuth();
  const router = useRouter();
  const location = useLocation();
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const isDark = stored
      ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const logout = async () => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (uid) {
        const nowIso = new Date().toISOString();
        // Encerra registro de atividade aberto
        const { data: openReg } = await supabase
          .from("registros_atividade")
          .select("id, inicio")
          .eq("usuario_id", uid)
          .is("fim", null)
          .order("inicio", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (openReg) {
          const dur = (new Date(nowIso).getTime() - new Date(openReg.inicio).getTime()) / 60000;
          await supabase
            .from("registros_atividade")
            .update({ fim: nowIso, duracao_minutos: dur, observacao: "Encerrado no logout" })
            .eq("id", openReg.id);
        }
        // Encerra navegação de página aberta
        const { data: openNav } = await supabase
          .from("navegacao_paginas")
          .select("id, inicio, inativo_segundos")
          .eq("usuario_id", uid)
          .is("fim", null)
          .order("inicio", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (openNav) {
          const dur = (new Date(nowIso).getTime() - new Date(openNav.inicio).getTime()) / 1000;
          await supabase
            .from("navegacao_paginas")
            .update({ fim: nowIso, duracao_segundos: dur })
            .eq("id", openNav.id);
        }
      }
    } catch {
      /* noop */
    }
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  };

  return (
    <div className="flex min-h-screen bg-background">
      {location.pathname !== "/change-password" && <ExtensionOnboarding userId={user?.id} />}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 transform bg-sidebar text-sidebar-foreground transition-transform md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Tempo</div>
            <div className="text-xs opacity-70">Controle de Atividade</div>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          {nav
            .filter((n) => !n.admin || isAdmin)
            .map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
                activeOptions={{ exact: item.to === "/" }}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-sidebar-border p-4">
          <div className="mb-3 text-xs">
            <div className="font-semibold">{profile?.nome ?? "..."}</div>
            <div className="opacity-70 truncate">{profile?.email}</div>
            {isAdmin && (
              <div className="mt-1 inline-block rounded bg-sidebar-primary px-2 py-0.5 text-[10px] text-sidebar-primary-foreground">
                ADMIN
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={logout}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 md:ml-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur md:px-8">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Alternar tema">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>
        <main className="p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
