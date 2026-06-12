import { useMemo } from "react";
import { formatDuration } from "@/lib/format";
import type { UserSnapshot } from "@/lib/operacional-snapshot";
import { Activity, Pause, Utensils, Circle, Gauge, Trophy } from "lucide-react";

interface Stats {
  total: number;
  online: number;
  offline: number;
  ATIVO: number;
  PAUSA: number;
  ALMOCO: number;
  INATIVO: number;
}

export function ManagerHud({ snapshots, stats }: { snapshots: UserSnapshot[]; stats: Stats }) {
  const { produtivo, improdutivo, mediaPct, ranking } = useMemo(() => {
    let prod = 0;
    let improd = 0;
    snapshots.forEach((s) => {
      prod += s.totals.ATIVO;
      improd += s.totals.PAUSA + s.totals.ALMOCO + s.totals.INATIVO;
    });
    const denom = prod + improd;
    const ranking = [...snapshots]
      .filter((s) => s.totals.ATIVO > 0)
      .sort((a, b) => b.totals.ATIVO - a.totals.ATIVO)
      .slice(0, 3);
    return {
      produtivo: prod,
      improdutivo: improd,
      mediaPct: denom > 0 ? Math.round((prod / denom) * 100) : 0,
      ranking,
    };
  }, [snapshots]);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Metric
        icon={<Activity className="h-4 w-4" />}
        label="Trabalhando"
        value={stats.ATIVO}
        tone="success"
      />
      <Metric
        icon={<Pause className="h-4 w-4" />}
        label="Pausa"
        value={stats.PAUSA}
        tone="warning"
      />
      <Metric
        icon={<Utensils className="h-4 w-4" />}
        label="Almoço"
        value={stats.ALMOCO}
        tone="info"
      />
      <Metric
        icon={<Circle className="h-4 w-4" />}
        label="Offline"
        value={stats.offline}
        sub={`/ ${stats.total}`}
        tone="muted"
      />
      <Metric
        icon={<Gauge className="h-4 w-4" />}
        label="Produtividade média"
        value={`${mediaPct}%`}
        tone="primary"
      />
      <div className="rounded-lg border bg-card p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Trophy className="h-4 w-4 text-warning" /> Ranking do dia
        </div>
        <div className="mt-1 space-y-0.5">
          {ranking.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">Sem dados ainda</div>
          ) : (
            ranking.map((s, i) => (
              <div
                key={s.profile.id}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
                <span className="truncate">
                  {i + 1}. {s.profile.nome.split(" ")[0]}
                </span>
                <span className="font-mono text-muted-foreground">
                  {formatDuration(s.totals.ATIVO)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="col-span-2 flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-xs sm:col-span-3 lg:col-span-6">
        <span className="text-muted-foreground">
          Tempo produtivo total:{" "}
          <b className="font-mono text-success">{formatDuration(produtivo)}</b>
        </span>
        <span className="text-muted-foreground">
          Improdutivo: <b className="font-mono text-foreground">{formatDuration(improdutivo)}</b>
        </span>
        <span className="text-muted-foreground">
          Online agora: <b className="font-mono">{stats.online}</b> / {stats.total}
        </span>
      </div>
    </div>
  );
}

const TONES: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  primary: "text-primary",
  muted: "text-muted-foreground",
};

function Metric({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  tone: keyof typeof TONES | string;
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <span className={TONES[tone] ?? ""}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={`text-xl font-bold ${TONES[tone] ?? ""}`}>{value}</span>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}
