import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useOfficeData } from "@/hooks/use-office-data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { VirtualOffice } from "@/components/office/VirtualOffice";
import { AvatarDetailSheet } from "@/components/office/AvatarDetailSheet";
import { generateInsights } from "@/components/office/insights";
import { formatDuration, formatHM } from "@/lib/format";
import { buildSnapshots, buildStats, type UserSnapshot } from "@/lib/operacional-snapshot";
import {
  Activity,
  Pause,
  Utensils,
  AlertTriangle,
  Circle,
  Search,
  Chrome,
  Globe,
  Monitor,
  Eye,
  ExternalLink,
  Hourglass,
  Map as MapIcon,
  List as ListIcon,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/operacional")({
  head: () => ({ meta: [{ title: "Painel Operacional — Controle de Atividade" }] }),
  component: OperacionalPage,
});

function OperacionalPage() {
  const { isAdmin } = useAuth();
  const { profiles, registros, navApp, navExt, navDesk, connected } = useOfficeData(isAdmin);
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "online" | "offline">("todos");
  const [selected, setSelected] = useState<UserSnapshot | null>(null);

  // Ticker de 1s para atualizar contadores/tempos relativos.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const snapshots: UserSnapshot[] = useMemo(
    () => buildSnapshots(profiles, registros, navApp, navExt, navDesk, now),
    [profiles, registros, navApp, navExt, navDesk, now],
  );

  const filtered = useMemo(() => {
    let f = snapshots;
    if (statusFilter === "online") f = f.filter((s) => s.isOnline);
    else if (statusFilter === "offline") f = f.filter((s) => !s.isOnline);
    if (filter.trim()) {
      const q = filter.toLowerCase();
      f = f.filter(
        (s) =>
          s.profile.nome.toLowerCase().includes(q) || s.profile.email.toLowerCase().includes(q),
      );
    }
    return f.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return b.totalOnline - a.totalOnline;
    });
  }, [snapshots, statusFilter, filter]);

  const stats = useMemo(() => buildStats(snapshots), [snapshots]);
  const insights = useMemo(
    () => generateInsights(snapshots, navExt, navDesk, now),
    [snapshots, navExt, navDesk, now],
  );

  // Mantém o snapshot do painel lateral sincronizado com os dados em tempo real.
  const selectedLive = useMemo(
    () => (selected ? (snapshots.find((s) => s.profile.id === selected.profile.id) ?? null) : null),
    [selected, snapshots],
  );

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">Acesso restrito a administradores.</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Eye className="h-6 w-6 text-primary" /> Painel Operacional
          </h1>
          <p className="text-sm text-muted-foreground">
            Escritório virtual da equipe em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            {connected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-warning"}`}
            />
          </span>
          {connected ? "Ao vivo" : "Sincronizando"} · {new Date(now).toLocaleTimeString("pt-BR")}
        </div>
      </div>

      <Tabs defaultValue="escritorio" className="space-y-4">
        <TabsList>
          <TabsTrigger value="escritorio" className="gap-1.5">
            <MapIcon className="h-4 w-4" /> Escritório
          </TabsTrigger>
          <TabsTrigger value="lista" className="gap-1.5">
            <ListIcon className="h-4 w-4" /> Lista
          </TabsTrigger>
        </TabsList>

        {/* ESCRITÓRIO VIRTUAL */}
        <TabsContent value="escritorio" className="space-y-4">
          <VirtualOffice
            snapshots={snapshots}
            stats={stats}
            nowTs={now}
            insights={insights}
            onSelect={setSelected}
          />
        </TabsContent>

        {/* LISTA (visão detalhada clássica) */}
        <TabsContent value="lista" className="space-y-6">
          {/* KPI cards */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-6">
            <KpiCard label="Online" value={stats.online} total={stats.total} color="bg-success" />
            <KpiCard
              label="Offline"
              value={stats.offline}
              total={stats.total}
              color="bg-muted-foreground"
            />
            <KpiCard
              label="Ativos"
              value={stats.ATIVO}
              icon={<Activity className="h-3 w-3" />}
              color="bg-success"
            />
            <KpiCard
              label="Em pausa"
              value={stats.PAUSA}
              icon={<Pause className="h-3 w-3" />}
              color="bg-warning"
            />
            <KpiCard
              label="Almoço"
              value={stats.ALMOCO}
              icon={<Utensils className="h-3 w-3" />}
              color="bg-info"
            />
            <KpiCard
              label="Inativos"
              value={stats.INATIVO}
              icon={<AlertTriangle className="h-3 w-3" />}
              color="bg-muted-foreground"
            />
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou email..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-1 rounded-md bg-muted p-1">
                {(["todos", "online", "offline"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors ${
                      statusFilter === s
                        ? "bg-background text-foreground shadow"
                        : "text-muted-foreground hover:text-foreground"
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
            <Card>
              <CardContent className="p-12 text-center text-sm text-muted-foreground">
                Nenhum usuário corresponde aos filtros.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((s) => (
                <UserCard key={s.profile.id} snapshot={s} nowTs={now} onSelect={setSelected} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AvatarDetailSheet
        selected={selectedLive}
        registros={registros}
        navApp={navApp}
        navExt={navExt}
        navDesk={navDesk}
        nowTs={now}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  total,
  icon,
  color,
}: {
  label: string;
  value: number;
  total?: number;
  icon?: React.ReactNode;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            {icon}
            {label}
          </span>
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

function UserCard({
  snapshot,
  nowTs,
  onSelect,
}: {
  snapshot: UserSnapshot;
  nowTs: number;
  onSelect?: (s: UserSnapshot) => void;
}) {
  const s = snapshot;
  const sinceMin = s.currentSince ? (nowTs - new Date(s.currentSince).getTime()) / 60000 : 0;
  const initials = s.profile.nome
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <Card
      onClick={() => onSelect?.(s)}
      className={`relative cursor-pointer overflow-hidden transition-shadow hover:shadow-md ${s.isOnline ? "border-success/40" : "opacity-80"}`}
    >
      <div
        className={`absolute left-0 top-0 h-full w-1 ${s.isOnline ? statusColor(s.currentStatus) : "bg-muted-foreground/30"}`}
      />
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={`relative grid h-10 w-10 place-items-center rounded-full text-sm font-semibold ${s.isOnline ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {initials}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card ${s.isOnline ? "bg-success" : "bg-muted-foreground"}`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold truncate">{s.profile.nome}</div>
                <div className="text-xs text-muted-foreground truncate">{s.profile.email}</div>
              </div>
              {s.isOnline ? (
                <StatusBadge status={s.currentStatus} />
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  <Circle className="h-2 w-2 mr-1 fill-current" />
                  Offline
                </Badge>
              )}
            </div>
            {s.isOnline && s.currentSince && (
              <div className="mt-1 text-xs text-muted-foreground">
                há <b className="font-mono">{formatDuration(sinceMin)}</b> · desde{" "}
                {formatHM(s.currentSince)}
              </div>
            )}
            {!s.isOnline && s.lastSeen && (
              <div className="mt-1 text-xs text-muted-foreground">
                último: {formatHM(s.lastSeen)}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <Stat label="Ativo" value={s.totals.ATIVO} variant="success" />
          <Stat label="Pausa" value={s.totals.PAUSA} variant="warning" />
          <Stat label="Almoço" value={s.totals.ALMOCO} variant="info" />
          <Stat label="Inativo" value={s.totals.INATIVO} variant="slate" />
        </div>

        {/* Ociosidade detectada — micro-ócio dentro de apps/sites (inativo_segundos
            de app+chrome+desktop). Independe do INATIVO macro acima. */}
        <div
          className="mt-2 flex items-center justify-between rounded-md border px-2 py-1.5 text-xs"
          style={{
            borderColor: "color-mix(in oklch, var(--color-idle) 35%, transparent)",
            background: "color-mix(in oklch, var(--color-idle) 10%, transparent)",
          }}
          title="Tempo sem mouse/teclado dentro de apps e navegação"
        >
          <span
            className="flex items-center gap-1 font-medium"
            style={{ color: "var(--color-idle)" }}
          >
            <Hourglass className="h-3 w-3" /> Ócio detectado
          </span>
          <span className="font-mono font-semibold" style={{ color: "var(--color-idle)" }}>
            {formatSec(s.idleSeconds)}
          </span>
        </div>

        {s.lastUrl ? (
          <div className="mt-3 rounded-md border bg-muted/30 px-2 py-2 text-xs">
            <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
              <ExternalLink className="h-3 w-3" />
              <span className="uppercase tracking-wide text-[9px]">Navegando (Chrome)</span>
            </div>
            <a
              href={s.lastUrl.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="block truncate text-primary hover:underline font-medium"
              title={s.lastUrl.url}
            >
              {s.lastUrl.title}
            </a>
            <div className="truncate text-[10px] text-muted-foreground">{s.lastUrl.domain}</div>
          </div>
        ) : s.lastAppPage ? (
          <div className="mt-3 rounded-md border bg-muted/30 px-2 py-2 text-xs">
            <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
              <Globe className="h-3 w-3" />
              <span className="uppercase tracking-wide text-[9px]">No app</span>
            </div>
            <div className="block truncate font-medium">{s.lastAppPage.title}</div>
            <div className="truncate text-[10px] text-muted-foreground">{s.lastAppPage.path}</div>
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Globe className="h-3 w-3" /> App
              </span>
              <span className="font-mono">{formatSec(s.navSegSource.app)}</span>
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Chrome className="h-3 w-3" /> Chrome
              </span>
              <span className="font-mono">{formatSec(s.navSegSource.ext)}</span>
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Monitor className="h-3 w-3" /> Desktop
              </span>
              <span className="font-mono">{formatSec(s.navSegSource.desktop)}</span>
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

function Stat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "success" | "warning" | "info" | "destructive" | "slate";
}) {
  const colors = {
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    info: "bg-info/10 text-info border-info/30",
    destructive: "bg-destructive/10 text-destructive border-destructive/30",
    slate: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/30",
  };
  return (
    <div className={`rounded-md border px-1.5 py-1 ${colors[variant]}`}>
      <div className="text-[9px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="font-mono text-xs font-semibold">
        {value > 0 ? formatDuration(value) : "—"}
      </div>
    </div>
  );
}

function statusColor(status: string) {
  switch (status) {
    case "ATIVO":
      return "bg-success";
    case "PAUSA":
      return "bg-warning";
    case "ALMOCO":
      return "bg-info";
    case "INATIVO":
      return "bg-muted-foreground";
    default:
      return "bg-muted-foreground";
  }
}

function formatSec(s: number) {
  if (!s) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  return formatDuration(s / 60);
}
