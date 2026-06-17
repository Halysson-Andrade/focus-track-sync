import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  useAtividades,
  type Atividade,
  type Apontamento,
  type AtividadeProfile,
} from "@/hooks/use-atividades";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatHM, formatDate } from "@/lib/format";
import {
  Timer,
  Play,
  Square,
  Mail,
  Trello,
  SquareKanban,
  Clock,
  Search,
  ExternalLink,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/atividades")({
  head: () => ({ meta: [{ title: "Atividades — Controle de Atividade" }] }),
  component: AtividadesPage,
});

const FONTE_LABEL: Record<string, string> = {
  trello: "Trello",
  azure: "Azure DevOps",
  gmail: "Gmail",
  outlook: "Outlook",
  manual: "Manual",
};

function FonteIcon({ fonte, className }: { fonte: string; className?: string }) {
  if (fonte === "trello") return <Trello className={className} />;
  if (fonte === "azure") return <SquareKanban className={className} />;
  if (fonte === "gmail" || fonte === "outlook") return <Mail className={className} />;
  return <Clock className={className} />;
}

function fmtTotal(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}min`;
  return `${h}h ${m.toString().padStart(2, "0")}min`;
}

function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (h > 0 ? `${h}:` : "") + `${pad(m)}:${pad(ss)}`;
}

interface AtividadeView {
  atividade: Atividade;
  segmentos: Apontamento[];
  totalSegundos: number;
  running: boolean;
  ultimaExecucao: string | null;
}

function AtividadesPage() {
  const { user, isAdmin } = useAuth();
  const { atividades, apontamentos, profiles, connected } = useAtividades(true, isAdmin, user?.id);
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Ticker de 1s para o cronômetro das atividades em andamento.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const views: AtividadeView[] = useMemo(() => {
    const byAtividade = new Map<string, Apontamento[]>();
    for (const ap of apontamentos) {
      const list = byAtividade.get(ap.atividade_id) ?? [];
      list.push(ap);
      byAtividade.set(ap.atividade_id, list);
    }
    return atividades.map((atividade) => {
      const segmentos = byAtividade.get(atividade.id) ?? [];
      const open = segmentos.find((s) => !s.fim);
      // total = acumulado denormalizado + o segmento aberto correndo agora.
      const liveOpen = open ? (now - new Date(open.inicio).getTime()) / 1000 : 0;
      const ultima = segmentos
        .map((s) => s.fim ?? s.inicio)
        .sort()
        .reverse()[0];
      return {
        atividade,
        segmentos,
        totalSegundos: Number(atividade.total_segundos) + liveOpen,
        running: !!open,
        ultimaExecucao: ultima ?? atividade.atualizado_em,
      };
    });
  }, [atividades, apontamentos, now]);

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const list = views.filter((v) => {
      if (!term) return true;
      const pessoa = profiles.get(v.atividade.usuario_id);
      return (
        v.atividade.titulo.toLowerCase().includes(term) ||
        (v.atividade.contexto ?? "").toLowerCase().includes(term) ||
        (FONTE_LABEL[v.atividade.fonte] ?? "").toLowerCase().includes(term) ||
        (pessoa?.nome ?? "").toLowerCase().includes(term) ||
        (pessoa?.email ?? "").toLowerCase().includes(term)
      );
    });
    // Em andamento primeiro; depois por última execução desc.
    return list.sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1;
      return (b.ultimaExecucao ?? "").localeCompare(a.ultimaExecucao ?? "");
    });
  }, [views, filter, profiles]);

  const totalGeralSeg = useMemo(
    () => filtered.reduce((acc, v) => acc + v.totalSegundos, 0),
    [filtered],
  );
  const emAndamento = filtered.filter((v) => v.running).length;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Timer className="h-6 w-6" /> Atividades
          </h1>
          <p className="text-sm text-muted-foreground">
            Apontamentos de tempo por item (card, e-mail) registrados pela extensão.
            {isAdmin && " Você vê as atividades de toda a equipe."}
          </p>
        </div>
        <Badge variant={connected ? "default" : "secondary"} className="gap-1">
          {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {connected ? "Ao vivo" : "Reconectando"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard label="Atividades" value={String(filtered.length)} icon={Timer} />
        <KpiCard label="Em andamento" value={String(emAndamento)} icon={Play} />
        <KpiCard label="Tempo total" value={fmtTotal(totalGeralSeg)} icon={Clock} />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={isAdmin ? "Buscar por título, contexto ou pessoa…" : "Buscar atividade…"}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma atividade apontada ainda. Inicie o expediente (ATIVO), abra um card do Trello /
            Azure ou um e-mail e clique em <strong>Iniciar</strong> no widget da extensão.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((v) => (
            <AtividadeCard
              key={v.atividade.id}
              view={v}
              isAdmin={isAdmin}
              pessoa={profiles.get(v.atividade.usuario_id)}
              expanded={expanded.has(v.atividade.id)}
              onToggle={() => toggle(v.atividade.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Timer;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-2 p-4">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function AtividadeCard({
  view,
  isAdmin,
  pessoa,
  expanded,
  onToggle,
}: {
  view: AtividadeView;
  isAdmin: boolean;
  pessoa: AtividadeProfile | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { atividade, segmentos, totalSegundos, running } = view;
  return (
    <Card className={running ? "border-l-4 border-l-[var(--color-success)]" : undefined}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <FonteIcon fonte={atividade.fonte} className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {FONTE_LABEL[atividade.fonte] ?? atividade.fonte}
            </span>
          </div>
          {running ? (
            <Badge className="gap-1 bg-[var(--color-success)] text-white">
              <Play className="h-3 w-3" /> Em andamento
            </Badge>
          ) : (
            <Square className="h-3 w-3 text-muted-foreground" />
          )}
        </div>

        <div className="font-semibold leading-snug line-clamp-2" title={atividade.titulo}>
          {atividade.external_url ? (
            <a
              href={atividade.external_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-start gap-1 hover:underline"
            >
              {atividade.titulo}
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
            </a>
          ) : (
            atividade.titulo
          )}
        </div>

        {atividade.contexto && (
          <div className="text-xs text-muted-foreground">{atividade.contexto}</div>
        )}

        {isAdmin && (
          <div className="text-xs text-muted-foreground">
            {pessoa?.nome ?? pessoa?.email ?? "—"}
          </div>
        )}

        <div className="flex items-baseline justify-between">
          <span
            className={`font-mono text-lg font-bold tabular-nums ${
              running ? "text-[var(--color-success)]" : ""
            }`}
          >
            {running ? fmtClock(totalSegundos) : fmtTotal(totalSegundos)}
          </span>
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {segmentos.length} apontamento{segmentos.length === 1 ? "" : "s"}
          </button>
        </div>

        {expanded && segmentos.length > 0 && (
          <ul className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
            {segmentos.slice(0, 20).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span>
                  {formatDate(s.inicio)} · {formatHM(s.inicio)}–{s.fim ? formatHM(s.fim) : "agora"}
                </span>
                <span className="font-mono tabular-nums">
                  {s.fim ? fmtTotal(Number(s.duracao_segundos ?? 0)) : "em curso"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
