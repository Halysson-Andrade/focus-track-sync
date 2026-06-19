import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAjustesPendentes, type AjusteJornada } from "@/hooks/use-ajustes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  formatHM,
  formatDate,
  AJUSTE_TIPO_LABEL,
  AJUSTE_STATUS_LABEL,
  STATUS_LABEL,
} from "@/lib/format";
import { ClipboardCheck, Check, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/aprovacoes")({
  head: () => ({ meta: [{ title: "Aprovações — Ajustes de Jornada" }] }),
  component: AprovacoesPage,
});

type Filtro = "pendente" | "todas";

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "aprovada") return "default";
  if (status === "rejeitada") return "destructive";
  return "secondary";
}

function descricaoAjuste(a: AjusteJornada): string {
  if (a.tipo === "ajuste_periodo") {
    const alvo = a.status_alvo ? (STATUS_LABEL[a.status_alvo] ?? a.status_alvo) : "—";
    return `Marcar como ${alvo}`;
  }
  return a.inicio && a.fim ? "Período" : "Dia inteiro";
}

function AprovacoesPage() {
  const { isAdmin, loading } = useAuth();
  const router = useRouter();
  const { ajustes } = useAjustesPendentes(isAdmin);

  const [filtro, setFiltro] = useState<Filtro>("pendente");
  const [alvo, setAlvo] = useState<{ ajuste: AjusteJornada; aprovar: boolean } | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !isAdmin) router.navigate({ to: "/" });
  }, [loading, isAdmin, router]);

  const lista = useMemo(
    () => (filtro === "pendente" ? ajustes.filter((a) => a.status === "pendente") : ajustes),
    [ajustes, filtro],
  );
  const pendentesCount = useMemo(
    () => ajustes.filter((a) => a.status === "pendente").length,
    [ajustes],
  );

  const abrirDecisao = (ajuste: AjusteJornada, aprovar: boolean) => {
    setAlvo({ ajuste, aprovar });
    setJustificativa("");
  };

  const confirmar = async () => {
    if (!alvo || busy) return;
    if (!justificativa.trim()) {
      toast.error("Informe a justificativa da decisão.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("decidir_ajuste_jornada", {
        p_id: alvo.ajuste.id,
        p_aprovar: alvo.aprovar,
        p_justificativa: justificativa.trim(),
      });
      if (error) throw error;
      toast.success(alvo.aprovar ? "Solicitação aprovada." : "Solicitação rejeitada.");
      setAlvo(null);
      setJustificativa("");
    } catch (err) {
      toast.error((err as Error).message ?? "Não foi possível registrar a decisão.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Aprovações de ajuste
          </h1>
          <p className="text-sm text-muted-foreground">
            {pendentesCount} pendente(s) na sua área de aprovação.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={filtro === "pendente" ? "default" : "outline"}
            size="sm"
            onClick={() => setFiltro("pendente")}
          >
            Pendentes
          </Button>
          <Button
            variant={filtro === "todas" ? "default" : "outline"}
            size="sm"
            onClick={() => setFiltro("todas")}
          >
            Todas
          </Button>
        </div>
      </div>

      {lista.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma solicitação {filtro === "pendente" ? "pendente" : ""} no momento.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {lista.map((a) => (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                <div>
                  <CardTitle className="text-base">{a.usuario_nome}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {a.departamento ?? "Sem área"} · {formatDate(a.dia)}
                  </p>
                </div>
                <Badge variant={statusBadgeVariant(a.status)}>
                  {AJUSTE_STATUS_LABEL[a.status] ?? a.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{AJUSTE_TIPO_LABEL[a.tipo] ?? a.tipo}</span>
                  <span className="text-muted-foreground">{descricaoAjuste(a)}</span>
                  {a.inicio && a.fim && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatHM(a.inicio)} → {formatHM(a.fim)}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Justificativa:</span>{" "}
                  {a.justificativa}
                </p>
                {a.status !== "pendente" && a.justificativa_decisao && (
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Decisão ({a.decidido_por_nome ?? "Gestão"}):
                    </span>{" "}
                    {a.justificativa_decisao}
                  </p>
                )}
                {a.status === "pendente" && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={() => abrirDecisao(a, true)}>
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Aprovar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => abrirDecisao(a, false)}>
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      Rejeitar
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!alvo} onOpenChange={(v) => !v && setAlvo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {alvo?.aprovar ? "Aprovar solicitação" : "Rejeitar solicitação"}
            </DialogTitle>
            <DialogDescription>
              {alvo?.ajuste.usuario_nome} · {alvo && formatDate(alvo.ajuste.dia)} ·{" "}
              {alvo && (AJUSTE_TIPO_LABEL[alvo.ajuste.tipo] ?? alvo.ajuste.tipo)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Justificativa da decisão</Label>
            <Textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Obrigatória — registre o motivo da aprovação/rejeição."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAlvo(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={busy}>
              {busy ? "Salvando..." : alvo?.aprovar ? "Confirmar aprovação" : "Confirmar rejeição"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
