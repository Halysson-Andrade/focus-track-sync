import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentSession } from "@/hooks/use-current-session";
import { StatusBadge } from "@/components/StatusBadge";
import { InactivityModal } from "@/components/InactivityModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Coffee, Pause, Play, Square, Utensils, Clock, TrendingUp, Activity as ActivityIcon, AlertTriangle, MousePointer2, Chrome, Globe, Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDuration, formatHM } from "@/lib/format";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard — Controle de Atividade" }] }),
  component: Dashboard,
});

type Registro = {
  id: string; status: string; inicio: string; fim: string | null; duracao_minutos: number | null;
};
type Pagina = {
  id: string; path: string; title: string | null; inicio: string; fim: string | null;
  duracao_segundos: number | null; inativo_segundos: number;
};
type NavExterna = {
  id: string; url: string; domain: string; title: string | null; inicio: string; fim: string | null;
  duracao_segundos: number | null; inativo_segundos: number;
};
type UnifiedLog = {
  id: string; origem: "app" | "chrome"; label: string; sub: string;
  inicio: string; fim: string | null; duracao: number; inativo: number;
};

function formatSeconds(s: number) {
  if (!s || s < 60) return `${Math.round(s)}s`;
  return formatDuration(s / 60);
}

function Dashboard() {
  const { user, profile, isAdmin } = useAuth();
  const session = useCurrentSession(user?.id);
  const [now, setNow] = useState(new Date());
  const [history30, setHistory30] = useState<{ date: Date; records: Registro[] }[]>([]);

  // Selected day (defaults to today). When != today, dashboard shows historic data.
  const startOfToday = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday);
  const isToday = selectedDate.getTime() === startOfToday.getTime();
  const dayRange = useMemo(() => {
    const s = new Date(selectedDate); s.setHours(0,0,0,0);
    const e = new Date(s); e.setDate(e.getDate() + 1);
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

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  // Load users list for admin filter
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("profiles").select("id, nome").eq("ativo", true).order("nome").then(({ data }) => {
      setUsers((data ?? []) as { id: string; nome: string }[]);
    });
  }, [isAdmin]);

  // Load registros for the selected day (used when viewing another user OR another day)
  useEffect(() => {
    if (!effectiveUserId) { setDayRecords([]); return; }
    // When viewing own + today, the realtime session hook already provides records — keep it in sync via setter too.
    if (isToday && !viewingOther) { setDayRecords([]); return; }
    supabase.from("registros_atividade").select("*")
      .eq("usuario_id", effectiveUserId)
      .gte("inicio", dayRange.start)
      .lt("inicio", dayRange.end)
      .order("inicio", { ascending: true })
      .then(({ data }) => setDayRecords((data ?? []) as Registro[]));
    // when looking at today (own/other), also poll
  }, [effectiveUserId, viewingOther, isToday, dayRange.start, dayRange.end, isToday ? now.getMinutes() : 0]);

  // Page navigation (app) + external (chrome extension) — for the selected day
  useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from("navegacao_paginas").select("*")
      .eq("usuario_id", effectiveUserId).gte("inicio", dayRange.start).lt("inicio", dayRange.end)
      .order("inicio", { ascending: true })
      .then(({ data }) => setPages((data ?? []) as Pagina[]));
    supabase.from("navegacao_externa").select("*")
      .eq("usuario_id", effectiveUserId).gte("inicio", dayRange.start).lt("inicio", dayRange.end)
      .order("inicio", { ascending: true })
      .then(({ data }) => setExternalNav((data ?? []) as NavExterna[]));
  }, [effectiveUserId, dayRange.start, dayRange.end, isToday ? now.getMinutes() : 0]);

  // 30-day history for effective user — keep raw records grouped per day for the per-day timelines
  useEffect(() => {
    if (!effectiveUserId) { setHistory30([]); return; }
    const since = new Date(); since.setDate(since.getDate() - 30); since.setHours(0,0,0,0);
    supabase.from("registros_atividade").select("*")
      .eq("usuario_id", effectiveUserId)
      .gte("inicio", since.toISOString())
      .order("inicio", { ascending: true })
      .then(({ data }) => {
        const map = new Map<string, Registro[]>();
        (data ?? []).forEach((r: any) => {
          const d = new Date(r.inicio); d.setHours(0,0,0,0);
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
  const todayRecords: Registro[] = (isToday && !viewingOther) ? session.todayRecords : dayRecords;
  // Used as a fallback for the "other user today" legacy var
  void otherRecords;

  const totals = useMemo(() => {
    const t = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
    const nowTs = Date.now();
    todayRecords.forEach((r) => {
      const dur = r.duracao_minutos ?? (r.fim ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000 : (nowTs - new Date(r.inicio).getTime()) / 60000);
      if (r.status in t) t[r.status as keyof typeof t] += dur;
    });
    return t;
  }, [todayRecords, now]);

  const totalOnline = totals.ATIVO + totals.PAUSA + totals.ALMOCO + totals.INATIVO;

  // Aggregate page time
  const pageAgg = useMemo(() => {
    const m = new Map<string, { path: string; title: string; total: number; idle: number; visits: number }>();
    pages.forEach((p) => {
      const dur = p.duracao_segundos ?? (p.fim ? (new Date(p.fim).getTime() - new Date(p.inicio).getTime()) / 1000 : (Date.now() - new Date(p.inicio).getTime()) / 1000);
      const key = p.path;
      if (!m.has(key)) m.set(key, { path: p.path, title: p.title ?? p.path, total: 0, idle: 0, visits: 0 });
      const b = m.get(key)!;
      b.total += dur;
      b.idle += p.inativo_segundos || 0;
      b.visits += 1;
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [pages, now]);

  // Unified log: merge app pages + external chrome nav, sorted desc by inicio
  const unifiedLogs: UnifiedLog[] = useMemo(() => {
    const nowTs = Date.now();
    const appLogs: UnifiedLog[] = pages.map((p) => {
      const dur = p.duracao_segundos ?? (p.fim ? (new Date(p.fim).getTime() - new Date(p.inicio).getTime()) / 1000 : (nowTs - new Date(p.inicio).getTime()) / 1000);
      return { id: `a:${p.id}`, origem: "app", label: p.title ?? p.path, sub: p.path, inicio: p.inicio, fim: p.fim, duracao: dur, inativo: p.inativo_segundos || 0 };
    });
    const extLogs: UnifiedLog[] = externalNav.map((n) => {
      const dur = n.duracao_segundos ?? (n.fim ? (new Date(n.fim).getTime() - new Date(n.inicio).getTime()) / 1000 : (nowTs - new Date(n.inicio).getTime()) / 1000);
      return { id: `e:${n.id}`, origem: "chrome", label: n.title ?? n.domain, sub: n.domain, inicio: n.inicio, fim: n.fim, duracao: dur, inativo: n.inativo_segundos || 0 };
    });
    return [...appLogs, ...extLogs].sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime());
  }, [pages, externalNav, now]);

  const sourceTotals = useMemo(() => {
    const sum = (rows: { duracao: number }[]) => rows.reduce((a, r) => a + r.duracao, 0);
    return {
      app: sum(unifiedLogs.filter((l) => l.origem === "app")),
      chrome: sum(unifiedLogs.filter((l) => l.origem === "chrome")),
    };
  }, [unifiedLogs]);


  const currentOpen = (isToday && !viewingOther) ? session.current : (todayRecords.find((r) => !r.fim) ?? null);
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
            <p className="text-sm text-muted-foreground">{viewingOther ? "Visualizando" : "Bem-vindo,"}</p>
            <h1 className="text-2xl font-bold">{displayName}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</span>
              <span className="font-mono text-lg font-semibold text-foreground">{now.toLocaleTimeString("pt-BR")}</span>
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <StatusBadge status={status} />
            {currentOpen && (
              <span className="text-xs text-muted-foreground">desde {formatHM(currentOpen.inicio)}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Day + (admin) user filter */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-medium">
            {isToday ? "Visualizando dados de hoje" : `Visualizando ${selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline" size="icon"
              onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d); }}
              aria-label="Dia anterior"
            ><ChevronLeft className="h-4 w-4" /></Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-[220px] justify-start text-left font-normal")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(d) => { if (d) { const x = new Date(d); x.setHours(0,0,0,0); setSelectedDate(x); } }}
                  disabled={(d) => d > new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="outline" size="icon"
              onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); if (d <= startOfToday) setSelectedDate(d); }}
              disabled={isToday}
              aria-label="Próximo dia"
            ><ChevronRight className="h-4 w-4" /></Button>
            {!isToday && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedDate(startOfToday)}>Hoje</Button>
            )}
            {isAdmin && (
              <Select value={targetUserId || "self"} onValueChange={(v) => setTargetUserId(v === "self" ? "" : v)}>
                <SelectTrigger className="w-60"><SelectValue placeholder="Selecionar usuário" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Eu mesmo ({profile?.nome ?? "..."})</SelectItem>
                  {users.filter((u) => u.id !== user?.id).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>
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
          <CardHeader><CardTitle>Controles</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={session.start} disabled={!canStart} size="lg">
              <Play className="mr-2 h-4 w-4" /> Iniciar Expediente
            </Button>
            <Button onClick={session.pause} disabled={!isActive} variant="secondary" size="lg">
              <Pause className="mr-2 h-4 w-4" /> Pausa
            </Button>
            <Button onClick={session.lunch} disabled={!isActive} variant="secondary" size="lg">
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

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={<ActivityIcon className="h-4 w-4" />} label="Trabalhadas" value={formatDuration(totals.ATIVO)} accent="success" />
        <StatCard icon={<Pause className="h-4 w-4" />} label="Pausa" value={formatDuration(totals.PAUSA)} accent="warning" />
        <StatCard icon={<Utensils className="h-4 w-4" />} label="Almoço" value={formatDuration(totals.ALMOCO)} accent="info" />
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="Inativo" value={formatDuration(totals.INATIVO)} accent="destructive" />
        <StatCard icon={<Clock className="h-4 w-4" />} label="Total online" value={formatDuration(totalOnline)} accent="primary" />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Distribuição {isToday ? "de hoje" : "do dia"}</CardTitle></CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Nenhum dado hoje.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatDuration(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Jornada {isToday ? "de hoje" : "do dia"} — linha do tempo</CardTitle></CardHeader>
          <CardContent>
            {todayRecords.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Sem registros.</p>
            ) : (
              <HorizontalTimeline records={todayRecords} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Page navigation tracking */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2"><MousePointer2 className="h-4 w-4 text-primary" /><CardTitle>Navegação monitorada — {isToday ? "hoje" : "no dia"}</CardTitle></CardHeader>
        <CardContent>
          {pageAgg.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma navegação registrada.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-4">Página</th>
                    <th className="py-2 pr-4">Visitas</th>
                    <th className="py-2 pr-4">Tempo total</th>
                    <th className="py-2 pr-4">Inativo</th>
                    <th className="py-2">Ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {pageAgg.map((p) => (
                    <tr key={p.path} className="border-b border-border/50">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{p.title}</div>
                        <div className="font-mono text-xs text-muted-foreground">{p.path}</div>
                      </td>
                      <td className="py-2 pr-4">{p.visits}</td>
                      <td className="py-2 pr-4 font-mono">{formatSeconds(p.total)}</td>
                      <td className="py-2 pr-4 font-mono text-destructive">{formatSeconds(p.idle)}</td>
                      <td className="py-2 font-mono text-success">{formatSeconds(Math.max(0, p.total - p.idle))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unified navigation log */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Logs de navegação — últimas visitas</CardTitle>
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5">
                <Globe className="h-3 w-3" /> App {formatSeconds(sourceTotals.app)}
              </Badge>
              <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/5">
                <Chrome className="h-3 w-3" /> Chrome {formatSeconds(sourceTotals.chrome)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {unifiedLogs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sem logs. Instale a extensão para capturar navegação fora do app.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {unifiedLogs.slice(0, 30).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs text-muted-foreground shrink-0">{formatHM(l.inicio)}</span>
                    {l.origem === "app" ? (
                      <Badge variant="outline" className="gap-1 shrink-0 border-primary/40 text-primary"><Globe className="h-3 w-3" /> App</Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 shrink-0 border-warning/40 text-warning"><Chrome className="h-3 w-3" /> Chrome</Badge>
                    )}
                    <span className="font-medium truncate">{l.label}</span>
                    <span className="font-mono text-xs text-muted-foreground truncate">{l.sub}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span className="font-mono">{formatSeconds(l.duracao)}</span>
                    {l.inativo > 0 && <span className="font-mono text-destructive">idle {formatSeconds(l.inativo)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="flex flex-row items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /><CardTitle>Histórico — últimos 30 dias</CardTitle></CardHeader>
        <CardContent>
          {history30.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Sem histórico.</p>
          ) : (
            <div className="space-y-5">
              {history30.map((day) => {
                const totals = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
                day.records.forEach((r) => {
                  const dur = r.duracao_minutos ?? (r.fim ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000 : 0);
                  if (r.status in totals) totals[r.status as keyof typeof totals] += dur;
                });
                const isSelected = day.date.getTime() === selectedDate.getTime();
                return (
                  <div
                    key={day.date.toISOString()}
                    className={cn("rounded-lg border p-4 transition-colors", isSelected ? "border-primary bg-primary/5" : "border-border bg-muted/10 hover:bg-muted/20")}
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <button
                        onClick={() => setSelectedDate(day.date)}
                        className="text-left text-sm font-semibold hover:text-primary"
                      >
                        {day.date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
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

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    success: "var(--color-success)", warning: "var(--color-warning)", info: "var(--color-info)",
    destructive: "var(--color-destructive)", primary: "var(--color-primary)",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className="grid h-8 w-8 place-items-center rounded-md" style={{ background: `color-mix(in oklch, ${colors[accent]} 15%, transparent)`, color: colors[accent] }}>
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
    ATIVO: "Ativo", PAUSA: "Pausa", ALMOCO: "Almoço", INATIVO: "Inativo", ENCERRADO: "Encerrado",
  };

  const nowTs = Date.now();
  const startTs = Math.min(...records.map((r) => new Date(r.inicio).getTime()));
  const endTsRaw = Math.max(...records.map((r) => (r.fim ? new Date(r.fim).getTime() : nowTs)));
  const HOUR = 3600_000;
  const axisStart = Math.floor(startTs / HOUR) * HOUR;
  const axisEnd = Math.ceil(endTsRaw / HOUR) * HOUR;
  const span = Math.max(axisEnd - axisStart, HOUR);

  const ticks: number[] = [];
  for (let t = axisStart; t <= axisEnd; t += HOUR) ticks.push(t);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ x: number; ts: number; rec: Registro | null } | null>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = trackRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ts = axisStart + (x / rect.width) * span;
    const rec = records.find((r) => {
      const s = new Date(r.inicio).getTime();
      const en = r.fim ? new Date(r.fim).getTime() : nowTs;
      return ts >= s && ts <= en;
    }) ?? null;
    setHover({ x, ts, rec });
  };

  return (
    <div className="space-y-2">
      <div
        ref={trackRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="relative h-14 w-full overflow-hidden rounded-md border border-border bg-muted/30"
      >
        {ticks.map((t) => {
          const left = ((t - axisStart) / span) * 100;
          return <div key={`g-${t}`} className="absolute top-0 bottom-0 w-px bg-border/60" style={{ left: `${left}%` }} />;
        })}
        {records.map((r) => {
          const s = new Date(r.inicio).getTime();
          const e = r.fim ? new Date(r.fim).getTime() : nowTs;
          const left = ((s - axisStart) / span) * 100;
          const width = Math.max(((e - s) / span) * 100, 0.4);
          return (
            <div
              key={r.id}
              className="absolute top-2 bottom-2 rounded-sm transition-opacity hover:opacity-80"
              style={{ left: `${left}%`, width: `${width}%`, background: colorByStatus[r.status] ?? "var(--color-muted)" }}
            />
          );
        })}
        {nowTs >= axisStart && nowTs <= axisEnd && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/70" style={{ left: `${((nowTs - axisStart) / span) * 100}%` }} />
        )}
        {hover && (
          <>
            <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground/40" style={{ left: hover.x }} />
            <div
              className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-mono text-popover-foreground shadow-md"
              style={{ left: hover.x }}
            >
              <div className="font-semibold">
                {new Date(hover.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
              {hover.rec ? (
                <div className="text-muted-foreground">
                  {labelByStatus[hover.rec.status] ?? hover.rec.status} • {formatHM(hover.rec.inicio)} → {hover.rec.fim ? formatHM(hover.rec.fim) : "agora"}
                </div>
              ) : (
                <div className="text-muted-foreground">Offline</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* axis labels */}
      <div className="relative h-4 w-full text-[10px] text-muted-foreground">
        {ticks.map((t, i) => {
          const left = ((t - axisStart) / span) * 100;
          const isLast = i === ticks.length - 1;
          return (
            <span
              key={`l-${t}`}
              className="absolute font-mono"
              style={{
                left: `${left}%`,
                transform: isLast ? "translateX(-100%)" : i === 0 ? "translateX(0)" : "translateX(-50%)",
              }}
            >
              {new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          );
        })}
      </div>
      {/* legend */}
      <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
        {(["ATIVO", "PAUSA", "ALMOCO", "INATIVO"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorByStatus[s] }} />
            {s === "ALMOCO" ? "Almoço" : s.charAt(0) + s.slice(1).toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}
