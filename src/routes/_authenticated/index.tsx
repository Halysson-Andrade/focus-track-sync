import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentSession } from "@/hooks/use-current-session";
import { StatusBadge } from "@/components/StatusBadge";
import { InactivityModal } from "@/components/InactivityModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Coffee,
  Pause,
  Play,
  Square,
  Utensils,
  Clock,
  TrendingUp,
  Activity as ActivityIcon,
  AlertTriangle,
  Chrome,
  Globe,
  Monitor,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatDuration, formatHM } from "@/lib/format";
import { tempoTrabalhado } from "@/lib/activity-config";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard — Controle de Atividade" }] }),
  component: Dashboard,
});

type Registro = {
  id: string;
  status: string;
  inicio: string;
  fim: string | null;
  duracao_minutos: number | null;
};
type Pagina = {
  id: string;
  path: string;
  title: string | null;
  inicio: string;
  fim: string | null;
  duracao_segundos: number | null;
  inativo_segundos: number;
};
type NavExterna = {
  id: string;
  url: string;
  domain: string;
  title: string | null;
  inicio: string;
  fim: string | null;
  duracao_segundos: number | null;
  inativo_segundos: number;
};
type UsoApp = {
  id: string;
  process_name: string;
  app_label: string | null;
  inicio: string;
  fim: string | null;
  duracao_segundos: number | null;
  inativo_segundos: number | null;
};
type Origem = "app" | "chrome" | "desktop";
type UnifiedLog = {
  id: string;
  origem: Origem;
  label: string;
  sub: string;
  inicio: string;
  fim: string | null;
  duracao: number;
  inativo: number;
};

function formatSeconds(s: number) {
  if (!s || s < 60) return `${Math.round(s)}s`;
  return formatDuration(s / 60);
}

// Duração segura: registros em aberto (sem fim) só contam até o último valor
// reportado pelo heartbeat (+90s de tolerância) — evita contagem infinita de
// registros órfãos que não foram fechados pela extensão.
function safeDur(duracao: number | null, inicio: string, fim: string | null) {
  if (fim) return duracao ?? (new Date(fim).getTime() - new Date(inicio).getTime()) / 1000;
  const live = (Date.now() - new Date(inicio).getTime()) / 1000;
  return Math.min(Math.max(live, 0), (duracao ?? 0) + 90);
}

function Dashboard() {
  const { user, profile, isAdmin } = useAuth();
  const session = useCurrentSession(user?.id);
  const [breakDialog, setBreakDialog] = useState<{ kind: "PAUSA" | "ALMOCO" } | null>(null);
  const [breakReason, setBreakReason] = useState("");
  const [breakBusy, setBreakBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  const [history30, setHistory30] = useState<{ date: Date; records: Registro[] }[]>([]);

  // Selected day (defaults to today). When != today, dashboard shows historic data.
  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday);
  const [openDomain, setOpenDomain] = useState<string | null>(null);
  // (logs consolidados — paginação removida; detalhe vai por exportação)

  const isToday = selectedDate.getTime() === startOfToday.getTime();
  const dayRange = useMemo(() => {
    const s = new Date(selectedDate);
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    return { start: s.toISOString(), end: e.toISOString() };
  }, [selectedDate]);
  const [dayRecords, setDayRecords] = useState<Registro[]>([]);

  // Admin: filter by target user
  const [users, setUsers] = useState<{ id: string; nome: string }[]>([]);
  const [targetUserId, setTargetUserId] = useState<string>("");
  const effectiveUserId = isAdmin && targetUserId ? targetUserId : user?.id;
  const viewingOther = isAdmin && targetUserId && targetUserId !== user?.id;

  // Data for the effective user (own session OR another user when admin)
  const [otherRecords, setOtherRecords] = useState<Registro[]>([]);
  const [pages, setPages] = useState<Pagina[]>([]);
  const [externalNav, setExternalNav] = useState<NavExterna[]>([]);
  const [appUsage, setAppUsage] = useState<UsoApp[]>([]);

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  // Load users list for admin filter
  useEffect(() => {
    if (!isAdmin) return;
    supabase
      .from("profiles")
      .select("id, nome")
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => {
        setUsers((data ?? []) as { id: string; nome: string }[]);
      });
  }, [isAdmin]);

  // Load registros for the selected day (used when viewing another user OR another day)
  useEffect(() => {
    if (!effectiveUserId) {
      setDayRecords([]);
      return;
    }
    // When viewing own + today, the realtime session hook already provides records — keep it in sync via setter too.
    if (isToday && !viewingOther) {
      setDayRecords([]);
      return;
    }
    supabase
      .from("registros_atividade")
      .select("*")
      .eq("usuario_id", effectiveUserId)
      .gte("inicio", dayRange.start)
      .lt("inicio", dayRange.end)
      .order("inicio", { ascending: true })
      .then(({ data }) => setDayRecords((data ?? []) as Registro[]));
    // when looking at today (own/other), also poll
  }, [
    effectiveUserId,
    viewingOther,
    isToday,
    dayRange.start,
    dayRange.end,
    isToday ? now.getMinutes() : 0,
  ]);

  // Page navigation (app) + external (chrome extension) — for the selected day
  useEffect(() => {
    if (!effectiveUserId) return;
    supabase
      .from("navegacao_paginas")
      .select("*")
      .eq("usuario_id", effectiveUserId)
      .gte("inicio", dayRange.start)
      .lt("inicio", dayRange.end)
      .order("inicio", { ascending: true })
      .then(({ data }) => setPages((data ?? []) as Pagina[]));
    supabase
      .from("navegacao_externa")
      .select("*")
      .eq("usuario_id", effectiveUserId)
      .gte("inicio", dayRange.start)
      .lt("inicio", dayRange.end)
      .order("inicio", { ascending: true })
      .then(({ data }) => setExternalNav((data ?? []) as NavExterna[]));
    supabase
      .from("uso_aplicativos")
      .select("id, process_name, app_label, inicio, fim, duracao_segundos, inativo_segundos")
      .eq("usuario_id", effectiveUserId)
      .gte("inicio", dayRange.start)
      .lt("inicio", dayRange.end)
      .order("inicio", { ascending: true })
      .then(({ data }) => setAppUsage((data ?? []) as UsoApp[]));
  }, [effectiveUserId, dayRange.start, dayRange.end, isToday ? now.getMinutes() : 0]);

  // 30-day history for effective user — keep raw records grouped per day for the per-day timelines
  useEffect(() => {
    if (!effectiveUserId) {
      setHistory30([]);
      return;
    }
    const since = new Date();
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);
    supabase
      .from("registros_atividade")
      .select("*")
      .eq("usuario_id", effectiveUserId)
      .gte("inicio", since.toISOString())
      .order("inicio", { ascending: true })
      .then(({ data }) => {
        const map = new Map<string, Registro[]>();
        (data ?? []).forEach((r) => {
          const d = new Date(r.inicio);
          d.setHours(0, 0, 0, 0);
          const key = d.toISOString();
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(r as Registro);
        });
        const arr = Array.from(map.entries())
          .map(([k, records]) => ({ date: new Date(k), records }))
          .sort((a, b) => b.date.getTime() - a.date.getTime());
        setHistory30(arr);
      });
  }, [effectiveUserId, session.current?.id]);

  // Records to display on the board for the selected day
  const todayRecords: Registro[] = isToday && !viewingOther ? session.todayRecords : dayRecords;
  // Used as a fallback for the "other user today" legacy var
  void otherRecords;

  const totals = useMemo(() => {
    const t = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
    const nowTs = Date.now();
    todayRecords.forEach((r) => {
      const dur =
        r.duracao_minutos ??
        (r.fim
          ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000
          : (nowTs - new Date(r.inicio).getTime()) / 60000);
      if (r.status in t) t[r.status as keyof typeof t] += dur;
    });
    return t;
  }, [todayRecords, now]);

  const totalOnline = totals.ATIVO + totals.PAUSA + totals.ALMOCO + totals.INATIVO;

  // Aggregate navigation by DOMAIN (combines app pages + chrome external nav)
  const domainAgg = useMemo(() => {
    type PageRow = { label: string; path: string; total: number; idle: number; visits: number };
    type DomainRow = {
      domain: string;
      origem: Origem | "misto";
      total: number;
      idle: number;
      visits: number;
      pages: Map<string, PageRow>;
    };
    const APP_DOMAIN = "App interno";
    const m = new Map<string, DomainRow>();

    const upsert = (
      domain: string,
      origem: Origem,
      key: string,
      label: string,
      path: string,
      dur: number,
      idle: number,
    ) => {
      let d = m.get(domain);
      if (!d) {
        d = { domain, origem, total: 0, idle: 0, visits: 0, pages: new Map() };
        m.set(domain, d);
      } else if (d.origem !== origem) {
        d.origem = "misto";
      }
      d.total += dur;
      d.idle += idle;
      d.visits += 1;
      const p = d.pages.get(key);
      if (p) {
        p.total += dur;
        p.idle += idle;
        p.visits += 1;
      } else d.pages.set(key, { label, path, total: dur, idle, visits: 1 });
    };

    pages.forEach((p) => {
      const dur = safeDur(p.duracao_segundos, p.inicio, p.fim);
      upsert(APP_DOMAIN, "app", p.path, p.title ?? p.path, p.path, dur, p.inativo_segundos || 0);
    });
    externalNav.forEach((n) => {
      const dur = safeDur(n.duracao_segundos, n.inicio, n.fim);
      upsert(
        n.domain || "desconhecido",
        "chrome",
        n.url,
        n.title ?? n.url,
        n.url,
        dur,
        n.inativo_segundos || 0,
      );
    });
    appUsage.forEach((a) => {
      const dur = safeDur(a.duracao_segundos, a.inicio, a.fim);
      const label = a.app_label || a.process_name;
      upsert(label, "desktop", a.process_name, label, a.process_name, dur, a.inativo_segundos || 0);
    });

    return Array.from(m.values())
      .map((d) => ({ ...d, pages: Array.from(d.pages.values()).sort((a, b) => b.total - a.total) }))
      .sort((a, b) => b.total - a.total);
  }, [pages, externalNav, appUsage, now]);

  // Unified log: merge app pages + external chrome nav, sorted desc by inicio.
  // Used only for the detailed export — on screen we show a consolidated view.
  const unifiedLogs: UnifiedLog[] = useMemo(() => {
    const appLogs: UnifiedLog[] = pages.map((p) => {
      const dur = safeDur(p.duracao_segundos, p.inicio, p.fim);
      return {
        id: `a:${p.id}`,
        origem: "app",
        label: p.title ?? p.path,
        sub: p.path,
        inicio: p.inicio,
        fim: p.fim,
        duracao: dur,
        inativo: p.inativo_segundos || 0,
      };
    });
    const extLogs: UnifiedLog[] = externalNav.map((n) => {
      const dur = safeDur(n.duracao_segundos, n.inicio, n.fim);
      return {
        id: `e:${n.id}`,
        origem: "chrome",
        label: n.title ?? n.domain,
        sub: n.domain,
        inicio: n.inicio,
        fim: n.fim,
        duracao: dur,
        inativo: n.inativo_segundos || 0,
      };
    });
    const deskLogs: UnifiedLog[] = appUsage.map((a) => {
      const dur = safeDur(a.duracao_segundos, a.inicio, a.fim);
      const label = a.app_label || a.process_name;
      return {
        id: `d:${a.id}`,
        origem: "desktop",
        label,
        sub: label,
        inicio: a.inicio,
        fim: a.fim,
        duracao: dur,
        inativo: a.inativo_segundos || 0,
      };
    });
    return [...appLogs, ...extLogs, ...deskLogs].sort(
      (a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime(),
    );
  }, [pages, externalNav, appUsage, now]);

  // Consolidated log: groups by origem + sub (path/domain), aggregating visits, total and idle.
  const consolidatedLogs = useMemo(() => {
    const m = new Map<
      string,
      {
        origem: Origem;
        label: string;
        sub: string;
        visitas: number;
        total: number;
        inativo: number;
        ultimo: string;
      }
    >();
    for (const l of unifiedLogs) {
      const key = `${l.origem}::${l.sub}`;
      const cur = m.get(key);
      if (cur) {
        cur.visitas += 1;
        cur.total += l.duracao;
        cur.inativo += l.inativo;
        if (new Date(l.inicio).getTime() > new Date(cur.ultimo).getTime()) {
          cur.ultimo = l.inicio;
          cur.label = l.label;
        }
      } else {
        m.set(key, {
          origem: l.origem,
          label: l.label,
          sub: l.sub,
          visitas: 1,
          total: l.duracao,
          inativo: l.inativo,
          ultimo: l.inicio,
        });
      }
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [unifiedLogs]);

  // Totais por ORIGEM (App interno / Chrome / Desktop). Cada dimensão é
  // independente — nunca somamos entre origens (elas se sobrepõem no tempo).
  const sourceTotals = useMemo(() => {
    const agg = (origem: Origem) => {
      const rows = unifiedLogs.filter((l) => l.origem === origem);
      const dur = rows.reduce((a, r) => a + r.duracao, 0);
      const idle = rows.reduce((a, r) => a + r.inativo, 0);
      return { dur, idle, trabalhado: tempoTrabalhado(dur, idle) };
    };
    return { app: agg("app"), chrome: agg("chrome"), desktop: agg("desktop") };
  }, [unifiedLogs]);

  const exportNavLogs = () => {
    const rows = unifiedLogs.map((l) => ({
      Origem: l.origem === "app" ? "App" : l.origem === "chrome" ? "Chrome" : "Desktop",
      Início: formatHM(l.inicio),
      Fim: l.fim ? formatHM(l.fim) : "Em andamento",
      Título: l.label,
      "URL/Path": l.sub,
      "Duração (s)": Math.round(l.duracao),
      "Inativo (s)": Math.round(l.inativo),
      "Trabalhado (s)": Math.round(tempoTrabalhado(l.duracao, l.inativo)),
    }));
    import("xlsx").then((XLSX) => {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Navegação");
      const day = selectedDate.toISOString().slice(0, 10);
      XLSX.writeFile(wb, `navegacao-${day}.xlsx`);
    });
  };

  const currentOpen =
    isToday && !viewingOther ? session.current : (todayRecords.find((r) => !r.fim) ?? null);
  const status = currentOpen?.status ?? "ENCERRADO";

  const pieData = [
    { name: "Ativo", value: totals.ATIVO, color: "var(--color-success)" },
    { name: "Pausa", value: totals.PAUSA, color: "var(--color-warning)" },
    { name: "Almoço", value: totals.ALMOCO, color: "var(--color-info)" },
    { name: "Inativo", value: totals.INATIVO, color: "var(--color-destructive)" },
  ].filter((d) => d.value > 0);

  const canStart = !session.current || session.current.status === "ENCERRADO";
  const isActive = status === "ATIVO";
  const isPaused = status === "PAUSA" || status === "ALMOCO" || status === "INATIVO";

  const selectedUser = users.find((u) => u.id === targetUserId);
  const displayName = viewingOther ? (selectedUser?.nome ?? "Usuário") : (profile?.nome ?? "...");

  return (
    <div className="space-y-6">
      {!viewingOther && <InactivityModal open={session.showInactive} onResume={session.resume} />}

      {/* Header card */}
      <Card>
        <CardContent className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              {viewingOther ? "Visualizando" : "Bem-vindo,"}
            </p>
            <h1 className="text-2xl font-bold">{displayName}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>
                {now.toLocaleDateString("pt-BR", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <span className="font-mono text-lg font-semibold text-foreground">
                {now.toLocaleTimeString("pt-BR")}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <StatusBadge status={status} />
            {currentOpen && (
              <span className="text-xs text-muted-foreground">
                desde {formatHM(currentOpen.inicio)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Day + (admin) user filter */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-medium">
            {isToday
              ? "Visualizando dados de hoje"
              : `Visualizando ${selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                const d = new Date(selectedDate);
                d.setDate(d.getDate() - 1);
                setSelectedDate(d);
              }}
              aria-label="Dia anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-[220px] justify-start text-left font-normal")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate.toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(d) => {
                    if (d) {
                      const x = new Date(d);
                      x.setHours(0, 0, 0, 0);
                      setSelectedDate(x);
                    }
                  }}
                  disabled={(d) => d > new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                const d = new Date(selectedDate);
                d.setDate(d.getDate() + 1);
                if (d <= startOfToday) setSelectedDate(d);
              }}
              disabled={isToday}
              aria-label="Próximo dia"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isToday && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedDate(startOfToday)}>
                Hoje
              </Button>
            )}
            {isAdmin && (
              <Select
                value={targetUserId || "self"}
                onValueChange={(v) => setTargetUserId(v === "self" ? "" : v)}
              >
                <SelectTrigger className="w-60">
                  <SelectValue placeholder="Selecionar usuário" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Eu mesmo ({profile?.nome ?? "..."})</SelectItem>
                  {users
                    .filter((u) => u.id !== user?.id)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Controls — only when viewing own dashboard for today */}
      {!viewingOther && isToday && (
        <Card>
          <CardHeader>
            <CardTitle>Controles</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={session.start} disabled={!canStart} size="lg">
              <Play className="mr-2 h-4 w-4" /> Iniciar Expediente
            </Button>
            <Button
              onClick={() => setBreakDialog({ kind: "PAUSA" })}
              disabled={!isActive}
              variant="secondary"
              size="lg"
            >
              <Pause className="mr-2 h-4 w-4" /> Pausa
            </Button>
            <Button
              onClick={() => setBreakDialog({ kind: "ALMOCO" })}
              disabled={!isActive}
              variant="secondary"
              size="lg"
            >
              <Utensils className="mr-2 h-4 w-4" /> Almoço
            </Button>
            <Button onClick={session.resume} disabled={!isPaused} variant="default" size="lg">
              <Coffee className="mr-2 h-4 w-4" /> Retornar
            </Button>
            <Button onClick={session.stop} disabled={canStart} variant="destructive" size="lg">
              <Square className="mr-2 h-4 w-4" /> Encerrar
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!breakDialog}
        onOpenChange={(o) => {
          if (!o) {
            setBreakDialog(null);
            setBreakReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {breakDialog?.kind === "ALMOCO" ? "Iniciar almoço" : "Iniciar pausa"}
            </DialogTitle>
            <DialogDescription>Informe uma justificativa antes de continuar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="break-reason">Justificativa</Label>
            <Textarea
              id="break-reason"
              value={breakReason}
              onChange={(e) => setBreakReason(e.target.value)}
              placeholder={
                breakDialog?.kind === "ALMOCO" ? "Ex: horário de almoço" : "Ex: pausa para café"
              }
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={breakBusy || breakReason.trim().length < 3}
              onClick={async () => {
                if (!breakDialog) return;
                setBreakBusy(true);
                try {
                  const reason = breakReason.trim();
                  if (breakDialog.kind === "PAUSA") await session.pause(reason);
                  else await session.lunch(reason);
                  setBreakDialog(null);
                  setBreakReason("");
                } finally {
                  setBreakBusy(false);
                }
              }}
            >
              {breakBusy ? "..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={<ActivityIcon className="h-4 w-4" />}
          label="Trabalhadas"
          value={formatDuration(totals.ATIVO)}
          accent="success"
        />
        <StatCard
          icon={<Pause className="h-4 w-4" />}
          label="Pausa"
          value={formatDuration(totals.PAUSA)}
          accent="warning"
        />
        <StatCard
          icon={<Utensils className="h-4 w-4" />}
          label="Almoço"
          value={formatDuration(totals.ALMOCO)}
          accent="info"
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Inativo"
          value={formatDuration(totals.INATIVO)}
          accent="destructive"
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Total online"
          value={formatDuration(totalOnline)}
          accent="primary"
        />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Distribuição {isToday ? "de hoje" : "do dia"}</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Nenhum dado hoje.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={100}
                  >
                    {pieData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatDuration(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jornada {isToday ? "de hoje" : "do dia"} — linha do tempo</CardTitle>
          </CardHeader>
          <CardContent>
            {todayRecords.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Sem registros.</p>
            ) : (
              <HorizontalTimeline records={todayRecords} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monitoração — Web vs Desktop + rankings */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Web vs Desktop</CardTitle>
          </CardHeader>
          <CardContent>
            {webVsDesktop.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Sem dados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={webVsDesktop}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={90}
                  >
                    {webVsDesktop.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number, n: string) => [formatSeconds(v as number), n]}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Distribuição do tempo trabalhado entre páginas web (app + Chrome) e apps desktop.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <CardTitle>Top sites visitados</CardTitle>
          </CardHeader>
          <CardContent>
            {topSites.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nenhuma navegação no dia.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, topSites.length * 32)}>
                <BarChart data={topSites} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => formatSeconds(v as number)} />
                  <YAxis
                    type="category"
                    dataKey="domain"
                    width={120}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v: number, n: string) => [
                      formatSeconds(v as number),
                      n === "trabalhado" ? "Trabalhado" : "Inativo",
                    ]}
                  />
                  <Bar dataKey="trabalhado" stackId="t" fill="var(--color-success)" />
                  <Bar dataKey="idle" stackId="t" fill="var(--color-destructive)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Monitor className="h-4 w-4 text-info" />
            <CardTitle>Top 5 apps desktop</CardTitle>
          </CardHeader>
          <CardContent>
            {topApps.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Sem uso de apps desktop.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, topApps.length * 38)}>
                <BarChart data={topApps} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => formatSeconds(v as number)} />
                  <YAxis
                    type="category"
                    dataKey="app"
                    width={120}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v: number, n: string) => [
                      formatSeconds(v as number),
                      n === "trabalhado" ? "Trabalhado" : "Inativo",
                    ]}
                  />
                  <Bar dataKey="trabalhado" stackId="t" fill="var(--color-info)" />
                  <Bar dataKey="idle" stackId="t" fill="var(--color-destructive)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Resumo de fontes — números rápidos */}
      <div className="grid gap-4 md:grid-cols-3">
        <SourceCard
          icon={<Globe className="h-4 w-4" />}
          label="App interno"
          accent="primary"
          trabalhado={sourceTotals.app.trabalhado}
          idle={sourceTotals.app.idle}
        />
        <SourceCard
          icon={<Chrome className="h-4 w-4" />}
          label="Chrome (extensão)"
          accent="warning"
          trabalhado={sourceTotals.chrome.trabalhado}
          idle={sourceTotals.chrome.idle}
        />
        <SourceCard
          icon={<Monitor className="h-4 w-4" />}
          label="Desktop"
          accent="info"
          trabalhado={sourceTotals.desktop.trabalhado}
          idle={sourceTotals.desktop.idle}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <CardTitle>Histórico — últimos 30 dias</CardTitle>
        </CardHeader>
        <CardContent>
          {history30.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Sem histórico.</p>
          ) : (
            <div className="space-y-5">
              {history30.map((day) => {
                const totals = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
                day.records.forEach((r) => {
                  const dur =
                    r.duracao_minutos ??
                    (r.fim
                      ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000
                      : 0);
                  if (r.status in totals) totals[r.status as keyof typeof totals] += dur;
                });
                const isSelected = day.date.getTime() === selectedDate.getTime();
                return (
                  <div
                    key={day.date.toISOString()}
                    className={cn(
                      "rounded-lg border p-4 transition-colors",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-muted/10 hover:bg-muted/20",
                    )}
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <button
                        onClick={() => setSelectedDate(day.date)}
                        className="text-left text-sm font-semibold hover:text-primary"
                      >
                        {day.date.toLocaleDateString("pt-BR", {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </button>
                      <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-muted-foreground">
                        <span className="text-success">A {formatDuration(totals.ATIVO)}</span>
                        <span className="text-warning">P {formatDuration(totals.PAUSA)}</span>
                        <span className="text-info">Al {formatDuration(totals.ALMOCO)}</span>
                        <span className="text-destructive">I {formatDuration(totals.INATIVO)}</span>
                      </div>
                    </div>
                    <HorizontalTimeline records={day.records} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  const colors: Record<string, string> = {
    success: "var(--color-success)",
    warning: "var(--color-warning)",
    info: "var(--color-info)",
    destructive: "var(--color-destructive)",
    primary: "var(--color-primary)",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span
            className="grid h-8 w-8 place-items-center rounded-md"
            style={{
              background: `color-mix(in oklch, ${colors[accent]} 15%, transparent)`,
              color: colors[accent],
            }}
          >
            {icon}
          </span>
        </div>
        <div className="mt-3 text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function HorizontalTimeline({ records }: { records: Registro[] }) {
  const colorByStatus: Record<string, string> = {
    ATIVO: "var(--color-success)",
    PAUSA: "var(--color-warning)",
    ALMOCO: "var(--color-info)",
    INATIVO: "var(--color-destructive)",
    ENCERRADO: "var(--color-muted)",
  };
  const labelByStatus: Record<string, string> = {
    ATIVO: "Ativo",
    PAUSA: "Pausa",
    ALMOCO: "Almoço",
    INATIVO: "Inativo",
    ENCERRADO: "Encerrado",
  };

  const nowTs = Date.now();
  // Day window: 00:00 → 24:00 of the day of the first record
  const dayBase = new Date(records[0]?.inicio ?? Date.now());
  dayBase.setHours(0, 0, 0, 0);
  const axisStart = dayBase.getTime();
  const axisEnd = axisStart + 24 * 3600_000;
  const clamp = (ts: number) => Math.max(axisStart, Math.min(axisEnd, ts));

  // Dynamic piecewise scale: the worked window expands to fill ~70% of the track,
  // while the idle periods before/after compress into the remaining 30%.
  const ativoRecsAll = records.filter((r) => r.status === "ATIVO");
  const workStartTs = ativoRecsAll.length
    ? Math.min(...ativoRecsAll.map((r) => new Date(r.inicio).getTime()))
    : null;
  const workEndTs = ativoRecsAll.length
    ? Math.max(...ativoRecsAll.map((r) => (r.fim ? new Date(r.fim).getTime() : nowTs)))
    : null;

  // Expand work window by 30min padding on each side for breathing room
  const pad = 30 * 60_000;
  const wStart = workStartTs != null ? Math.max(axisStart, workStartTs - pad) : axisStart;
  const wEnd = workEndTs != null ? Math.min(axisEnd, workEndTs + pad) : axisEnd;
  const hasWork = workStartTs != null && workEndTs != null && wEnd > wStart;

  // Width allocation (in % of track)
  const WORK_PCT = hasWork ? 72 : 100;
  const beforeDur = wStart - axisStart;
  const afterDur = axisEnd - wEnd;
  const idleTotal = beforeDur + afterDur;
  const idlePct = 100 - WORK_PCT;
  const beforePct = hasWork && idleTotal > 0 ? (beforeDur / idleTotal) * idlePct : 0;
  const afterPct = hasWork && idleTotal > 0 ? (afterDur / idleTotal) * idlePct : 0;
  const workDur = Math.max(1, wEnd - wStart);

  const pct = (tsRaw: number) => {
    const ts = clamp(tsRaw);
    if (!hasWork) return ((ts - axisStart) / (axisEnd - axisStart)) * 100;
    if (ts <= wStart) {
      return beforeDur > 0 ? ((ts - axisStart) / beforeDur) * beforePct : 0;
    }
    if (ts >= wEnd) {
      return beforePct + WORK_PCT + (afterDur > 0 ? ((ts - wEnd) / afterDur) * afterPct : 0);
    }
    return beforePct + ((ts - wStart) / workDur) * WORK_PCT;
  };

  // Inverse: % -> timestamp (for hover)
  const tsFromPct = (p: number) => {
    if (!hasWork) return axisStart + (p / 100) * (axisEnd - axisStart);
    if (p <= beforePct) {
      return axisStart + (beforePct > 0 ? (p / beforePct) * beforeDur : 0);
    }
    if (p >= beforePct + WORK_PCT) {
      const rem = p - (beforePct + WORK_PCT);
      return wEnd + (afterPct > 0 ? (rem / afterPct) * afterDur : 0);
    }
    return wStart + ((p - beforePct) / WORK_PCT) * workDur;
  };

  // Ticks: hourly inside the work window (dense), every 3h outside (sparse)
  const majorTicks: number[] = [];
  const minorTicks: number[] = [];
  for (let h = 0; h <= 24; h += 1) {
    const t = axisStart + h * 3600_000;
    const insideWork = hasWork && t >= wStart && t <= wEnd;
    if (insideWork) {
      minorTicks.push(t);
      if (h % 1 === 0) majorTicks.push(t);
    } else if (h % 3 === 0) {
      majorTicks.push(t);
    }
  }

  // Highlighted worked window (reuses already-computed bounds)
  const ativoStart = workStartTs;
  const ativoEnd = workEndTs;

  const trackRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ x: number; ts: number; rec: Registro | null } | null>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const p = (x / rect.width) * 100;
    const ts = tsFromPct(p);
    const rec =
      records.find((r) => {
        const s = new Date(r.inicio).getTime();
        const en = r.fim ? new Date(r.fim).getTime() : nowTs;
        return ts >= s && ts <= en;
      }) ?? null;
    setHover({ x, ts, rec });
  };

  // ATIVO occupies the central band (tall); other statuses render as thin strips, centered
  const dimsForStatus = (s: string) =>
    s === "ATIVO" ? { top: "18%", bottom: "18%" } : { top: "40%", bottom: "40%" };

  return (
    <div className="space-y-2">
      <div
        ref={trackRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="relative h-16 w-full overflow-hidden rounded-md border border-border bg-muted/30"
      >
        {/* Highlighted "zoom" band over the worked window */}
        {hasWork && (
          <div
            className="absolute top-0 bottom-0 bg-success/5"
            style={{
              left: `${beforePct}%`,
              width: `${WORK_PCT}%`,
              borderLeft: "1px dashed color-mix(in oklch, var(--color-success) 40%, transparent)",
              borderRight: "1px dashed color-mix(in oklch, var(--color-success) 40%, transparent)",
            }}
          />
        )}

        {/* central baseline reinforcing the worked-time band */}
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border/60" />

        {/* hour minor gridlines */}
        {minorTicks.map((t) => (
          <div
            key={`m-${t}`}
            className="absolute top-0 bottom-0 w-px bg-border/30"
            style={{ left: `${pct(t)}%` }}
          />
        ))}
        {/* 3h major gridlines */}
        {majorTicks.map((t) => (
          <div
            key={`g-${t}`}
            className="absolute top-0 bottom-0 w-px bg-border/70"
            style={{ left: `${pct(t)}%` }}
          />
        ))}

        {/* Segments — ATIVO is the dominant centered band, others compress */}
        {records.map((r) => {
          const s = new Date(r.inicio).getTime();
          const e = r.fim ? new Date(r.fim).getTime() : nowTs;
          if (e <= axisStart || s >= axisEnd) return null;
          const left = pct(s);
          const width = Math.max(pct(e) - left, 0.2);
          const isAtivo = r.status === "ATIVO";
          const d = dimsForStatus(r.status);
          return (
            <div
              key={r.id}
              className="absolute rounded-sm transition-opacity hover:opacity-90"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: d.top,
                bottom: d.bottom,
                background: colorByStatus[r.status] ?? "var(--color-muted)",
                opacity: isAtivo ? 1 : 0.65,
                zIndex: isAtivo ? 2 : 1,
                boxShadow: isAtivo
                  ? "0 0 0 1px color-mix(in oklch, var(--color-success) 50%, transparent)"
                  : undefined,
              }}
            />
          );
        })}

        {/* Start / End markers for the worked period */}
        {ativoStart != null && (
          <Marker
            x={pct(ativoStart)}
            label={`Início ${formatHM(new Date(ativoStart).toISOString())}`}
          />
        )}
        {ativoEnd != null && (
          <Marker x={pct(ativoEnd)} label={`Fim ${formatHM(new Date(ativoEnd).toISOString())}`} />
        )}

        {/* "now" marker */}
        {nowTs >= axisStart && nowTs <= axisEnd && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-foreground/70"
            style={{ left: `${pct(nowTs)}%` }}
          />
        )}

        {/* hover cursor + tooltip */}
        {hover && (
          <>
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground/40"
              style={{ left: hover.x }}
            />
            <div
              className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-mono text-popover-foreground shadow-md"
              style={{ left: hover.x }}
            >
              <div className="font-semibold">
                {new Date(hover.ts).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
              {hover.rec ? (
                <div className="text-muted-foreground">
                  {labelByStatus[hover.rec.status] ?? hover.rec.status} •{" "}
                  {formatHM(hover.rec.inicio)} → {hover.rec.fim ? formatHM(hover.rec.fim) : "agora"}
                </div>
              ) : (
                <div className="text-muted-foreground">Offline</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* axis labels every 3h covering 00:00 → 24:00 */}
      <div className="relative h-4 w-full text-[10px] text-muted-foreground">
        {majorTicks.map((t, i) => {
          const left = pct(t);
          const isLast = i === majorTicks.length - 1;
          return (
            <span
              key={`l-${t}`}
              className="absolute font-mono"
              style={{
                left: `${left}%`,
                transform: isLast
                  ? "translateX(-100%)"
                  : i === 0
                    ? "translateX(0)"
                    : "translateX(-50%)",
              }}
            >
              {new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          );
        })}
      </div>

      {/* legend — visually mirrors the compression of non-ativo statuses */}
      <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
        {(["ATIVO", "PAUSA", "ALMOCO", "INATIVO"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              className="rounded-sm"
              style={{
                background: colorByStatus[s],
                width: s === "ATIVO" ? "14px" : "10px",
                height: s === "ATIVO" ? "10px" : "4px",
                opacity: s === "ATIVO" ? 1 : 0.65,
              }}
            />
            {s === "ALMOCO" ? "Almoço" : s.charAt(0) + s.slice(1).toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

function Marker({ x, label }: { x: number; label: string }) {
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 z-[3]" style={{ left: `${x}%` }}>
      <div className="absolute top-0 bottom-0 w-0.5 bg-success" />
      <div className="absolute top-0.5 left-1 whitespace-nowrap rounded-sm bg-success px-1.5 py-0.5 text-[10px] font-mono font-semibold text-success-foreground shadow">
        {label}
      </div>
    </div>
  );
}
