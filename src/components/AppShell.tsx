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
  Timer,
  ClipboardCheck,
  Tags,
  CalendarClock,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExtensionOnboarding } from "@/components/ExtensionOnboarding";

const nav: {
  to: string;
  label: string;
  icon: typeof Activity;
  admin?: boolean;
  super?: boolean;
}[] = [
  { to: "/", label: "Dashboard", icon: Activity },
  { to: "/atividades", label: "Atividades", icon: Timer },
  { to: "/operacional", label: "Operacional", icon: Eye },
  { to: "/extensao", label: "Extensão", icon: Chrome },
  { to: "/desktop", label: "App Desktop", icon: Monitor },
  { to: "/aprovacoes", label: "Aprovações", icon: ClipboardCheck, admin: true },
  { to: "/relatorios", label: "Relatórios", icon: FileText, admin: true },
  { to: "/espelho-ponto", label: "Espelho de Ponto", icon: CalendarClock },
  { to: "/ranking", label: "Ranking", icon: Trophy, admin: true },
  { to: "/categorias", label: "Categorias", icon: Tags, super: true },
  { to: "/admin", label: "Usuários", icon: Users, admin: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, isAdmin, isSuperadmin } = useAuth();
  const router = useRouter();
  const location = useLocation();
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar_collapsed") === "1";
  });

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* noop */
      }
      return next;
    });
  };

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
          "fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-200 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border",
            collapsed ? "justify-center px-2" : "px-5",
          )}
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Activity className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">Tempo</div>
              <div className="text-[11px] opacity-70 leading-tight">Controle de Atividade</div>
            </div>
          )}
        </div>
        <nav
          className={cn(
            "flex-1 space-y-0.5 overflow-y-auto",
            collapsed ? "px-2 py-2" : "px-2 py-2",
          )}
        >
          {nav
            .filter((n) => (!n.admin || isAdmin) && (!n.super || isSuperadmin))
            .map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md py-1.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed ? "justify-center px-2" : "px-3",
                )}
                activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
                activeOptions={{ exact: item.to === "/" }}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            ))}
        </nav>
        <div
          className={cn("shrink-0 border-t border-sidebar-border", collapsed ? "p-2" : "px-3 py-2")}
        >
          {!collapsed && (
            <div className="mb-2 text-xs leading-tight">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">{profile?.nome ?? "..."}</span>
                {isAdmin && (
                  <span className="rounded bg-sidebar-primary px-1.5 py-0.5 text-[9px] font-semibold text-sidebar-primary-foreground">
                    ADMIN
                  </span>
                )}
              </div>
              <div className="truncate opacity-60 text-[11px]">{profile?.email}</div>
            </div>
          )}
          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            className={cn(
              "h-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed ? "w-full" : "w-full justify-start",
            )}
            onClick={logout}
            title={collapsed ? "Sair" : undefined}
          >
            <LogOut className={cn("h-4 w-4", !collapsed && "mr-2")} />
            {!collapsed && "Sair"}
          </Button>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Main */}
      <div
        className={cn("flex-1 transition-all duration-200", collapsed ? "md:ml-16" : "md:ml-64")}
      >
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur md:px-8">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
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
