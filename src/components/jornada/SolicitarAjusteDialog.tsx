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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  formatHM,
  formatDuration,
  STATUS_LABEL,
  STATUS_COLOR,
  AJUSTE_TIPO_LABEL,
  hmFromIso,
  isoFromHm,
  diaLocalStr,
} from "@/lib/format";
import { Clock, FileText, CalendarCheck, ArrowRight, Pointer } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type AjusteTipo = Database["public"]["Enums"]["ajuste_tipo"];

type RegistroLinha = {
  id: string;
  status: string;
  inicio: string;
  fim: string | null;
  duracao_minutos: number | null;
};

const STATUS_ALVO_OPCOES = ["ATIVO", "PAUSA", "ALMOCO", "INATIVO"] as const;

const TIPO_ICON: Record<AjusteTipo, React.ReactNode> = {
  ajuste_periodo: <Clock className="h-4 w-4" />,
  atestado: <FileText className="h-4 w-4" />,
  abono: <CalendarCheck className="h-4 w-4" />,
};

/**
 * Popup de ajuste de jornada. Mostra os eventos do dia em cards clicáveis
 * (pré-preenchem o período), organiza os campos em seções e envia o ajuste.
 *
 * Dois modos:
 *  - Padrão (dashboard): o próprio colaborador solicita via RPC solicitar_ajuste_jornada;
 *    entra como 'pendente' para aprovação da gestão.
 *  - Gestão (espelho de ponto, `aprovaDireto`): superadmin/admin lança para um colaborador
 *    (`usuarioId`) via RPC registrar_ajuste_jornada; entra já 'aprovada' (aplicado direto).
 *    O gate real é do backend — o front só ajusta a cópia e a RPC.
 */
export function SolicitarAjusteDialog({
  dia,
  records,
  open,
  onOpenChange,
  onSubmitted,
  usuarioId,
  usuarioNome,
  aprovaDireto = false,
}: {
  dia: Date;
  records: RegistroLinha[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmitted?: () => void;
  /** Alvo do ajuste; ausente = o próprio usuário logado. */
  usuarioId?: string;
  usuarioNome?: string | null;
  /** Quando true, aplica direto (RPC registrar_ajuste_jornada, status 'aprovada'). */
  aprovaDireto?: boolean;
}) {
  const [tipo, setTipo] = useState<AjusteTipo>("ajuste_periodo");
  const [statusAlvo, setStatusAlvo] = useState<string>("ATIVO");
  const [inicioHm, setInicioHm] = useState("");
  const [fimHm, setFimHm] = useState("");
  const [diaInteiro, setDiaInteiro] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [busy, setBusy] = useState(false);

  const nowTs = Date.now();
  // Só faz sentido estender a última lacuna "até agora" quando o dia é hoje. Para dias
  // passados (espelho de ponto), isso criaria um gap gigante do último registro até o
  // momento atual — irrelevante e confuso.
  const isHoje = diaLocalStr(dia) === diaLocalStr(new Date());
  const linhas = useMemo(
    () => [...records].sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()),
    [records],
  );

  // Lacunas: intervalos SEM tracking entre o fim de um registro e o início do próximo
  // (ou entre o fim do último e "agora"). Aparecem como itens clicáveis para o usuário
  // converter para ATIVO via ajuste de período.
  type Gap = { kind: "gap"; inicio: string; fim: string };
  type Linha = (RegistroLinha & { kind: "rec" }) | Gap;
  const itens = useMemo<Linha[]>(() => {
    const out: Linha[] = [];
    const MIN_GAP_MS = 60_000; // ignora lacunas <1min (ruído)
    let cursorFim: number | null = null;
    for (const r of linhas) {
      const ini = new Date(r.inicio).getTime();
      if (cursorFim != null && ini - cursorFim >= MIN_GAP_MS) {
        out.push({
          kind: "gap",
          inicio: new Date(cursorFim).toISOString(),
          fim: new Date(ini).toISOString(),
        });
      }
      out.push({ ...r, kind: "rec" });
      const fim = r.fim ? new Date(r.fim).getTime() : null;
      if (fim != null) cursorFim = Math.max(cursorFim ?? 0, fim);
      else cursorFim = null; // registro aberto cobre até agora
    }
    if (isHoje && cursorFim != null && nowTs - cursorFim >= MIN_GAP_MS) {
      out.push({
        kind: "gap",
        inicio: new Date(cursorFim).toISOString(),
        fim: new Date(nowTs).toISOString(),
      });
    }
    return out;
  }, [linhas, nowTs, isHoje]);

  const precisaPeriodo = tipo === "ajuste_periodo" || !diaInteiro;

  const reset = () => {
    setTipo("ajuste_periodo");
    setStatusAlvo("ATIVO");
    setInicioHm("");
    setFimHm("");
    setDiaInteiro(false);
    setJustificativa("");
  };

  const selecionarLinha = (r: RegistroLinha) => {
    setInicioHm(hmFromIso(r.inicio));
    setFimHm(hmFromIso(r.fim));
    setDiaInteiro(false);
  };

  const selecionarLacuna = (g: Gap) => {
    setInicioHm(hmFromIso(g.inicio));
    setFimHm(hmFromIso(g.fim));
    setDiaInteiro(false);
    setTipo("ajuste_periodo");
    setStatusAlvo("ATIVO");
  };

  const submit = async () => {
    if (busy) return;
    if (!justificativa.trim()) {
      toast.error("Informe a justificativa da solicitação.");
      return;
    }

    let p_inicio: string | undefined;
    let p_fim: string | undefined;
    let p_status_alvo: string | undefined;

    if (tipo === "ajuste_periodo") {
      p_status_alvo = statusAlvo;
      p_inicio = isoFromHm(dia, inicioHm) ?? undefined;
      p_fim = isoFromHm(dia, fimHm) ?? undefined;
      if (!p_inicio || !p_fim) {
        toast.error("Informe início e fim do período.");
        return;
      }
    } else if (!diaInteiro) {
      p_inicio = isoFromHm(dia, inicioHm) ?? undefined;
      p_fim = isoFromHm(dia, fimHm) ?? undefined;
      if (!p_inicio || !p_fim) {
        toast.error("Informe o período ou marque “dia inteiro”.");
        return;
      }
    }
    if (p_inicio && p_fim && new Date(p_fim) <= new Date(p_inicio)) {
      toast.error("O fim deve ser posterior ao início.");
      return;
    }

    setBusy(true);
    try {
      const statusAlvoArg = p_status_alvo as
        | Database["public"]["Enums"]["activity_status"]
        | undefined;
      // Modo gestão (espelho): aplica direto para o colaborador-alvo. Modo padrão
      // (dashboard): o próprio usuário solicita e entra para aprovação.
      const { error } = aprovaDireto
        ? await supabase.rpc("registrar_ajuste_jornada", {
            p_usuario: usuarioId as string,
            p_dia: diaLocalStr(dia),
            p_tipo: tipo,
            p_justificativa: justificativa.trim(),
            p_inicio,
            p_fim,
            p_status_alvo: statusAlvoArg,
          })
        : await supabase.rpc("solicitar_ajuste_jornada", {
            p_dia: diaLocalStr(dia),
            p_tipo: tipo,
            p_justificativa: justificativa.trim(),
            p_inicio,
            p_fim,
            p_status_alvo: statusAlvoArg,
          });
      if (error) throw error;
      toast.success(aprovaDireto ? "Ajuste aplicado." : "Solicitação enviada para aprovação.");
      reset();
      onOpenChange(false);
      onSubmitted?.();
    } catch (err) {
      toast.error((err as Error).message ?? "Não foi possível enviar o ajuste.");
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
          </div>
          <DialogTitle className="text-xl">
            {aprovaDireto
              ? `Ajustar jornada${usuarioNome ? ` · ${usuarioNome}` : ""}`
              : "Solicitar ajuste de jornada"}
          </DialogTitle>
          <DialogDescription>
            {aprovaDireto
              ? "Escolha um período, o tipo de ajuste e a justificativa. O ajuste é aplicado imediatamente."
              : "Escolha um período, o tipo de ajuste e a justificativa. A solicitação entra para aprovação da gestão."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-5">
            {/* 1. Selecione o período */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">1. Selecione o período</h3>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Pointer className="h-3 w-3" />
                  Clique num evento para preencher
                </span>
              </div>

              <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border border-border bg-background p-2">
                {itens.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">Sem registros neste dia.</p>
                ) : (
                  itens.map((it, idx) => {
                    if (it.kind === "gap") {
                      const dur = (new Date(it.fim).getTime() - new Date(it.inicio).getTime()) / 60000;
                      return (
                        <button
                          type="button"
                          key={`gap-${idx}-${it.inicio}`}
                          onClick={() => selecionarLacuna(it)}
                          className="flex w-full items-center gap-3 rounded-md border border-dashed border-warning/50 bg-warning/5 px-2.5 py-2 text-left transition-colors hover:border-warning hover:bg-warning/10"
                          title="Sem tracking neste intervalo. Clique para solicitar conversão para ATIVO."
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border-2"
                            style={{ background: "transparent", borderColor: "var(--color-warning)" }}
                          />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium text-warning">
                              Sem tracking · clique para converter em ATIVO
                            </span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {formatHM(it.inicio)}–{formatHM(it.fim)}
                            </span>
                          </div>
                          <span className="ml-auto font-mono text-[11px] text-warning">
                            {formatDuration(dur)}
                          </span>
                        </button>
                      );
                    }
                    const r = it;
                    const dur =
                      r.duracao_minutos ??
                      (r.fim
                        ? (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 60000
                        : (nowTs - new Date(r.inicio).getTime()) / 60000);
                    return (
                      <button
                        type="button"
                        key={r.id}
                        onClick={() => selecionarLinha(r)}
                        className="flex w-full items-center gap-3 rounded-md border border-border px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{
                            background: STATUS_COLOR[r.status] ?? "var(--color-muted-foreground)",
                          }}
                        />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium">{STATUS_LABEL[r.status] ?? r.status}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {formatHM(r.inicio)}
                            {r.fim ? `–${formatHM(r.fim)}` : "…"}
                          </span>
                        </div>
                        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                          {formatDuration(dur)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ajuste-inicio" className="text-xs">
                    Início
                  </Label>
                  <Input
                    id="ajuste-inicio"
                    type="time"
                    value={inicioHm}
                    onChange={(e) => setInicioHm(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ajuste-fim" className="text-xs">
                    Fim
                  </Label>
                  <Input
                    id="ajuste-fim"
                    type="time"
                    value={fimHm}
                    onChange={(e) => setFimHm(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* 2. Tipo de ajuste */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">2. Tipo de ajuste</h3>

              <div className="grid grid-cols-3 gap-2">
                {(["ajuste_periodo", "atestado", "abono"] as AjusteTipo[]).map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => setTipo(t)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs transition-colors ${
                      tipo === t
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {TIPO_ICON[t]}
                    <span className="text-center leading-tight">{AJUSTE_TIPO_LABEL[t]}</span>
                  </button>
                ))}
              </div>

              {/* Status-alvo (só para ajuste de período) */}
              {tipo === "ajuste_periodo" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Novo status do período</Label>
                  <Select value={statusAlvo} onValueChange={setStatusAlvo}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_ALVO_OPCOES.map((s) => (
                        <SelectItem key={s} value={s}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: STATUS_COLOR[s] }}
                            />
                            {STATUS_LABEL[s]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Dia inteiro (atestado/abono) */}
              {tipo !== "ajuste_periodo" && (
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="dia-inteiro" className="text-sm font-medium">
                      Cobrir o dia inteiro
                    </Label>
                    <p className="text-xs text-muted-foreground">Aplica o ajuste sobre toda a jornada do dia.</p>
                  </div>
                  <Checkbox
                    id="dia-inteiro"
                    checked={diaInteiro}
                    onCheckedChange={(checked) => setDiaInteiro(checked === true)}
                  />
                </div>
              )}
            </section>

            <Separator />

            {/* 3. Justificativa */}
            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold">3. Justificativa</h3>
              <Textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                placeholder="Explique o motivo do ajuste (obrigatório)."
                rows={3}
              />
            </section>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-6 py-4 sm:gap-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy
              ? aprovaDireto
                ? "Aplicando..."
                : "Enviando..."
              : aprovaDireto
                ? "Aplicar ajuste"
                : "Enviar solicitação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

