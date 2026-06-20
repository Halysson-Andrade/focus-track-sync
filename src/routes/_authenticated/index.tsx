import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentSession } from "@/hooks/use-current-session";
import { usePresenceStatus } from "@/hooks/use-presence-status";
import { StatusBadge } from "@/components/StatusBadge";
import { InactivityModal } from "@/components/InactivityModal";
import { toast } from "sonner";
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
  Hourglass,
  Pencil,
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
import {
  formatDuration,
  formatHM,
  STATUS_COLOR,
  ABONO_COLOR,
  EDITADO_COLOR,
  AJUSTE_TIPO_LABEL,
  AJUSTE_STATUS_LABEL,
} from "@/lib/format";
import { tempoTrabalhado, isChromeProcess } from "@/lib/activity-config";
import { ocioReconciliadoSeg } from "@/lib/ocio";
import { aplicarAjustes, type SegmentoEfetivo, type AjusteJornada } from "@/lib/jornada-efetiva";
import { SolicitarAjusteDialog } from "@/components/jornada/SolicitarAjusteDialog";
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
// Intervalo PRECISO de ociosidade (apps nativos = desktop, navegador = extensão).
type IdleEvent = { inicio: string; fim: string; fonte: string };
type CategoriaRow = {
  tipo: string;
  identificador: string;
  categoria: string;
  produtiva: boolean;
};
type TeamReg = {
  usuario_id: string;
  status: string;
  inicio: string;
  fim: string | null;
  duracao_minutos: number | null;
  profiles?: { nome: string | null } | null;
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

// União de intervalos [start, end] em segundos — desduplica sobreposições
// (a extensão às vezes mantém 2 linhas abertas em troca rápida de aba).
function unionSeconds(intervals: { start: number; end: number }[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const it of sorted) {
    if (curEnd < it.start) {
      if (curStart >= 0) total += curEnd - curStart;
      curStart = it.start;
      curEnd = it.end;
    } else if (it.end > curEnd) {
      curEnd = it.end;
    }
  }
  if (curStart >= 0) total += curEnd - curStart;
  return total / 1000;
}


function Dashboard() {
  const router = useRouter();
  const { user, profile, isAdmin, isSuperadmin } = useAuth();
  const session = useCurrentSession(user?.id);
  const [breakDialog, setBreakDialog] = useState<{ kind: "PAUSA" | "ALMOCO" } | null>(null);
  const [breakReason, setBreakReason] = useState("");
  const [breakBusy, setBreakBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  const [history30, setHistory30] = useState<{ date: Date; records: Registro[] }[]>([]);
  const [history30Ajustes, setHistory30Ajustes] = useState<AjusteJornada[]>([]);
  const [history30IdleEvents, setHistory30IdleEvents] = useState<Map<string, IdleEvent[]>>(new Map());


  // Selected day (defaults to today). When != today, dashboard shows historic data.
  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday);

  const isToday = selectedDate.getTime() === startOfToday.getTime();
  // Janela bruta confiável: últimos 30 dias (retenção). Antes disso, lemos dos
  // agregados *_diario para garantir que os gráficos continuem populados após o purge.
  const daysAgo = Math.floor(
    (startOfToday.getTime() - selectedDate.getTime()) / (24 * 3600_000),
  );
  const useAggregates = daysAgo > 25;
  const dayRange = useMemo(() => {
    const s = new Date(selectedDate);
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    return { start: s.toISOString(), end: e.toISOString() };
  }, [selectedDate]);
  const dayKey = selectedDate.toISOString().slice(0, 10);
  const [dayRecords, setDayRecords] = useState<Registro[]>([]);
  // Intervalos de ociosidade do dia selecionado, para a linha do tempo.
  const [idleEvents, setIdleEvents] = useState<IdleEvent[]>([]);
  // Ajustes de jornada (overlay) do usuário/dia selecionado. Os aprovados entram na
  // linha do tempo (cor "editado") e recalculam os totais; pendentes alimentam a
  // lista "Minhas solicitações". `ajustesRefresh` força reload após enviar uma nova.
  const [ajustes, setAjustes] = useState<AjusteJornada[]>([]);
  const [ajustesRefresh, setAjustesRefresh] = useState(0);
  const [ajusteDialogOpen, setAjusteDialogOpen] = useState(false);
  // Classificação de domínios/processos por categoria (admin gerencia no Supabase).
  const [categorias, setCategorias] = useState<CategoriaRow[]>([]);
  // Visão Geral (admin): registros + ócio de TODOS os usuários no dia.
  const [teamRegistros, setTeamRegistros] = useState<TeamReg[]>([]);
  const [teamEventos, setTeamEventos] = useState<
    { usuario_id: string; inicio: string; fim: string | null }[]
  >([]);

  // Admin: filter by target user. Default "ALL" = visão Geral (todos os recursos).
  const [users, setUsers] = useState<{ id: string; nome: string; departamento: string | null }[]>(
    [],
  );
  const [targetUserId, setTargetUserId] = useState<string>("ALL");

  // Recorte por área: superadmin vê todos (null = sem filtro); admin vê só os da
  // sua própria área; admin sem departamento (ou não-admin) vê só a si mesmo.
  // O Dashboard lê registros_atividade/eventos_ociosidade, que também alimentam o
  // operacional (admin = todos), então este recorte é aplicado na query (UI), não no RLS.
  const myDept = (profile?.departamento ?? "").trim().toLowerCase();
  const areaUserIds = useMemo<string[] | null>(() => {
    if (isSuperadmin) return null; // sem filtro: todas as áreas
    if (!myDept) return user?.id ? [user.id] : []; // admin sem área → só ele
    const ids = users
      .filter((u) => (u.departamento ?? "").trim().toLowerCase() === myDept)
      .map((u) => u.id);
    if (user?.id && !ids.includes(user.id)) ids.push(user.id);
    return ids;
  }, [isSuperadmin, myDept, users, user?.id]);

  // Usuários visíveis no seletor individual (superadmin: todos; senão, só a área).
  const selectableUsers = useMemo(
    () => (areaUserIds === null ? users : users.filter((u) => areaUserIds.includes(u.id))),
    [areaUserIds, users],
  );

  const geral = isAdmin && targetUserId === "ALL";
  const effectiveUserId = geral
    ? undefined
    : isAdmin && targetUserId
      ? targetUserId
      : user?.id;
  const viewingOther = isAdmin && !geral && !!targetUserId && targetUserId !== user?.id;

  // Data for the effective user (own session OR another user when admin)
  const [otherRecords, setOtherRecords] = useState<Registro[]>([]);
  const [pages, setPages] = useState<Pagina[]>([]);
  const [externalNav, setExternalNav] = useState<NavExterna[]>([]);
  const [appUsage, setAppUsage] = useState<UsoApp[]>([]);
  // Agregados (fallback para datas antigas / fora da retenção bruta)
  const [navDiario, setNavDiario] = useState<
    { domain: string; segundos_totais: number; segundos_inativos: number; visitas: number }[]
  >([]);
  const [appDiario, setAppDiario] = useState<
    {
      process_name: string;
      app_label: string | null;
      segundos_totais: number;
      segundos_inativos: number;
      sessoes: number;
    }[]
  >([]);


  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  // Load users list for admin filter
  useEffect(() => {
    if (!isAdmin) return;
    supabase
      .from("profiles")
      .select("id, nome, departamento")
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => {
        setUsers((data ?? []) as { id: string; nome: string; departamento: string | null }[]);
      });
  }, [isAdmin]);

  // Classificação por categoria (global; admin gerencia no Supabase).
  useEffect(() => {
    supabase
      .from("categoria_atividade")
      .select("tipo, identificador, categoria, produtiva")
      .eq("ativo", true)
      .then(({ data }) => setCategorias((data ?? []) as CategoriaRow[]));
  }, []);

  // Visão Geral (admin): busca registros + ócio de TODOS no dia selecionado.
  // order desc + limit como guarda contra o teto de 1000 do PostgREST.
  useEffect(() => {
    if (!geral) return;
    // Recorte por área: superadmin (areaUserIds === null) sem filtro; demais
    // restritos aos ids da sua área. Lista vazia → nada a buscar.
    if (areaUserIds !== null && areaUserIds.length === 0) {
      setTeamRegistros([]);
      setTeamEventos([]);
      return;
    }
    let cancelled = false;
    (async () => {
      let regsQuery = supabase
        .from("registros_atividade")
        .select("usuario_id, status, inicio, fim, duracao_minutos")
        .gte("inicio", dayRange.start)
        .lt("inicio", dayRange.end)
        .order("inicio", { ascending: false })
        .limit(5000);
      let evsQuery = supabase
        .from("eventos_ociosidade")
        .select("usuario_id, inicio, fim")
        .gte("inicio", dayRange.start)
        .lt("inicio", dayRange.end)
        .order("inicio", { ascending: false })
        .limit(5000);
      if (areaUserIds !== null) {
        regsQuery = regsQuery.in("usuario_id", areaUserIds);
        evsQuery = evsQuery.in("usuario_id", areaUserIds);
      }
      const [{ data: regs }, { data: evs }] = await Promise.all([regsQuery, evsQuery]);
      if (cancelled) return;
      setTeamRegistros((regs ?? []) as unknown as TeamReg[]);
      setTeamEventos((evs ?? []) as { usuario_id: string; inicio: string; fim: string | null }[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [geral, areaUserIds, dayRange.start, dayRange.end, isToday ? now.getMinutes() : 0]);

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

  // Intervalos de ociosidade do dia selecionado (faixas na linha do tempo).
  // Independe de useAggregates: eventos_ociosidade não é purgado pelo agregador.
  useEffect(() => {
    if (!effectiveUserId) {
      setIdleEvents([]);
      return;
    }
    supabase
      .from("eventos_ociosidade")
      .select("inicio, fim, fonte")
      .eq("usuario_id", effectiveUserId)
      .gte("inicio", dayRange.start)
      .lt("inicio", dayRange.end)
      .order("inicio", { ascending: true })
      .then(({ data }) => setIdleEvents((data ?? []) as IdleEvent[]));
  }, [effectiveUserId, dayRange.start, dayRange.end, isToday ? now.getMinutes() : 0]);

  // Ajustes de jornada do usuário/dia (RLS já entrega só o escopo permitido).
  useEffect(() => {
    if (!effectiveUserId) {
      setAjustes([]);
      return;
    }
    supabase
      .from("ajustes_jornada")
      .select("*")
      .eq("usuario_id", effectiveUserId)
      .eq("dia", dayKey)
      .order("criado_em", { ascending: false })
      .then(({ data }) => setAjustes((data ?? []) as AjusteJornada[]));
  }, [effectiveUserId, dayKey, ajustesRefresh, isToday ? now.getMinutes() : 0]);

  // Para o dia selecionado:
  //   - dentro da retenção bruta (≤25d): lemos navegacao_paginas / navegacao_externa /
  //     uso_aplicativos (mesma fidelidade de sessão-a-sessão).
  //   - fora da retenção: caímos para os agregados navegacao_diaria / uso_app_diario,
  //     que sobrevivem ao purge e mantêm os totais corretos por dia.
  useEffect(() => {
    if (!effectiveUserId) return;
    if (useAggregates) {
      setPages([]);
      setExternalNav([]);
      setAppUsage([]);
      supabase
        .from("navegacao_diaria")
        .select("domain, segundos_totais, segundos_inativos, visitas")
        .eq("usuario_id", effectiveUserId)
        .eq("dia", dayKey)
        .then(({ data }) => setNavDiario((data ?? []) as typeof navDiario));
      supabase
        .from("uso_app_diario")
        .select("process_name, app_label, segundos_totais, segundos_inativos, sessoes")
        .eq("usuario_id", effectiveUserId)
        .eq("dia", dayKey)
        .then(({ data }) => setAppDiario((data ?? []) as typeof appDiario));
      return;
    }
    setNavDiario([]);
    setAppDiario([]);
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
  }, [
    effectiveUserId,
    useAggregates,
    dayKey,
    dayRange.start,
    dayRange.end,
    isToday ? now.getMinutes() : 0,
  ]);

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
  }, [effectiveUserId, session.current?.id, ajustesRefresh]);

  // Ajustes aprovados nos últimos 30 dias para aplicar nas linhas do histórico
  // (mesma "visão efetiva" da jornada do dia).
  useEffect(() => {
    if (!effectiveUserId) {
      setHistory30Ajustes([]);
      return;
    }
    const since = new Date();
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);
    const sinceKey = since.toISOString().slice(0, 10);
    supabase
      .from("ajustes_jornada")
      .select("*")
      .eq("usuario_id", effectiveUserId)
      .eq("status", "aprovada")
      .gte("dia", sinceKey)
      .then(({ data }) => setHistory30Ajustes((data ?? []) as AjusteJornada[]));
  }, [effectiveUserId, session.current?.id, ajustesRefresh]);

  // 30-day history idle events for effective user — grouped per day so the
  // historical timeline can overlay ociosidade on top of each day's jornada.
  useEffect(() => {
    if (!effectiveUserId) {
      setHistory30IdleEvents(new Map());
      return;
    }
    const since = new Date();
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);
    supabase
      .from("eventos_ociosidade")
      .select("inicio, fim, fonte")
      .eq("usuario_id", effectiveUserId)
      .gte("inicio", since.toISOString())
      .order("inicio", { ascending: true })
      .then(({ data }) => {
        const map = new Map<string, IdleEvent[]>();
        (data ?? []).forEach((e) => {
          const d = new Date(e.inicio);
          d.setHours(0, 0, 0, 0);
          const key = d.toISOString().slice(0, 10);
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(e as IdleEvent);
        });
        setHistory30IdleEvents(map);
      });
  }, [effectiveUserId, session.current?.id, ajustesRefresh]);


  // Records to display on the board for the selected day
  const todayRecords: Registro[] = isToday && !viewingOther ? session.todayRecords : dayRecords;
  void otherRecords;

  // Jornada EFETIVA = tracking bruto + ajustes aprovados (overlay). É a base única da
  // linha do tempo e dos totais — assim a aprovação de um ajuste recalcula tudo junto.
  const effectiveRecords = useMemo<SegmentoEfetivo[]>(
    () => aplicarAjustes(todayRecords, ajustes, selectedDate, now.getTime()),
    [todayRecords, ajustes, selectedDate, now],
  );

  const totals = useMemo(() => {
    const t = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0, ABONO: 0 };
    const nowTs = Date.now();
    effectiveRecords.forEach((r) => {
      const dur =
        r.duracao_minutos ??
        (r.fim
          ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000
          : (nowTs - new Date(r.inicio).getTime()) / 60000);
      if (r.status in t) t[r.status as keyof typeof t] += dur;
    });
    return t;
  }, [effectiveRecords, now]);

  const totalOnline = totals.ATIVO + totals.PAUSA + totals.ALMOCO + totals.INATIVO;

  // Estatísticas por DOMÍNIO (somente extensão Chrome — o app interno não é mais
  // exibido pois já é coberto pela extensão) e por APP desktop (excluindo Chrome
  // para não duplicar com a navegação capturada pela extensão).
  type SiteStat = {
    domain: string;
    total: number;
    idle: number;
    trabalhado: number;
    visitas: number;
  };
  type AppStat = {
    app: string;
    process_name: string;
    total: number;
    idle: number;
    trabalhado: number;
    sessoes: number;
  };

  const siteStats: SiteStat[] = useMemo(() => {
    const m = new Map<string, SiteStat>();
    const add = (domain: string, total: number, idle: number, visitas: number) => {
      const cur = m.get(domain);
      if (cur) {
        cur.total += total;
        cur.idle += idle;
        cur.visitas += visitas;
        cur.trabalhado = tempoTrabalhado(cur.total, cur.idle);
      } else {
        m.set(domain, { domain, total, idle, visitas, trabalhado: tempoTrabalhado(total, idle) });
      }
    };
    if (useAggregates) {
      navDiario.forEach((n) =>
        add(n.domain || "desconhecido", n.segundos_totais, n.segundos_inativos, n.visitas),
      );
    } else {
      externalNav.forEach((n) => {
        const dur = safeDur(n.duracao_segundos, n.inicio, n.fim);
        add(n.domain || "desconhecido", dur, n.inativo_segundos || 0, 1);
      });
    }
    return Array.from(m.values()).sort((a, b) => b.trabalhado - a.trabalhado);
  }, [useAggregates, externalNav, navDiario, now]);

  const appStats: AppStat[] = useMemo(() => {
    const m = new Map<string, AppStat>();
    const add = (
      process_name: string,
      label: string,
      total: number,
      idle: number,
      sessoes: number,
    ) => {
      if (isChromeProcess(process_name) || isChromeProcess(label)) return; // evita duplicar com a extensão
      const cur = m.get(process_name);
      if (cur) {
        cur.total += total;
        cur.idle += idle;
        cur.sessoes += sessoes;
        cur.trabalhado = tempoTrabalhado(cur.total, cur.idle);
        if (!cur.app && label) cur.app = label;
      } else {
        m.set(process_name, {
          app: label || process_name,
          process_name,
          total,
          idle,
          sessoes,
          trabalhado: tempoTrabalhado(total, idle),
        });
      }
    };
    if (useAggregates) {
      appDiario.forEach((a) =>
        add(
          a.process_name,
          a.app_label || a.process_name,
          a.segundos_totais,
          a.segundos_inativos,
          a.sessoes,
        ),
      );
    } else {
      appUsage.forEach((a) => {
        const dur = safeDur(a.duracao_segundos, a.inicio, a.fim);
        add(a.process_name, a.app_label || a.process_name, dur, a.inativo_segundos || 0, 1);
      });
    }
    return Array.from(m.values()).sort((a, b) => b.trabalhado - a.trabalhado);
  }, [useAggregates, appUsage, appDiario, now]);

  // Distribuição do tempo TRABALHADO por categoria (Dev/Comunicação/Reunião/…),
  // a partir da classificação `categoria_atividade` (domínio/processo → categoria).
  // Sites/apps sem classificação caem em "Não categorizado" (não somem).
  const categoriaStats = useMemo(() => {
    const domainCat = new Map<string, { categoria: string; produtiva: boolean }>();
    const procCat = new Map<string, { categoria: string; produtiva: boolean }>();
    categorias.forEach((c) => {
      const key = c.identificador.toLowerCase();
      const val = { categoria: c.categoria, produtiva: c.produtiva };
      if (c.tipo === "dominio") domainCat.set(key, val);
      else if (c.tipo === "processo") procCat.set(key, val);
    });
    const lookupDomain = (domain: string) => {
      const d = (domain || "").toLowerCase();
      if (domainCat.has(d)) return domainCat.get(d);
      for (const [id, val] of domainCat) if (d === id || d.endsWith("." + id)) return val;
      return undefined;
    };
    const agg = new Map<string, { categoria: string; produtiva: boolean; segundos: number }>();
    const add = (categoria: string, produtiva: boolean, seg: number) => {
      if (!seg || seg <= 0) return;
      const cur = agg.get(categoria);
      if (cur) cur.segundos += seg;
      else agg.set(categoria, { categoria, produtiva, segundos: seg });
    };
    siteStats.forEach((s) => {
      const hit = lookupDomain(s.domain);
      if (hit) add(hit.categoria, hit.produtiva, s.trabalhado);
      else add("Não categorizado", false, s.trabalhado);
    });
    appStats.forEach((a) => {
      const hit =
        procCat.get((a.process_name || "").toLowerCase()) ??
        procCat.get((a.app || "").toLowerCase());
      if (hit) add(hit.categoria, hit.produtiva, a.trabalhado);
      else add("Não categorizado", false, a.trabalhado);
    });
    const arr = Array.from(agg.values()).sort((x, y) => y.segundos - x.segundos);
    const total = arr.reduce((s, c) => s + c.segundos, 0);
    const produtivoSeg = arr.filter((c) => c.produtiva).reduce((s, c) => s + c.segundos, 0);
    return { arr, total, produtivoSeg, pctProdutivo: total > 0 ? (produtivoSeg / total) * 100 : 0 };
  }, [categorias, siteStats, appStats]);

  // Agregação da equipe (visão Geral) — por usuário + totais do dia.
  const teamData = useMemo(() => {
    const nowTs = now.getTime();
    const nomeById = new Map(users.map((u) => [u.id, u.nome]));
    const eventosByUser = new Map<string, { inicio: string; fim: string | null }[]>();
    teamEventos.forEach((e) => {
      const list = eventosByUser.get(e.usuario_id) ?? [];
      list.push({ inicio: e.inicio, fim: e.fim });
      eventosByUser.set(e.usuario_id, list);
    });
    type Acc = {
      nome: string;
      ATIVO: number;
      PAUSA: number;
      ALMOCO: number;
      INATIVO: number;
      online: boolean;
      ativos: { inicio: string; fim: string | null }[];
    };
    const map = new Map<string, Acc>();
    teamRegistros.forEach((r) => {
      if (r.status === "ENCERRADO") return;
      const dur =
        r.duracao_minutos ??
        (r.fim
          ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000
          : (nowTs - new Date(r.inicio).getTime()) / 60000);
      const a =
        map.get(r.usuario_id) ??
        ({
          nome: nomeById.get(r.usuario_id) ?? "—",
          ATIVO: 0,
          PAUSA: 0,
          ALMOCO: 0,
          INATIVO: 0,
          online: false,
          ativos: [],
        } as Acc);
      if (r.status in a) a[r.status as "ATIVO" | "PAUSA" | "ALMOCO" | "INATIVO"] += dur;
      if (!r.fim) a.online = true;
      if (r.status === "ATIVO") a.ativos.push({ inicio: r.inicio, fim: r.fim });
      map.set(r.usuario_id, a);
    });
    const linhas = Array.from(map.entries())
      .map(([id, a]) => {
        const ocio = ocioReconciliadoSeg(eventosByUser.get(id) ?? [], a.ativos, nowTs) / 60;
        const efetivo = Math.max(0, a.ATIVO - ocio);
        return {
          id,
          nome: a.nome,
          ativo: a.ATIVO,
          ocio,
          efetivo,
          pausa: a.PAUSA,
          almoco: a.ALMOCO,
          online: a.online,
          pct: a.ATIVO > 0 ? (efetivo / a.ATIVO) * 100 : 0,
        };
      })
      .sort((x, y) => y.efetivo - x.efetivo);
    const tot = linhas.reduce(
      (s, l) => ({
        ativo: s.ativo + l.ativo,
        ocio: s.ocio + l.ocio,
        efetivo: s.efetivo + l.efetivo,
        pausa: s.pausa + l.pausa,
        almoco: s.almoco + l.almoco,
      }),
      { ativo: 0, ocio: 0, efetivo: 0, pausa: 0, almoco: 0 },
    );
    return { linhas, tot, pessoas: linhas.length, online: linhas.filter((l) => l.online).length };
  }, [teamRegistros, teamEventos, users, now]);

  // Tempo CONSOLIDADO monitorado — desduplica intervalos sobrepostos da
  // extensão (Chrome) e dos apps desktop (excluindo Chrome), e clampa ao
  // tempo efetivamente trabalhado (ATIVO) da jornada do dia. Garante que a
  // monitoração nunca ultrapasse o tempo de trabalho registrado.
  const monitored = useMemo(() => {
    const jornadaAtivoSec = totals.ATIVO * 60;

    // Intervalos do Chrome desktop (processo do navegador) — a extensão pode
    // ter perdido eventos (chrome://, devtools, abriu depois), então usamos
    // o desktop como piso para garantir que nenhum tempo de foco no Chrome
    // se perca. A extensão continua sendo a fonte do breakdown por domínio.
    const chromeDeskRows = appUsage.filter(
      (a) => isChromeProcess(a.process_name) || isChromeProcess(a.app_label || ""),
    );
    const chromeExtIntervals = externalNav.map((n) => ({
      start: new Date(n.inicio).getTime(),
      end: n.fim
        ? new Date(n.fim).getTime()
        : new Date(n.inicio).getTime() + safeDur(n.duracao_segundos, n.inicio, n.fim) * 1000,
    }));
    const chromeDeskIntervals = chromeDeskRows.map((a) => ({
      start: new Date(a.inicio).getTime(),
      end: a.fim
        ? new Date(a.fim).getTime()
        : new Date(a.inicio).getTime() + safeDur(a.duracao_segundos, a.inicio, a.fim) * 1000,
    }));
    const chromeIntervals = [...chromeExtIntervals, ...chromeDeskIntervals];

    const deskIntervals = appUsage
      .filter((a) => !isChromeProcess(a.process_name) && !isChromeProcess(a.app_label || ""))
      .map((a) => ({
        start: new Date(a.inicio).getTime(),
        end: a.fim
          ? new Date(a.fim).getTime()
          : new Date(a.inicio).getTime() + safeDur(a.duracao_segundos, a.inicio, a.fim) * 1000,
      }));

    const chromeExtRawSec = externalNav.reduce(
      (acc, n) => acc + safeDur(n.duracao_segundos, n.inicio, n.fim),
      0,
    );
    const chromeDeskRawSec = chromeDeskRows.reduce(
      (acc, a) => acc + safeDur(a.duracao_segundos, a.inicio, a.fim),
      0,
    );
    const chromeIdleSec =
      externalNav.reduce((acc, n) => acc + (n.inativo_segundos || 0), 0) +
      chromeDeskRows.reduce((acc, a) => acc + (a.inativo_segundos || 0), 0);
    const chromeRawSec = chromeExtRawSec + chromeDeskRawSec;
    const deskRawSec = appStats.reduce((a, r) => a + r.total, 0);
    const deskIdleSec = appStats.reduce((a, r) => a + r.idle, 0);

    let chromeUnion = useAggregates
      ? Math.max(chromeExtRawSec, chromeDeskRawSec)
      : unionSeconds(chromeIntervals);
    let deskUnion = useAggregates ? deskRawSec : unionSeconds(deskIntervals);

    // Idle proporcional à fração que sobrou após a deduplicação.
    const chromeFactor = chromeRawSec > 0 ? chromeUnion / chromeRawSec : 0;
    const deskFactor = deskRawSec > 0 ? deskUnion / deskRawSec : 0;
    let chromeWorked = Math.max(0, chromeUnion - chromeIdleSec * chromeFactor);
    let deskWorked = Math.max(0, deskUnion - deskIdleSec * deskFactor);

    const totalUnion = useAggregates
      ? chromeUnion + deskUnion
      : unionSeconds([...chromeIntervals, ...deskIntervals]);
    const combinedFactor =
      chromeUnion + deskUnion > 0 ? totalUnion / (chromeUnion + deskUnion) : 0;
    let totalWorked = Math.max(
      0,
      totalUnion - (chromeIdleSec * chromeFactor + deskIdleSec * deskFactor) * combinedFactor,
    );

    // Clampa ao tempo ATIVO da jornada — monitoração nunca pode exceder.
    if (jornadaAtivoSec > 0 && totalWorked > jornadaAtivoSec) {
      const scale = jornadaAtivoSec / totalWorked;
      chromeWorked *= scale;
      deskWorked *= scale;
      totalWorked = jornadaAtivoSec;
    }

    return {
      chrome: { trabalhado: chromeWorked, bruto: chromeRawSec, union: chromeUnion },
      desktop: { trabalhado: deskWorked, bruto: deskRawSec, union: deskUnion },
      total: { trabalhado: totalWorked, jornadaAtivoSec },
      // Ociosidade detectada, RECONCILIADA entre fontes para não contar o mesmo
      // intervalo de relógio mais de uma vez:
      //   - web: só a extensão (navegacao_externa / navegacao_diaria). Ela é
      //     passive-aware (reuniões não viram ócio). NÃO somamos o ócio do
      //     chrome.exe do desktop (mesma janela → dupla contagem; e o desktop
      //     não sabe que é reunião → falso ócio "ativo no web").
      //   - apps: só uso_aplicativos NÃO-navegador (deskIdleSec já exclui Chrome).
      // Clampado ao tempo ATIVO da jornada — ócio nunca excede o trabalhado.
      ocioso: (() => {
        // Detalhe por fonte (mantido para os tooltips/barras) — estimativa por
        // sessão a partir de inativo_segundos.
        const webIdle = useAggregates
          ? navDiario.reduce((a, n) => a + (n.segundos_inativos || 0), 0)
          : externalNav.reduce((a, n) => a + (n.inativo_segundos || 0), 0);
        // TOTAL = fonte ÚNICA: união dos intervalos de `eventos_ociosidade` ∩
        // janelas ATIVO (mesma fonte da timeline → número e timeline batem; sem
        // dupla contagem entre extension/desktop). Em modo agregado (>25d) os
        // eventos podem ter sido purgados (retenção 30d) → fallback para a soma.
        const fallback =
          jornadaAtivoSec > 0
            ? Math.min(webIdle + deskIdleSec, jornadaAtivoSec)
            : webIdle + deskIdleSec;
        const ativos = todayRecords
          .filter((r) => r.status === "ATIVO")
          .map((r) => ({ inicio: r.inicio, fim: r.fim }));
        const total = useAggregates
          ? fallback
          : ocioReconciliadoSeg(idleEvents, ativos, now.getTime());
        return { apps: deskIdleSec, web: webIdle, total };
      })(),
      foraJornada: Math.max(0, totalUnion - jornadaAtivoSec),
    };
  }, [
    externalNav,
    navDiario,
    appUsage,
    appStats,
    useAggregates,
    totals.ATIVO,
    now,
    todayRecords,
    idleEvents,
  ]);


  // Donut Web (Chrome) vs Desktop — usa tempo consolidado (já clampado).
  const webVsDesktop = useMemo(() => {
    return [
      { name: "Web (Chrome)", value: monitored.chrome.trabalhado, color: "var(--color-primary)" },
      { name: "Apps desktop", value: monitored.desktop.trabalhado, color: "var(--color-info)" },
    ].filter((d) => d.value > 0);
  }, [monitored]);



  const topSites = useMemo(
    () =>
      siteStats
        .filter((s) => s.trabalhado > 0)
        .slice(0, 10)
        .map((s) => ({
          domain: s.domain.length > 22 ? s.domain.slice(0, 21) + "…" : s.domain,
          trabalhado: Math.round(s.trabalhado),
          idle: Math.round(s.idle),
        })),
    [siteStats],
  );

  const topApps = useMemo(
    () =>
      appStats
        .filter((a) => a.trabalhado > 0)
        .slice(0, 5)
        .map((a) => ({
          app: a.app.length > 22 ? a.app.slice(0, 21) + "…" : a.app,
          trabalhado: Math.round(a.trabalhado),
          idle: Math.round(a.idle),
        })),
    [appStats],
  );

  const currentOpen =
    isToday && !viewingOther ? session.current : (todayRecords.find((r) => !r.fim) ?? null);
  const status = currentOpen?.status ?? "ENCERRADO";

  const pieData = [

    { name: "Ativo", value: totals.ATIVO, color: "var(--color-success)" },
    { name: "Pausa", value: totals.PAUSA, color: "var(--color-warning)" },
    { name: "Almoço", value: totals.ALMOCO, color: "var(--color-info)" },
    { name: "Inativo", value: totals.INATIVO, color: "var(--color-muted-foreground)" },
    { name: "Abonado", value: totals.ABONO, color: ABONO_COLOR },
  ].filter((d) => d.value > 0);

  const canStart = !session.current || session.current.status === "ENCERRADO";
  const isActive = status === "ATIVO";
  const isPaused = status === "PAUSA" || status === "ALMOCO" || status === "INATIVO";

  // Gate de início de expediente: exigir extensão + app desktop online
  const presence = usePresenceStatus(effectiveUserId);
  const [startGateOpen, setStartGateOpen] = useState(false);
  const [startChecking, setStartChecking] = useState(false);
  const handleStartClick = async () => {
    if (startChecking) return;
    setStartChecking(true);
    try {
      // Verificação fresca no clique — nunca confia só no estado renderizado.
      // Exige EXTENSÃO + APP DESKTOP logados/online: sem ambos não há
      // monitoração completa. O desktop reporta presença sustentada (coluna
      // `ultimo_visto`) enquanto logado, mesmo fora de expediente — por isso dá
      // para exigi-lo ANTES de iniciar. O backend (RPC abrir_registro) reaplica
      // este gate como autoridade final; aqui é só feedback imediato de UX.
      const { ext, desktop } = await presence.checkNow();
      if (!ext || !desktop) {
        setStartGateOpen(true);
        return;
      }
      await session.start();
    } finally {
      setStartChecking(false);
    }
  };

  const handleInactivityResume = async () => {
    const { ext, desktop } = await presence.checkNow();
    if (ext && desktop) {
      await session.resume();
      return;
    }
    session.setShowInactive(false);
    toast.warning(
      "Retomada automática exige a extensão do Chrome e o app desktop logados. Inicie o expediente manualmente pelos controles.",
    );
    router.navigate({ to: "/" });
  };

  const selectedUser = users.find((u) => u.id === targetUserId);
  const displayName = viewingOther ? (selectedUser?.nome ?? "Usuário") : (profile?.nome ?? "...");

  // VISÃO GERAL (admin, todos os recursos) — resumo da equipe do dia.
  if (geral) {
    const efMediaPct =
      teamData.tot.ativo > 0 ? Math.round((teamData.tot.efetivo / teamData.tot.ativo) * 100) : 0;
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Visão Geral da Equipe</h1>
            <p className="text-sm text-muted-foreground">
              Resumo de hoje · {teamData.pessoas} pessoa(s) · {teamData.online} online agora
            </p>
          </div>
          <Select value="ALL" onValueChange={(v) => setTargetUserId(v === "self" ? "" : v)}>
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Geral · todos</SelectItem>
              <SelectItem value="self">Eu mesmo ({profile?.nome ?? "..."})</SelectItem>
              {selectableUsers
                .filter((u) => u.id !== user?.id)
                .map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <StatCard
            icon={<ActivityIcon className="h-4 w-4" />}
            label="Trabalhadas (equipe)"
            value={formatDuration(teamData.tot.ativo)}
            accent="success"
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="Tempo efetivo"
            value={formatDuration(teamData.tot.efetivo)}
            accent="success"
            hint="ATIVO − ócio somado da equipe"
          />
          <StatCard
            icon={<Hourglass className="h-4 w-4" />}
            label="Ociosidade"
            value={formatDuration(teamData.tot.ocio)}
            accent="idle"
          />
          <StatCard
            icon={<Pause className="h-4 w-4" />}
            label="Pausa"
            value={formatDuration(teamData.tot.pausa)}
            accent="warning"
          />
          <StatCard
            icon={<Utensils className="h-4 w-4" />}
            label="Almoço"
            value={formatDuration(teamData.tot.almoco)}
            accent="info"
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Eficiência média"
            value={`${efMediaPct}%`}
            accent="primary"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Por colaborador (hoje)</CardTitle>
          </CardHeader>
          <CardContent>
            {teamData.linhas.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Sem expediente registrado hoje.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {teamData.linhas.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 py-3">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${u.online ? "bg-success" : "bg-muted-foreground"}`}
                    />
                    <button
                      className="flex-1 text-left hover:underline"
                      onClick={() => setTargetUserId(u.id)}
                    >
                      <div className="font-medium">{u.nome}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDuration(u.efetivo)} efetivo · {formatDuration(u.ocio)} ócio ·{" "}
                        {formatDuration(u.ativo)} ativo
                      </div>
                    </button>
                    <div className="text-right text-lg font-bold text-primary">
                      {u.pct.toFixed(0)}%
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!viewingOther && <InactivityModal open={session.showInactive} onResume={handleInactivityResume} />}

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
                  <SelectItem value="ALL">Geral · todos</SelectItem>
                  <SelectItem value="self">Eu mesmo ({profile?.nome ?? "..."})</SelectItem>
                  {selectableUsers
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
            <Button
              onClick={handleStartClick}
              disabled={!canStart || startChecking}
              variant={canStart && !presence.extOnline ? "secondary" : "default"}
              size="lg"
              title={
                !presence.extOnline
                  ? "Extensão do Chrome offline — clique para detalhes"
                  : undefined
              }
            >
              <Play className="mr-2 h-4 w-4" />
              {startChecking ? "Verificando serviços..." : "Iniciar Expediente"}
              {!startChecking && canStart && !presence.extOnline && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  serviços offline
                </span>
              )}
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

      {/* Gate: exige extensão + app desktop online antes de iniciar expediente */}
      <Dialog open={startGateOpen} onOpenChange={setStartGateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Não é possível iniciar o expediente
            </DialogTitle>
            <DialogDescription>
              Para iniciar o expediente é necessário que a <b>extensão do Chrome</b> e o{" "}
              <b>app desktop</b> estejam abertos e logados — eles garantem a monitoração. Faça login
              em ambos e tente novamente.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-block h-2.5 w-2.5 rounded-full",
                  presence.extOnline ? "bg-success" : "bg-destructive",
                )}
              />
              <Chrome className="h-4 w-4" />
              <span className="font-medium">Extensão do Chrome:</span>
              <span className={presence.extOnline ? "text-success" : "text-destructive"}>
                {presence.extOnline ? "online" : "offline — faça login na extensão"}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-block h-2.5 w-2.5 rounded-full",
                  presence.desktopOnline ? "bg-success" : "bg-destructive",
                )}
              />
              <Monitor className="h-4 w-4" />
              <span className="font-medium">App Desktop:</span>
              <span className={presence.desktopOnline ? "text-success" : "text-destructive"}>
                {presence.desktopOnline ? "online" : "offline — abra e faça login no app desktop"}
              </span>
            </li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartGateOpen(false)}>
              Fechar
            </Button>
            <Button
              onClick={async () => {
                // Reverifica de forma autoritativa antes de liberar o início.
                // Exige extensão E desktop online (gate de monitoração completo).
                const { ext, desktop } = await presence.checkNow();
                if (ext && desktop) {
                  setStartGateOpen(false);
                  session.start();
                }
              }}
              disabled={!presence.extOnline || !presence.desktopOnline}
            >
              <Play className="mr-2 h-4 w-4" /> Iniciar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


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
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-7">
        <StatCard
          icon={<ActivityIcon className="h-4 w-4" />}
          label="Trabalhadas"
          value={formatDuration(totals.ATIVO)}
          accent="success"
          badge={
            totals.ATIVO > 0 ? (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  background: `color-mix(in oklch, var(--color-success) 15%, transparent)`,
                  color: `var(--color-success)`,
                }}
              >
                {Math.round((monitored.total.trabalhado / (totals.ATIVO * 60)) * 100)}% monitorado
              </span>
            ) : undefined
          }
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Tempo efetivo"
          value={formatDuration(Math.max(0, totals.ATIVO - monitored.ocioso.total / 60))}
          accent="success"
          hint="Tempo ATIVO menos a ociosidade detectada (esforço efetivo)"
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
          label="Inativo (sessão)"
          value={formatDuration(totals.INATIVO)}
          accent="slate"
          hint="Sessão parada por mais de 10 min (status macro)"
        />
        <StatCard
          icon={<Hourglass className="h-4 w-4" />}
          label="Ociosidade detectada"
          value={formatSeconds(monitored.ocioso.total)}
          accent="idle"
          hint="Tempo sem mouse/teclado dentro de apps e navegação (já incluído no trabalhado)"
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
            {monitored.ocioso.total > 0 && (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: "var(--color-idle)" }}
                />
                Inclui {formatSeconds(monitored.ocioso.total)} de ociosidade detectada dentro do
                tempo trabalhado.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Jornada {isToday ? "de hoje" : "do dia"} — linha do tempo</CardTitle>
            {!viewingOther && (
              <Button variant="outline" size="sm" onClick={() => setAjusteDialogOpen(true)}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Solicitar ajuste
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {effectiveRecords.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Sem registros.</p>
            ) : (
              <HorizontalTimeline records={effectiveRecords} idleEvents={idleEvents} />
            )}
            {!viewingOther && ajustes.length > 0 && (
              <div className="mt-4 space-y-1 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">Solicitações do dia</p>
                {ajustes.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background:
                          a.status === "aprovada"
                            ? "var(--color-success)"
                            : a.status === "rejeitada"
                              ? "var(--color-destructive)"
                              : "var(--color-warning)",
                      }}
                    />
                    <span>{AJUSTE_TIPO_LABEL[a.tipo] ?? a.tipo}</span>
                    {a.inicio && a.fim && (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatHM(a.inicio)}–{formatHM(a.fim)}
                      </span>
                    )}
                    <span className="ml-auto text-muted-foreground">
                      {AJUSTE_STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {!viewingOther && (
        <SolicitarAjusteDialog
          dia={selectedDate}
          records={todayRecords}
          open={ajusteDialogOpen}
          onOpenChange={setAjusteDialogOpen}
          onSubmitted={() => setAjustesRefresh((n) => n + 1)}
        />
      )}

      {/* Distribuição por categoria */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle>Tempo por categoria</CardTitle>
          </div>
          {categoriaStats.total > 0 && (
            <span className="text-sm font-semibold text-success">
              {Math.round(categoriaStats.pctProdutivo)}% produtivo
            </span>
          )}
        </CardHeader>
        <CardContent>
          {categoriaStats.arr.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sem dados classificados no dia. Configure domínios/processos em{" "}
              <code>categoria_atividade</code>.
            </p>
          ) : (
            <ul className="space-y-2">
              {categoriaStats.arr.map((c) => {
                const pct =
                  categoriaStats.total > 0 ? (c.segundos / categoriaStats.total) * 100 : 0;
                return (
                  <li key={c.categoria}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="font-medium">{c.categoria}</span>
                      <span className="text-muted-foreground">
                        {formatSeconds(c.segundos)} · {Math.round(pct)}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full"
                        style={{
                          width: `${pct}%`,
                          background: c.produtiva ? "var(--color-success)" : "var(--color-idle)",
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Distribuição do tempo trabalhado por categoria (verde = produtiva). Itens sem
            classificação aparecem como “Não categorizado”.
          </p>
        </CardContent>
      </Card>

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
                      n === "trabalhado" ? "Trabalhado" : "Ocioso",
                    ]}
                  />
                  <Bar dataKey="trabalhado" stackId="t" fill="var(--color-success)" />
                  <Bar dataKey="idle" stackId="t" fill="var(--color-idle)" />
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
                      n === "trabalhado" ? "Trabalhado" : "Ocioso",
                    ]}
                  />
                  <Bar dataKey="trabalhado" stackId="t" fill="var(--color-info)" />
                  <Bar dataKey="idle" stackId="t" fill="var(--color-idle)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Resumo de fontes — consolidado e clampado à jornada ATIVA */}
      <div className="grid gap-4 md:grid-cols-3">
        <SourceCard
          icon={<ActivityIcon className="h-4 w-4" />}
          label="Monitorado consolidado"
          accent="primary"
          trabalhado={monitored.total.trabalhado}
          idle={0}
          hint={
            monitored.total.jornadaAtivoSec > 0
              ? `${Math.round((monitored.total.trabalhado / monitored.total.jornadaAtivoSec) * 100)}% da jornada ATIVA (${formatDuration(monitored.total.jornadaAtivoSec / 60)})`
              : "Sem jornada ATIVA registrada"
          }
        />
        <SourceCard
          icon={<Chrome className="h-4 w-4" />}
          label="Chrome (extensão)"
          accent="warning"
          trabalhado={monitored.chrome.trabalhado}
          idle={0}
          hint="Tempo deduplicado (sobreposições de abas descontadas)"
        />
        <SourceCard
          icon={<Monitor className="h-4 w-4" />}
          label="Apps desktop"
          accent="info"
          trabalhado={monitored.desktop.trabalhado}
          idle={0}
          hint="Sem contagem do Chrome (já coberto pela extensão)"
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
                // Aplica ajustes aprovados do dia para refletir a mesma "visão
                // efetiva" da jornada (faixas editadas + recálculo dos totais).
                const dayKeyIso = day.date.toISOString().slice(0, 10);
                const dayAjustes = history30Ajustes.filter((a) => a.dia === dayKeyIso);
                const dayIdleEvents = history30IdleEvents.get(dayKeyIso) ?? [];
                const effective = aplicarAjustes(day.records, dayAjustes, day.date);

                const totals = { ATIVO: 0, PAUSA: 0, ALMOCO: 0, INATIVO: 0 };
                effective.forEach((r) => {
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
                    <HorizontalTimeline records={effective} idleEvents={dayIdleEvents} />
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
  badge,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
  badge?: React.ReactNode;
  hint?: string;
}) {
  const colors: Record<string, string> = {
    success: "var(--color-success)",
    warning: "var(--color-warning)",
    info: "var(--color-info)",
    destructive: "var(--color-destructive)",
    primary: "var(--color-primary)",
    slate: "var(--color-muted-foreground)",
    idle: "var(--color-idle)",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span
            className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
            title={hint}
          >
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
        {badge && <div className="mt-1">{badge}</div>}
        {hint && !badge && (
          <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

function SourceCard({
  icon,
  label,
  accent,
  trabalhado,
  idle,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  accent: "primary" | "warning" | "info";
  trabalhado: number;
  idle: number;
  hint?: string;
}) {
  const colors: Record<string, string> = {
    primary: "var(--color-primary)",
    warning: "var(--color-warning)",
    info: "var(--color-info)",
  };
  const total = trabalhado + idle;
  const pct = total > 0 ? Math.round((trabalhado / total) * 100) : 0;
  const fmt = (s: number) => (s < 60 ? `${Math.round(s)}s` : formatDuration(s / 60));

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
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold">{fmt(trabalhado)}</span>
          <span className="text-xs text-muted-foreground">trabalhado</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full"
            style={{ width: `${pct}%`, background: colors[accent] }}
          />
        </div>
        {idle > 0 && (
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>{pct}% ativo</span>
            <span className="text-destructive">idle {fmt(idle)}</span>
          </div>
        )}
        {hint && <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>}

      </CardContent>
    </Card>
  );
}



function HorizontalTimeline({
  records,
  idleEvents = [],
}: {
  records: SegmentoEfetivo[];
  idleEvents?: IdleEvent[];
}) {
  // Reaproveita o mapa central; ENCERRADO usa o muted (mais claro) por ser fundo
  // de faixa, não texto. ABONO (atestado/abono aprovado) tem cor própria.
  const colorByStatus: Record<string, string> = {
    ...STATUS_COLOR,
    ENCERRADO: "var(--color-muted)",
    ABONO: ABONO_COLOR,
  };
  const labelByStatus: Record<string, string> = {
    ATIVO: "Ativo",
    PAUSA: "Pausa",
    ALMOCO: "Almoço",
    INATIVO: "Inativo",
    ENCERRADO: "Encerrado",
    ABONO: "Abonado",
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
  const [hover, setHover] = useState<{ x: number; ts: number; rec: SegmentoEfetivo | null } | null>(
    null,
  );

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

  // ATIVO occupies the central band (tall); ABONO (justificado) usa banda média para
  // ficar visível; demais status renderizam como faixas finas centradas.
  // Ajustes (editado) sempre usam faixa fina para não dominar a linha do tempo.
  const dimsForStatus = (s: string, editado?: boolean) => {
    if (editado) return { top: "36%", bottom: "36%" };
    return s === "ATIVO"
      ? { top: "18%", bottom: "18%" }
      : s === "ABONO"
        ? { top: "32%", bottom: "32%" }
        : { top: "40%", bottom: "40%" };
  };

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
          const editado = r.editado;
          const d = dimsForStatus(r.status, editado);
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
                opacity: editado ? 0.95 : isAtivo ? 1 : 0.65,
                // Ajuste aprovado: anel na cor "editado" + topo da pilha, para
                // distinguir visualmente do tracking original.
                zIndex: editado ? 4 : isAtivo ? 2 : 1,
                boxShadow: editado
                  ? `0 0 0 1px ${EDITADO_COLOR}`
                  : isAtivo
                    ? "0 0 0 1px color-mix(in oklch, var(--color-success) 50%, transparent)"
                    : undefined,
              }}
            />
          );
        })}

        {/* Faixas de ociosidade — sobrepostas ao bloco ATIVO, mostram EM QUE
            momento da jornada houve ócio (desktop = apps, web = navegador). */}
        {idleEvents.map((ev, i) => {
          const s = new Date(ev.inicio).getTime();
          const e = new Date(ev.fim).getTime();
          if (e <= axisStart || s >= axisEnd) return null;
          const left = pct(s);
          const width = Math.max(pct(e) - left, 0.3);
          return (
            <div
              key={`idle-${i}`}
              className="pointer-events-none absolute rounded-[1px]"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: "26%",
                bottom: "26%",
                background:
                  "repeating-linear-gradient(45deg, var(--color-muted-foreground) 0, var(--color-muted-foreground) 2px, transparent 2px, transparent 5px)",
                opacity: 0.65,
                zIndex: 3,
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
                  {hover.rec.editado && <span style={{ color: EDITADO_COLOR }}> • editado</span>}
                </div>
              ) : (
                <div className="text-muted-foreground">Offline</div>
              )}
              {(() => {
                const idle = idleEvents.find((ev) => {
                  const s = new Date(ev.inicio).getTime();
                  const e = new Date(ev.fim).getTime();
                  return hover.ts >= s && hover.ts <= e;
                });
                return idle ? (
                  <div className="text-muted-foreground">
                    Ocioso • {formatHM(idle.inicio)} → {formatHM(idle.fim)} (
                    {idle.fonte === "desktop" ? "app" : "web"})
                  </div>
                ) : null;
              })()}
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
        <span className="inline-flex items-center gap-1.5">
          <span
            className="rounded-sm"
            style={{
              width: "10px",
              height: "6px",
              background:
                "repeating-linear-gradient(45deg, var(--color-muted-foreground) 0, var(--color-muted-foreground) 2px, transparent 2px, transparent 5px)",
              opacity: 0.65,
            }}
          />
          Ocioso
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="rounded-sm"
            style={{ background: ABONO_COLOR, width: "10px", height: "6px" }}
          />
          Abonado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="rounded-sm"
            style={{
              width: "10px",
              height: "6px",
              background: "transparent",
              boxShadow: `0 0 0 2px ${EDITADO_COLOR}`,
            }}
          />
          Editado
        </span>
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
