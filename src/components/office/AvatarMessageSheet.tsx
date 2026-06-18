import { useState } from "react";
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
import { formatHM, STATUS_COLOR } from "@/lib/format";
import type { UserSnapshot } from "@/lib/operacional-snapshot";
import { Send, MessageSquare } from "lucide-react";

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
  onClose: () => void;
}

/**
 * Barra lateral enxuta — só envio/histórico de mensagem. Usada quando o avatar
 * NÃO é inspecionável pelo perfil atual (user comum; admin fora da sua área).
 * Reaproveita a RPC enviar_notificacao e o hook de histórico do painel detalhado.
 */
export function AvatarMessageSheet({ selected, onClose }: Props) {
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

  const s = selected;

  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-hidden p-0 sm:max-w-md">
        {s && (
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
              </div>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="space-y-5 p-5">
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Send className="h-4 w-4" /> Enviar mensagem
                  </h3>
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

                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <MessageSquare className="h-4 w-4" /> Mensagens enviadas
                  </h3>
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
              </div>
            </ScrollArea>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
