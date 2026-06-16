import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Medal, Award } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { ocioReconciliadoSeg } from "@/lib/ocio";

export const Route = createFileRoute("/_authenticated/ranking")({
  head: () => ({ meta: [{ title: "Ranking de Produtividade" }] }),
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const isAdmin = !!roles?.some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/" });
  },
  component: RankingPage,
});

type Period = "day" | "week" | "month";

function rangeFor(period: Period) {
  const now = new Date();
  const start = new Date(now);
  if (period === "day") start.setHours(0, 0, 0, 0);
  else if (period === "week") {
    start.setDate(now.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(now.getDate() - 30);
    start.setHours(0, 0, 0, 0);
  }
  return { from: start.toISOString(), to: now.toISOString() };
}

function RankingPage() {
  const [period, setPeriod] = useState<Period>("day");
  const [data, setData] = useState<
    {
      id: string;
      nome: string;
      ativo: number;
      ocio: number;
      efetivo: number;
      total: number;
      pct: number;
    }[]
  >([]);

  useEffect(() => {
    const { from, to } = rangeFor(period);
    (async () => {
      const [{ data: rows }, { data: evs }] = await Promise.all([
        supabase
          .from("registros_atividade")
          .select("usuario_id, status, inicio, fim, duracao_minutos, profiles(nome)")
          .gte("inicio", from)
          .lte("inicio", to),
        // Intervalos de ociosidade do periodo (fonte unica do ocio). Guarda
        // contra o teto de 1000 do PostgREST (periodos longos podem subnotificar
        // ate a agregacao server-side existir).
        supabase
          .from("eventos_ociosidade")
          .select("usuario_id, inicio, fim")
          .gte("inicio", from)
          .lte("inicio", to)
          .order("inicio", { ascending: false })
          .limit(5000),
      ]);
      const nowTs = Date.now();
      type RankRow = {
        usuario_id: string;
        status: string;
        inicio: string;
        fim: string | null;
        duracao_minutos: number | null;
        profiles?: { nome: string | null } | null;
      };
      // Eventos de ocio agrupados por usuario.
      const eventosByUser = new Map<string, { inicio: string; fim: string | null }[]>();
      ((evs ?? []) as { usuario_id: string; inicio: string; fim: string | null }[]).forEach((e) => {
        const list = eventosByUser.get(e.usuario_id) ?? [];
        list.push({ inicio: e.inicio, fim: e.fim });
        eventosByUser.set(e.usuario_id, list);
      });
      const map = new Map<
        string,
        {
          nome: string;
          ativo: number;
          total: number;
          ativos: { inicio: string; fim: string | null }[];
        }
      >();
      ((rows ?? []) as unknown as RankRow[]).forEach((r) => {
        const dur =
          r.duracao_minutos ??
          (r.fim
            ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000
            : (nowTs - new Date(r.inicio).getTime()) / 60000);
        if (r.status === "ENCERRADO") return;
        if (!map.has(r.usuario_id))
          map.set(r.usuario_id, { nome: r.profiles?.nome ?? "—", ativo: 0, total: 0, ativos: [] });
        const bucket = map.get(r.usuario_id)!;
        bucket.total += dur;
        if (r.status === "ATIVO") {
          bucket.ativo += dur;
          bucket.ativos.push({ inicio: r.inicio, fim: r.fim });
        }
      });
      const arr = Array.from(map.entries())
        .map(([id, v]) => {
          // Ocio (min) = merge eventos ∩ janelas ATIVO. Efetivo = ATIVO - ocio.
          const ocio = ocioReconciliadoSeg(eventosByUser.get(id) ?? [], v.ativos, nowTs) / 60;
          const efetivo = Math.max(0, v.ativo - ocio);
          return {
            id,
            nome: v.nome,
            ativo: v.ativo,
            ocio,
            efetivo,
            total: v.total,
            // Produtividade CIENTE DO OCIO: tempo efetivo / total.
            pct: v.total > 0 ? (efetivo / v.total) * 100 : 0,
          };
        })
        .sort((a, b) => b.pct - a.pct);
      setData(arr);
    })();
  }, [period]);

  const icons = [Trophy, Medal, Award];
  const colors = ["text-warning", "text-muted-foreground", "text-info"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ranking de Produtividade</h1>
        <p className="text-sm text-muted-foreground">
          Tempo Efetivo (Ativo − Ócio) ÷ Tempo Total do Expediente
        </p>
      </div>

      <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <TabsList>
          <TabsTrigger value="day">Hoje</TabsTrigger>
          <TabsTrigger value="week">7 dias</TabsTrigger>
          <TabsTrigger value="month">30 dias</TabsTrigger>
        </TabsList>
        <TabsContent value={period}>
          <Card>
            <CardHeader>
              <CardTitle>Classificação</CardTitle>
            </CardHeader>
            <CardContent>
              {data.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Sem dados no período.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.map((u, i) => {
                    const Icon = icons[i] ?? Trophy;
                    return (
                      <li key={u.id} className="flex items-center gap-4 py-4">
                        <div
                          className={`grid h-10 w-10 place-items-center rounded-full bg-muted ${colors[i] ?? "text-muted-foreground"}`}
                        >
                          {i < 3 ? (
                            <Icon className="h-5 w-5" />
                          ) : (
                            <span className="text-sm font-semibold">{i + 1}</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">{u.nome}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDuration(u.efetivo)} efetivo · {formatDuration(u.ocio)} ócio ·{" "}
                            {formatDuration(u.total)} total
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.min(100, u.pct)}%` }}
                            />
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-primary">{u.pct.toFixed(1)}%</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
