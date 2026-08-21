import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { formatHM, formatDuration, hmFromIso, isoFromHm, diaLocalStr } from "@/lib/format";
import { ocioBlocos, type Intervalo } from "@/lib/ocio";
import {
  intervalosAprovados,
  JUSTIFICATIVA_STATUS_LABEL,
  type JustificativaOcioPayload,
} from "@/lib/justificativas-ocio";
import { ShieldCheck, Pointer, CircleSlash } from "lucide-react";

/**
 * Popup de justificativa de ociosidade. Lista os BLOCOS de ócio efetivos do dia
 * (ócio ∩ ATIVO — os mesmos que somam a coluna "Ocioso" da folha) em cards
 * clicáveis que preenchem início/fim, e pede a justificativa.
 *
 * Dois modos, decididos pelo backend (a RPC é a mesma):
 *  - Gestão (`aprovaDireto`): superadmin/admin lança para o colaborador e a
 *    justificativa entra já 'aprovada' — o desconto aparece na hora.
 *  - Colaborador: solicita para si e entra 'pendente'; não desconta nada até a
 *    gestão aprovar em /aprovacoes.
 */
export function JustificarOcioDialog({
  dia,
  eventos,
  ativos,
  justificativas,
  open,
  onOpenChange,
  onSubmitted,
  usuarioId,
  usuarioNome,
  aprovaDireto = false,
}: {
  dia: Date;
  /** Eventos de ociosidade do dia (brutos). */
  eventos: Intervalo[];
  /** Janelas ATIVO brutas do dia. */
  ativos: Intervalo[];
  /** Justificativas já existentes no dia (qualquer status). */
  justificativas: JustificativaOcioPayload[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmitted?: () => void;
  /** Alvo da justificativa. Sempre explícito: a RPC não tem default para o parâmetro. */
  usuarioId: string;
  usuarioNome?: string | null;
  /** Quando true, a RPC grava já 'aprovada' (gate real é do backend). */
  aprovaDireto?: boolean;
}) {
  const [inicioHm, setInicioHm] = useState("");
  const [fimHm, setFimHm] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [busy, setBusy] = useState(false);

  const nowTs = Date.now();

  // Blocos de ócio efetivos do dia — mesma fonte do número da folha.
  const blocos = useMemo(
    () => ocioBlocos(eventos, ativos, nowTs),
    // nowTs muda a cada render; só recalcula quando os dados mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventos, ativos],
  );

  // Cobertura já aprovada, para esmaecer o que não renderia desconto novo.
  const cobertos = useMemo(() => {
    const aprovados = intervalosAprovados(justificativas).map((j) => [
      new Date(j.inicio).getTime(),
      j.fim ? new Date(j.fim).getTime() : nowTs,
    ]);
    return blocos.map(([ini, fim]) => aprovados.some(([a, b]) => a <= ini && b >= fim));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocos, justificativas]);

  const totalOcioMin = blocos.reduce((acc, [a, b]) => acc + (b - a) / 60000, 0);

  const selecionarBloco = (ini: number, fim: number) => {
    setInicioHm(hmFromIso(new Date(ini).toISOString()));
    setFimHm(hmFromIso(new Date(fim).toISOString()));
  };

  const reset = () => {
    setInicioHm("");
    setFimHm("");
    setJustificativa("");
  };

  const submeter = async () => {
    if (busy) return;
    const p_inicio = isoFromHm(dia, inicioHm);
    const p_fim = isoFromHm(dia, fimHm);
    if (!p_inicio || !p_fim) {
      toast.error("Informe o início e o fim do período.");
      return;
    }
    if (new Date(p_fim).getTime() <= new Date(p_inicio).getTime()) {
      toast.error("O fim deve ser posterior ao início.");
      return;
    }
    if (!justificativa.trim()) {
      toast.error("Informe a justificativa.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc("registrar_justificativa_ociosidade", {
        p_usuario: usuarioId,
        p_dia: diaLocalStr(dia),
        p_inicio,
        p_fim,
        p_justificativa: justificativa.trim(),
      });
      if (error) throw error;
      toast.success(
        aprovaDireto
          ? "Ociosidade justificada."
          : "Justificativa enviada para aprovação da gestão.",
      );
      reset();
      onOpenChange(false);
      onSubmitted?.();
    } catch (err) {
      toast.error("Falha ao justificar", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const diaFormatado = dia.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="gap-1 px-6 pt-6">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-normal">
              {diaFormatado}
            </Badge>
            {totalOcioMin > 0 && (
              <Badge variant="outline" className="font-normal">
                Ocioso: {formatDuration(totalOcioMin)}
              </Badge>
            )}
          </div>
          <DialogTitle className="text-xl">
            {aprovaDireto
              ? `Justificar ociosidade${usuarioNome ? ` · ${usuarioNome}` : ""}`
              : "Justificar ociosidade"}
          </DialogTitle>
          <DialogDescription>
            {aprovaDireto
              ? "O período justificado deixa de contar como ócio no espelho e no ranking de inatividade, imediatamente."
              : "O período justificado só deixa de contar como ócio depois que a gestão aprovar."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-5">
            {/* 1. Blocos ociosos do dia */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">1. Períodos ociosos do dia</h3>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Pointer className="h-3 w-3" />
                  Clique para preencher
                </span>
              </div>

              <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border border-border bg-background p-2">
                {blocos.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Sem ociosidade registrada neste dia.
                  </p>
                ) : (
                  blocos.map(([ini, fim], idx) => {
                    const dur = (fim - ini) / 60000;
                    const jaCoberto = cobertos[idx];
                    return (
                      <button
                        type="button"
                        key={`bloco-${ini}`}
                        onClick={() => selecionarBloco(ini, fim)}
                        className={`flex w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors ${
                          jaCoberto
                            ? "border-dashed border-border bg-muted/30 opacity-60 hover:opacity-100"
                            : "border-border hover:border-primary hover:bg-primary/5"
                        }`}
                        title={
                          jaCoberto
                            ? "Este período já está coberto por uma justificativa aprovada."
                            : "Clique para justificar este período."
                        }
                      >
                        <CircleSlash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-xs">
                            {formatHM(new Date(ini).toISOString())}–
                            {formatHM(new Date(fim).toISOString())}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatDuration(dur)}
                            {jaCoberto ? " · já justificado" : ""}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <Separator />

            {/* 2. Período */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">2. Período a justificar</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ocio-inicio">Início</Label>
                  <Input
                    id="ocio-inicio"
                    type="time"
                    value={inicioHm}
                    onChange={(e) => setInicioHm(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ocio-fim">Fim</Label>
                  <Input
                    id="ocio-fim"
                    type="time"
                    value={fimHm}
                    onChange={(e) => setFimHm(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Só o ócio dentro deste intervalo é descontado — informar um período maior que o
                ocioso não gera desconto extra.
              </p>
            </section>

            <Separator />

            {/* 3. Justificativa */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">3. Justificativa</h3>
              <Textarea
                placeholder="Ex.: reunião presencial com o cliente, treinamento, atendimento fora do computador…"
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                rows={3}
              />
            </section>

            {/* Justificativas já lançadas no dia */}
            {justificativas.length > 0 && (
              <>
                <Separator />
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Justificativas deste dia</h3>
                  <div className="space-y-2">
                    {justificativas.map((j) => (
                      <div
                        key={j.id}
                        className="rounded-md border border-border px-2.5 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono">
                            {formatHM(j.inicio)}–{formatHM(j.fim)}
                          </span>
                          <Badge
                            variant={
                              j.status === "aprovada"
                                ? "default"
                                : j.status === "rejeitada"
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="font-normal"
                          >
                            {JUSTIFICATIVA_STATUS_LABEL[j.status] ?? j.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-muted-foreground">{j.justificativa}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submeter} disabled={busy}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            {aprovaDireto ? "Aplicar justificativa" : "Solicitar justificativa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
