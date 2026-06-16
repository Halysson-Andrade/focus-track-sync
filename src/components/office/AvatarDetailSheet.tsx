import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMensagensEnviadas, statusMensagem } from "@/hooks/use-mensagens";
import { StatusBadge } from "@/components/StatusBadge";
import { formatAgo, formatDuration, formatHM, STATUS_COLOR } from "@/lib/format";
import type { NavRow, Registro, UserSnapshot } from "@/lib/operacional-snapshot";
import {
  Chrome,
  Monitor,
  Globe,
  Clock,
  MonitorPlay,
  Layers,
  Send,
  MessageSquare,
} from "lucide-react";

const STATUS_MSG_LABEL: Record<string, string> = {
  pendente: "Pendente",
  entregue: "Entregue",
  lida: "Lida",
};
const STATUS_MSG_CLASS: Record<string, string> = {
  pendente: "text-muted-foreground",
  entregue: "text-amber-600 dark:text-amber-400",
  lida: "text-emerald-600 dark:text-emerald-400",
};

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
  const { mensagens, refetch: refetchMensagens } = useMensagensEnviadas(uid);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviarMensagem() {
    if (!uid || !texto.trim() || enviando) return;
    setEnviando(true);
    const { error } = await supabase.rpc("enviar_notificacao", {
      p_destinatario: uid,
      p_conteudo: texto.trim(),
    });
    setEnviando(false);
    if (error) {
      toast.error(error.message ?? "Falha ao enviar a mensagem");
      return;
    }
    setTexto("");
    toast.success("Mensagem enviada");
    void refetchMensagens();
  }

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
                {/* Enviar mensagem (sobe como notificação no Chrome da pessoa) */}
                <section>
                  <SectionTitle icon={<Send className="h-4 w-4" />}>Enviar mensagem</SectionTitle>
                  <Textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void enviarMensagem();
                      }
                    }}
                    placeholder={`Mensagem para ${s.profile.nome.split(" ")[0]}…`}
                    rows={3}
                    className="resize-none text-sm"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Sobe como notificação no Chrome (⌘/Ctrl+Enter)
                    </span>
                    <Button
                      size="sm"
                      onClick={() => void enviarMensagem()}
                      disabled={!texto.trim() || enviando}
                    >
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                      {enviando ? "Enviando…" : "Enviar"}
                    </Button>
                  </div>
                </section>

                {/* Histórico de mensagens enviadas */}
                <section>
                  <SectionTitle icon={<MessageSquare className="h-4 w-4" />}>
                    Mensagens enviadas
                  </SectionTitle>
                  <div className="space-y-1.5">
                    {mensagens.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhuma mensagem enviada.</p>
                    ) : (
                      mensagens.map((m) => {
                        const st = statusMensagem(m);
                        return (
                          <div
                            key={m.id}
                            className="rounded-md border bg-card px-2.5 py-1.5 text-sm"
                          >
                            <div className="whitespace-pre-wrap break-words">{m.conteudo}</div>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {formatHM(m.criado_em)}
                              </span>
                              <span className={`text-[11px] font-medium ${STATUS_MSG_CLASS[st]}`}>
                                {STATUS_MSG_LABEL[st]}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                {/* Tela atual: prioriza a fonte AO VIVO (app desktop em foco ou URL live);
                    quando nenhuma está live, mostra a mais recente com "há X". O navegador
                    aparece como "Última navegação" quando não é a tela atual. */}
                {(() => {
                  const cands: {
                    label: string;
                    sub?: string;
                    live: boolean;
                    ageMs: number;
                    isBrowser: boolean;
                  }[] = [];
                  if (s.lastDesktopApp)
                    cands.push({
                      label: s.lastDesktopApp.label,
                      live: s.lastDesktopApp.live,
                      ageMs: s.lastDesktopApp.ageMs,
                      isBrowser: false,
                    });
                  if (s.lastUrl)
                    cands.push({
                      label: s.lastUrl.title,
                      sub: s.lastUrl.domain,
                      live: s.lastUrl.live,
                      ageMs: s.lastUrl.ageMs,
                      isBrowser: true,
                    });
                  // live primeiro; entre iguais, o de menor idade (mais recente).
                  cands.sort((a, b) => Number(b.live) - Number(a.live) || a.ageMs - b.ageMs);
                  const cur =
                    cands[0] ??
                    (s.lastAppPage
                      ? { label: s.lastAppPage.title, live: false, ageMs: 0, isBrowser: false }
                      : null);
                  const browserSecondary = !cur?.isBrowser && s.lastUrl ? s.lastUrl : null;
                  return (
                    <section>
                      <SectionTitle icon={<MonitorPlay className="h-4 w-4" />}>
                        Tela atual
                      </SectionTitle>
                      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{cur?.label ?? "—"}</span>
                          {cur &&
                            (cur.live ? (
                              <span className="shrink-0 text-[10px] font-semibold text-[var(--color-success)]">
                                ● ao vivo
                              </span>
                            ) : (
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {formatAgo(cur.ageMs)}
                              </span>
                            ))}
                        </div>
                        {cur?.sub && (
                          <div className="truncate text-xs text-muted-foreground">{cur.sub}</div>
                        )}
                        {browserSecondary && (
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            Última navegação: {browserSecondary.domain || browserSecondary.title} ·{" "}
                            {browserSecondary.live ? "ao vivo" : formatAgo(browserSecondary.ageMs)}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>
                            Extensão {s.extActive ? "monitorando" : "sem sinal"}
                            {s.extVersion ? ` · v${s.extVersion}` : ""}
                          </span>
                          <span>
                            Desktop {s.desktopActive ? "monitorando" : "sem sinal"}
                            {s.desktopVersion ? ` · v${s.desktopVersion}` : ""}
                          </span>
                        </div>
                      </div>
                    </section>
                  );
                })()}

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
