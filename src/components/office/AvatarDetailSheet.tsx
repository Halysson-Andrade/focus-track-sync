import { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDuration, formatHM, STATUS_COLOR } from "@/lib/format";
import type { NavRow, Registro, UserSnapshot } from "@/lib/operacional-snapshot";
import { Chrome, Monitor, Globe, Clock, MonitorPlay, Layers } from "lucide-react";

interface Props {
  selected: UserSnapshot | null;
  registros: Registro[];
  navApp: NavRow[];
  navExt: NavRow[];
  navDesk: NavRow[];
  nowTs: number;
  onClose: () => void;
}

function durSec(n: NavRow, nowTs: number): number {
  const d =
    n.duracao_segundos ??
    (n.fim
      ? (new Date(n.fim).getTime() - new Date(n.inicio).getTime()) / 1000
      : (nowTs - new Date(n.inicio).getTime()) / 1000);
  return Math.max(0, d);
}

export function AvatarDetailSheet({
  selected,
  registros,
  navApp,
  navExt,
  navDesk,
  nowTs,
  onClose,
}: Props) {
  const uid = selected?.profile.id;

  const data = useMemo(() => {
    if (!uid) return null;
    const myReg = registros
      .filter((r) => r.usuario_id === uid)
      .sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime());

    // Apps/sites agregados por tempo
    const agg = new Map<string, { label: string; kind: "app" | "web"; sec: number }>();
    for (const n of navDesk) {
      if (n.usuario_id !== uid) continue;
      const label = n.app_label || n.process_name || "App";
      const cur = agg.get("a:" + label) ?? { label, kind: "app" as const, sec: 0 };
      cur.sec += durSec(n, nowTs);
      agg.set("a:" + label, cur);
    }
    for (const n of navExt) {
      if (n.usuario_id !== uid) continue;
      const label = n.domain || n.title || "Site";
      const cur = agg.get("w:" + label) ?? { label, kind: "web" as const, sec: 0 };
      cur.sec += durSec(n, nowTs);
      agg.set("w:" + label, cur);
    }
    const apps = [...agg.values()].sort((a, b) => b.sec - a.sec).slice(0, 12);

    // Histórico das últimas telas
    const screens = [
      ...navExt
        .filter((n) => n.usuario_id === uid && n.url)
        .map((n) => ({
          when: n.inicio,
          title: n.title || n.domain || n.url || "",
          sub: n.domain || "",
          kind: "web" as const,
        })),
      ...navDesk
        .filter((n) => n.usuario_id === uid && (n.app_label || n.process_name))
        .map((n) => ({
          when: n.inicio,
          title: n.app_label || n.process_name || "",
          sub: "Desktop",
          kind: "app" as const,
        })),
      ...navApp
        .filter((n) => n.usuario_id === uid && n.path)
        .map((n) => ({
          when: n.inicio,
          title: n.title || n.path || "",
          sub: n.path || "",
          kind: "page" as const,
        })),
    ]
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
      .slice(0, 10);

    // Trocas de contexto nos últimos 30 min
    const since = nowTs - 30 * 60 * 1000;
    const ctx = new Set<string>();
    for (const n of navExt)
      if (n.usuario_id === uid && new Date(n.inicio).getTime() >= since && n.domain)
        ctx.add("w:" + n.domain);
    for (const n of navDesk)
      if (
        n.usuario_id === uid &&
        new Date(n.inicio).getTime() >= since &&
        (n.app_label || n.process_name)
      )
        ctx.add("a:" + (n.app_label || n.process_name));

    return { myReg, apps, screens, switches: ctx.size };
  }, [uid, registros, navApp, navExt, navDesk, nowTs]);

  const s = selected;

  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-hidden p-0 sm:max-w-md">
        {s && data && (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b p-5">
              <div className="flex items-center gap-3">
                <span
                  className="grid h-11 w-11 place-items-center rounded-full text-sm font-bold text-white"
                  style={{
                    background: STATUS_COLOR[s.currentStatus] ?? "var(--color-muted-foreground)",
                  }}
                >
                  {s.profile.nome
                    .split(" ")
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{s.profile.nome}</SheetTitle>
                  <SheetDescription className="truncate">
                    {s.profile.cargo || s.profile.email}
                  </SheetDescription>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                {s.isOnline ? (
                  <StatusBadge status={s.currentStatus} />
                ) : (
                  <span className="text-xs text-muted-foreground">Offline</span>
                )}
                <span className="text-xs text-muted-foreground">
                  · {data.switches} trocas de contexto (30min)
                </span>
              </div>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="space-y-5 p-5">
                {/* Tela atual */}
                <section>
                  <SectionTitle icon={<MonitorPlay className="h-4 w-4" />}>Tela atual</SectionTitle>
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="truncate font-medium">
                      {s.lastUrl?.title || s.lastDesktopApp?.label || s.lastAppPage?.title || "—"}
                    </div>
                    {s.lastUrl?.domain && (
                      <div className="truncate text-xs text-muted-foreground">
                        {s.lastUrl.domain}
                      </div>
                    )}
                  </div>
                </section>

                {/* Aplicações utilizadas */}
                <section>
                  <SectionTitle icon={<Layers className="h-4 w-4" />}>
                    Aplicações & sites (tempo hoje)
                  </SectionTitle>
                  <div className="space-y-1.5">
                    {data.apps.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sem dados hoje.</p>
                    ) : (
                      data.apps.map((a) => (
                        <div
                          key={a.kind + a.label}
                          className="flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {a.kind === "web" ? (
                              <Chrome className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate">{a.label}</span>
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {formatDuration(a.sec / 60)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                {/* Histórico de telas */}
                <section>
                  <SectionTitle icon={<Globe className="h-4 w-4" />}>Últimas telas</SectionTitle>
                  <div className="space-y-1">
                    {data.screens.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sem histórico hoje.</p>
                    ) : (
                      data.screens.map((sc, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <span className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                            {formatHM(sc.when)}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate">{sc.title}</div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {sc.sub}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                {/* Linha do tempo de atividade */}
                <section>
                  <SectionTitle icon={<Clock className="h-4 w-4" />}>
                    Linha do tempo (hoje)
                  </SectionTitle>
                  <div className="space-y-1">
                    {data.myReg.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sem registros hoje.</p>
                    ) : (
                      data.myReg.map((r) => {
                        const dur =
                          r.duracao_minutos ??
                          (r.fim
                            ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000
                            : (nowTs - new Date(r.inicio).getTime()) / 60000);
                        return (
                          <div key={r.id} className="flex items-center gap-2 text-sm">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{
                                background:
                                  STATUS_COLOR[r.status] ?? "var(--color-muted-foreground)",
                              }}
                            />
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {formatHM(r.inicio)}
                              {r.fim ? `–${formatHM(r.fim)}` : "…"}
                            </span>
                            <span className="text-xs">{r.status}</span>
                            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                              {formatDuration(dur)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              </div>
            </ScrollArea>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </h3>
  );
}
