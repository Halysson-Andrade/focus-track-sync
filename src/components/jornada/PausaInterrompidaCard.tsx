import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Play, Wrench } from "lucide-react";
import { formatHM, diaLocalStr, STATUS_LABEL } from "@/lib/format";
import type { RegistroBruto } from "@/lib/pausa-interrompida";
import type { Database } from "@/integrations/supabase/types";

const DISMISS_KEY = "pausa-interrompida-ok";

function jaTratada(id: string): boolean {
  try {
    return localStorage.getItem(`${DISMISS_KEY}:${id}`) === "1";
  } catch {
    return false;
  }
}

function marcarTratada(id: string) {
  try {
    localStorage.setItem(`${DISMISS_KEY}:${id}`, "1");
  } catch {
    /* noop */
  }
}

/**
 * Oferece recuperação quando uma pausa/almoço foi interrompida pelo sistema:
 * retomar o expediente e solicitar a correção do período até agora (overlay
 * não-destrutivo, entra pendente na fila /aprovacoes). Ver
 * `detectarPausaInterrompida` em @/lib/pausa-interrompida.
 */
export function PausaInterrompidaCard({
  pausa,
  onResume,
  onCorrigido,
}: {
  pausa: RegistroBruto;
  onResume: () => void | Promise<void>;
  onCorrigido?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [oculto, setOculto] = useState(() => jaTratada(pausa.id));

  if (oculto) return null;

  const rotulo = (STATUS_LABEL[pausa.status] ?? pausa.status).toLowerCase();
  const inicio = new Date(pausa.inicio);

  const corrigir = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("solicitar_ajuste_jornada", {
        p_dia: diaLocalStr(inicio),
        p_tipo: "ajuste_periodo" as Database["public"]["Enums"]["ajuste_tipo"],
        p_justificativa: `Correção automática: ${rotulo} interrompido pelo sistema às ${formatHM(pausa.fim)}.`,
        p_inicio: pausa.inicio,
        p_fim: new Date().toISOString(),
        p_status_alvo: pausa.status as Database["public"]["Enums"]["activity_status"],
      });
      if (error) throw error;
      marcarTratada(pausa.id);
      setOculto(true);
      toast.success("Correção enviada para aprovação da gestão.");
      await onCorrigido?.();
    } catch (err) {
      toast.error((err as Error).message ?? "Não foi possível enviar a correção.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-warning/50 bg-warning/5">
      <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-semibold">Seu {rotulo} foi interrompido pelo sistema</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Registramos {rotulo} das {formatHM(pausa.inicio)} às {formatHM(pausa.fim)} e o
              expediente não voltou a ficar ativo. Se você só retornou agora, corrija o período — a
              solicitação entra para aprovação da gestão.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={corrigir} disabled={busy}>
            <Wrench className="mr-2 h-4 w-4" /> Corrigir até agora
          </Button>
          <Button onClick={() => void onResume()} disabled={busy}>
            <Play className="mr-2 h-4 w-4" /> Retomar expediente
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
