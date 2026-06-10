import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentSession } from "@/hooks/use-current-session";
import { StatusBadge } from "@/components/StatusBadge";
import { InactivityModal } from "@/components/InactivityModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Coffee, Pause, Play, Square, Utensils, Clock, TrendingUp, Activity as ActivityIcon, AlertTriangle } from "lucide-react";
import { formatDuration, formatHM } from "@/lib/format";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard — Controle de Atividade" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user, profile } = useAuth();
  const session = useCurrentSession(user?.id);
  const [now, setNow] = useState(new Date());
  const [history30, setHistory30] = useState<{ date: string; ativo: number; pausa: number; almoco: number; inativo: number }[]>([]);

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const since = new Date(); since.setDate(since.getDate() - 30); since.setHours(0,0,0,0);
    supabase.from("registros_atividade").select("*")
      .eq("usuario_id", user.id)
      .gte("inicio", since.toISOString())
      .then(({ data }) => {
        const map = new Map<string, { ativo: number; pausa: number; almoco: number; inativo: number }>();
        (data ?? []).forEach((r: any) => {
          const day = new Date(r.inicio).toLocaleDateString("pt-BR");
          if (!map.has(day)) map.set(day, { ativo: 0, pausa: 0, almoco: 0, inativo: 0 });
          const bucket = map.get(day)!;
          const dur = r.duracao_minutos ?? (r.fim ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000 : 0);
          if (r.status === "ATIVO") bucket.ativo += dur;
          else if (r.status === "PAUSA") bucket.pausa += dur;
          else if (r.status === "ALMOCO") bucket.almoco += dur;
          else if (r.status === "INATIVO") bucket.inativo += dur;
        });
        const arr = Array.from(map.entries())
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => a.date.localeCompare(b.date));
        setHistory30(arr);
      });
  }, [user?.id, session.current?.id]);

  const totals = useMemo(() => {
    const t = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
    const nowTs = Date.now();
    session.todayRecords.forEach((r) => {
      const dur = r.duracao_minutos ?? (r.fim ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000 : (nowTs - new Date(r.inicio).getTime()) / 60000);
      if (r.status in t) t[r.status as keyof typeof t] += dur;
    });
    return t;
  }, [session.todayRecords, now]);

  const totalOnline = totals.ATIVO + totals.PAUSA + totals.ALMOCO + totals.INATIVO;
  const status = session.current?.status ?? "ENCERRADO";

  const pieData = [
    { name: "Ativo", value: totals.ATIVO, color: "var(--color-success)" },
    { name: "Pausa", value: totals.PAUSA, color: "var(--color-warning)" },
    { name: "Almoço", value: totals.ALMOCO, color: "var(--color-info)" },
    { name: "Inativo", value: totals.INATIVO, color: "var(--color-destructive)" },
  ].filter((d) => d.value > 0);

  const canStart = !session.current || session.current.status === "ENCERRADO";
  const isActive = status === "ATIVO";
  const isPaused = status === "PAUSA" || status === "ALMOCO" || status === "INATIVO";

  return (
    <div className="space-y-6">
      <InactivityModal open={session.showInactive} onResume={session.resume} />

      {/* Header card */}
      <Card>
        <CardContent className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Bem-vindo,</p>
            <h1 className="text-2xl font-bold">{profile?.nome ?? "..."}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</span>
              <span className="font-mono text-lg font-semibold text-foreground">{now.toLocaleTimeString("pt-BR")}</span>
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <StatusBadge status={status} />
            {session.current && (
              <span className="text-xs text-muted-foreground">desde {formatHM(session.current.inicio)}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
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
          <CardHeader><CardTitle>Distribuição de hoje</CardTitle></CardHeader>
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
          <CardHeader><CardTitle>Linha do tempo (hoje)</CardTitle></CardHeader>
          <CardContent>
            {session.todayRecords.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Sem registros.</p>
            ) : (
              <ul className="space-y-2">
                {session.todayRecords.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    <div className="flex items-center gap-3"><StatusBadge status={r.status} /></div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {formatHM(r.inicio)} → {r.fim ? formatHM(r.fim) : "agora"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /><CardTitle>Histórico — 30 dias</CardTitle></CardHeader>
        <CardContent>
          {history30.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Sem histórico.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={history30}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} />
                <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                <Tooltip formatter={(v: number) => formatDuration(v)} />
                <Legend />
                <Bar dataKey="ativo" stackId="a" name="Ativo" fill="var(--color-success)" />
                <Bar dataKey="pausa" stackId="a" name="Pausa" fill="var(--color-warning)" />
                <Bar dataKey="almoco" stackId="a" name="Almoço" fill="var(--color-info)" />
                <Bar dataKey="inativo" stackId="a" name="Inativo" fill="var(--color-destructive)" />
              </BarChart>
            </ResponsiveContainer>
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
