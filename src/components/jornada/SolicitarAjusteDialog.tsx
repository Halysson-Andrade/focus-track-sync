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
import { formatHM, formatDuration, STATUS_LABEL, STATUS_COLOR } from "@/lib/format";
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

function hmFromIso(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function isoFromHm(dia: Date, hm: string): string | null {
  if (!hm) return null;
  const [h, m] = hm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(dia);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function diaLocalStr(dia: Date): string {
  return `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(
    dia.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Popup de solicitação de ajuste de jornada. Mostra os eventos do dia linha a linha
 * (clicar pré-preenche o período) e envia via RPC solicitar_ajuste_jornada. O próprio
 * usuário solicita sobre a própria jornada; entra como 'pendente' para aprovação.
 */
export function SolicitarAjusteDialog({
  dia,
  records,
  open,
  onOpenChange,
  onSubmitted,
}: {
  dia: Date;
  records: RegistroLinha[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmitted?: () => void;
}) {
  const [tipo, setTipo] = useState<AjusteTipo>("ajuste_periodo");
  const [statusAlvo, setStatusAlvo] = useState<string>("ATIVO");
  const [inicioHm, setInicioHm] = useState("");
  const [fimHm, setFimHm] = useState("");
  const [diaInteiro, setDiaInteiro] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [busy, setBusy] = useState(false);

  const nowTs = Date.now();
  const linhas = useMemo(
    () => [...records].sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()),
    [records],
  );

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
      const { error } = await supabase.rpc("solicitar_ajuste_jornada", {
        p_dia: diaLocalStr(dia),
        p_tipo: tipo,
        p_justificativa: justificativa.trim(),
        p_inicio,
        p_fim,
        p_status_alvo: p_status_alvo as Database["public"]["Enums"]["activity_status"] | undefined,
      });
      if (error) throw error;
      toast.success("Solicitação enviada para aprovação.");
      reset();
      onOpenChange(false);
      onSubmitted?.();
    } catch (err) {
      toast.error((err as Error).message ?? "Não foi possível enviar a solicitação.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Solicitar ajuste de jornada</DialogTitle>
          <DialogDescription>
            {dia.toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}{" "}
            — escolha um período e o tipo de ajuste. A solicitação entra para aprovação da gestão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Eventos do dia, linha a linha — clicar pré-preenche o período */}
          <div className="space-y-1">
            <Label>Eventos do dia</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {linhas.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem registros neste dia.</p>
              ) : (
                linhas.map((r) => {
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
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-accent"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          background: STATUS_COLOR[r.status] ?? "var(--color-muted-foreground)",
                        }}
                      />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatHM(r.inicio)}
                        {r.fim ? `–${formatHM(r.fim)}` : "…"}
                      </span>
                      <span className="text-xs">{STATUS_LABEL[r.status] ?? r.status}</span>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                        {formatDuration(dur)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Tipo de ajuste */}
          <div className="space-y-2">
            <Label>Tipo de ajuste</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as AjusteTipo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ajuste_periodo">Ajustar período (mudar status)</SelectItem>
                <SelectItem value="atestado">Atestado</SelectItem>
                <SelectItem value="abono">Abono / falta justificada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Status-alvo (só para ajuste de período) */}
          {tipo === "ajuste_periodo" && (
            <div className="space-y-2">
              <Label>Novo status do período</Label>
              <Select value={statusAlvo} onValueChange={setStatusAlvo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ALVO_OPCOES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Dia inteiro (atestado/abono) */}
          {tipo !== "ajuste_periodo" && (
            <label className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
              <span>Cobrir o dia inteiro</span>
              <input
                type="checkbox"
                checked={diaInteiro}
                onChange={(e) => setDiaInteiro(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
          )}

          {/* Período */}
          {precisaPeriodo && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Início</Label>
                <Input type="time" value={inicioHm} onChange={(e) => setInicioHm(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Fim</Label>
                <Input type="time" value={fimHm} onChange={(e) => setFimHm(e.target.value)} />
              </div>
            </div>
          )}

          {/* Justificativa */}
          <div className="space-y-2">
            <Label>Justificativa</Label>
            <Textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Explique o motivo do ajuste (obrigatório)."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Enviando..." : "Enviar solicitação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
