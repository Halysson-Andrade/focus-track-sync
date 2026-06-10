import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDuration, formatHM } from "@/lib/format";
import { Activity, Coffee, Pause, Utensils, AlertTriangle, Circle, Search, Chrome, Globe, Eye, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/operacional")({
  head: () => ({ meta: [{ title: "Painel Operacional — Controle de Atividade" }] }),
  component: OperacionalPage,
});

type Profile = { id: string; nome: string; email: string };
type Registro = { id: string; usuario_id: string; status: string; inicio: string; fim: string | null; duracao_minutos: number | null };
type NavRow = { usuario_id: string; inicio: string; fim: string | null; duracao_segundos: number | null; inativo_segundos: number; url?: string; title?: string; domain?: string };

interface UserSnapshot {
  profile: Profile;
  isOnline: boolean;
  currentStatus: string;
  currentSince: string | null;
  totals: { ATIVO: number; PAUSA: number; ALMOCO: number; INATIVO: number };
  totalOnline: number;
  lastSeen: string | null;
  navSegSource: { app: number; ext: number };
  idleSeconds: number;
  lastUrl: { url: string; title: string; domain: string } | null;
}

function OperacionalPage() {
  const { isAdmin } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [navApp, setNavApp] = useState<NavRow[]>([]);
  const [navExt, setNavExt] = useState<NavRow[]>([]);
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "online" | "offline">("todos");

  // Auto refresh
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Load profiles once
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("profiles").select("id, nome, email").eq("ativo", true).order("nome").then(({ data }) => {
      setProfiles((data ?? []) as Profile[]);
    });
  }, [isAdmin]);

  // Poll registros + nav every 5s
  useEffect(() => {
    if (!isAdmin) return;
    const fetchAll = async () => {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const since = startOfDay.toISOString();
      const [r, na, ne] = await Promise.all([
        supabase.from("registros_atividade").select("id, usuario_id, status, inicio, fim, duracao_minutos").gte("inicio", since),
        supabase.from("navegacao_paginas").select("usuario_id, inicio, fim, duracao_segundos, inativo_segundos, path, title").gte("inicio", since),
        supabase.from("navegacao_externa").select("usuario_id, inicio, fim, duracao_segundos, inativo_segundos, url, title, domain").gte("inicio", since),
      ]);
      setRegistros((r.data ?? []) as Registro[]);
      setNavApp((na.data ?? []) as NavRow[]);
      setNavExt((ne.data ?? []) as NavRow[]);
    };
    fetchAll();
    const poll = setInterval(fetchAll, 5000);
    return () => clearInterval(poll);
  }, [isAdmin]);

  const snapshots: UserSnapshot[] = useMemo(() => {
    const nowTs = now;
    return profiles.map((p) => {
      const myReg = registros.filter((r) => r.usuario_id === p.id);
      const open = myReg.find((r) => !r.fim) ?? null;
      const totals = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
      let lastSeen: string | null = null;
      myReg.forEach((r) => {
        const dur = r.duracao_minutos ?? (r.fim ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000 : (nowTs - new Date(r.inicio).getTime()) / 60000);
        if (r.status in totals) totals[r.status as keyof typeof totals] += dur;
        const endTime = r.fim ?? r.inicio;
        if (!lastSeen || new Date(endTime) > new Date(lastSeen)) lastSeen = endTime;
      });
      const myApp = navApp.filter((n) => n.usuario_id === p.id);
      const myExt = navExt.filter((n) => n.usuario_id === p.id);
      const sumSec = (rows: NavRow[]) => rows.reduce((acc, n) => {
        const d = n.duracao_segundos ?? (n.fim ? (new Date(n.fim).getTime() - new Date(n.inicio).getTime()) / 1000 : (nowTs - new Date(n.inicio).getTime()) / 1000);
        return acc + Math.max(0, d);
      }, 0);
      const idleSeconds = [...myApp, ...myExt].reduce((a, n) => a + (n.inativo_segundos || 0), 0);
      const isOnline = !!open;
      const totalOnline = totals.ATIVO + totals.PAUSA + totals.ALMOCO + totals.INATIVO;
      // última URL aberta (sem fim) ou a mais recente
      const lastOpenExt = myExt
        .filter((n) => !n.fim)
        .sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0];
      const lastExt = lastOpenExt ?? myExt.sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0];
      const lastUrl = lastExt && lastExt.url
        ? { url: lastExt.url, title: lastExt.title || lastExt.domain || lastExt.url, domain: lastExt.domain || "" }
        : null;
      return {
        profile: p,
        isOnline,
        currentStatus: open?.status ?? "OFFLINE",
        currentSince: open?.inicio ?? null,
        totals,
        totalOnline,
        lastSeen,
        navSegSource: { app: sumSec(myApp), ext: sumSec(myExt) },
        idleSeconds,
        lastUrl,
      };
    });
  }, [profiles, registros, navApp, navExt, now]);

  const filtered = useMemo(() => {
    let f = snapshots;
    if (statusFilter === "online") f = f.filter((s) => s.isOnline);
    else if (statusFilter === "offline") f = f.filter((s) => !s.isOnline);
    if (filter.trim()) {
      const q = filter.toLowerCase();
      f = f.filter((s) => s.profile.nome.toLowerCase().includes(q) || s.profile.email.toLowerCase().includes(q));
    }
    return f.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return b.totalOnline - a.totalOnline;
    });
  }, [snapshots, statusFilter, filter]);

  const stats = useMemo(() => {
    const online = snapshots.filter((s) => s.isOnline);
    const byStatus = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
    online.forEach((s) => { if (s.currentStatus in byStatus) byStatus[s.currentStatus as keyof typeof byStatus]++; });
    return {
      total: snapshots.length,
      online: online.length,
      offline: snapshots.length - online.length,
      ...byStatus,
    };
  }, [snapshots]);

  if (!isAdmin) {
    return <div className="p-6"><Card><CardContent className="p-6">Acesso restrito a administradores.</CardContent></Card></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Eye className="h-6 w-6 text-primary" /> Painel Operacional</h1>
          <p className="text-sm text-muted-foreground">Visão em tempo real de toda a equipe. Atualiza a cada 5s.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          Ao vivo · {new Date(now).toLocaleTimeString("pt-BR")}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-6">
        <KpiCard label="Online" value={stats.online} total={stats.total} color="bg-success" />
        <KpiCard label="Offline" value={stats.offline} total={stats.total} color="bg-muted-foreground" />
        <KpiCard label="Ativos" value={stats.ATIVO} icon={<Activity className="h-3 w-3" />} color="bg-success" />
        <KpiCard label="Em pausa" value={stats.PAUSA} icon={<Pause className="h-3 w-3" />} color="bg-warning" />
        <KpiCard label="Almoço" value={stats.ALMOCO} icon={<Utensils className="h-3 w-3" />} color="bg-info" />
        <KpiCard label="Inativos" value={stats.INATIVO} icon={<AlertTriangle className="h-3 w-3" />} color="bg-destructive" />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por nome ou email..." value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-1 rounded-md bg-muted p-1">
            {(["todos", "online", "offline"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors ${
                  statusFilter === s ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s} {s !== "todos" && `(${s === "online" ? stats.online : stats.offline})`}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* User grid */}
      {filtered.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">Nenhum usuário corresponde aos filtros.</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => <UserCard key={s.profile.id} snapshot={s} nowTs={now} />)}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, total, icon, color }: { label: string; value: number; total?: number; icon?: React.ReactNode; color: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">{icon}{label}</span>
          <span className={`h-2 w-2 rounded-full ${color}`} />
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-2xl font-bold">{value}</span>
          {total !== undefined && <span className="text-xs text-muted-foreground">/ {total}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function UserCard({ snapshot, nowTs }: { snapshot: UserSnapshot; nowTs: number }) {
  const s = snapshot;
  const sinceMin = s.currentSince ? (nowTs - new Date(s.currentSince).getTime()) / 60000 : 0;
  const initials = s.profile.nome.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return (
    <Card className={`relative overflow-hidden ${s.isOnline ? "border-success/40" : "opacity-80"}`}>
      <div className={`absolute left-0 top-0 h-full w-1 ${s.isOnline ? statusColor(s.currentStatus) : "bg-muted-foreground/30"}`} />
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`relative grid h-10 w-10 place-items-center rounded-full text-sm font-semibold ${s.isOnline ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {initials}
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card ${s.isOnline ? "bg-success" : "bg-muted-foreground"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold truncate">{s.profile.nome}</div>
                <div className="text-xs text-muted-foreground truncate">{s.profile.email}</div>
              </div>
              {s.isOnline ? <StatusBadge status={s.currentStatus} /> : <Badge variant="outline" className="text-[10px]"><Circle className="h-2 w-2 mr-1 fill-current" />Offline</Badge>}
            </div>
            {s.isOnline && s.currentSince && (
              <div className="mt-1 text-xs text-muted-foreground">há <b className="font-mono">{formatDuration(sinceMin)}</b> · desde {formatHM(s.currentSince)}</div>
            )}
            {!s.isOnline && s.lastSeen && (
              <div className="mt-1 text-xs text-muted-foreground">último: {formatHM(s.lastSeen)}</div>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <Stat label="Ativo" value={s.totals.ATIVO} variant="success" />
          <Stat label="Pausa" value={s.totals.PAUSA} variant="warning" />
          <Stat label="Almoço" value={s.totals.ALMOCO} variant="info" />
          <Stat label="Inativo" value={s.totals.INATIVO} variant="destructive" />
        </div>

        {s.lastUrl && (
          <div className="mt-3 rounded-md border bg-muted/30 px-2 py-2 text-xs">
            <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
              <ExternalLink className="h-3 w-3" />
              <span className="uppercase tracking-wide text-[9px]">Navegando</span>
            </div>
            <a
              href={s.lastUrl.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-primary hover:underline font-medium"
              title={s.lastUrl.url}
            >
              {s.lastUrl.title}
            </a>
            <div className="truncate text-[10px] text-muted-foreground">{s.lastUrl.domain}</div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-muted-foreground"><Globe className="h-3 w-3" /> App</span>
              <span className="font-mono">{formatSec(s.navSegSource.app)}</span>
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-muted-foreground"><Chrome className="h-3 w-3" /> Chrome</span>
              <span className="font-mono">{formatSec(s.navSegSource.ext)}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Tempo total online hoje</span>
          <span className="font-mono font-semibold">{formatDuration(s.totalOnline)}</span>
        </div>

      </CardContent>
    </Card>
  );
}



function Stat({ label, value, variant }: { label: string; value: number; variant: "success" | "warning" | "info" | "destructive" }) {
  const colors = {
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    info: "bg-info/10 text-info border-info/30",
    destructive: "bg-destructive/10 text-destructive border-destructive/30",
  };
  return (
    <div className={`rounded-md border px-1.5 py-1 ${colors[variant]}`}>
      <div className="text-[9px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="font-mono text-xs font-semibold">{value > 0 ? formatDuration(value) : "—"}</div>
    </div>
  );
}

function statusColor(status: string) {
  switch (status) {
    case "ATIVO": return "bg-success";
    case "PAUSA": return "bg-warning";
    case "ALMOCO": return "bg-info";
    case "INATIVO": return "bg-destructive";
    default: return "bg-muted-foreground";
  }
}

function formatSec(s: number) {
  if (!s) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  return formatDuration(s / 60);
}
