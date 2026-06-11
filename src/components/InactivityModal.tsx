import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InactivityModal({ open, onResume }: { open: boolean; onResume: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="mx-4 max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold">Você foi marcado como inativo</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Não detectamos atividade por mais de 10 minutos. Quando estiver pronto, retome seu
          expediente.
        </p>
        <Button onClick={onResume} className="mt-6 w-full" size="lg">
          Voltar ao Trabalho
        </Button>
      </div>
    </div>
  );
}
