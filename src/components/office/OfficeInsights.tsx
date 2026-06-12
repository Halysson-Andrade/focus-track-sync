import { Sparkles } from "lucide-react";
import type { Insight, InsightTone } from "./insights";

const TONE_CLASS: Record<InsightTone, string> = {
  info: "border-info/30 bg-info/10 text-info",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function OfficeInsights({ insights }: { insights: Insight[] }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Sparkles className="h-4 w-4 text-primary" /> Insights automáticos
      </div>
      {insights.length === 0 ? (
        <p className="text-xs text-muted-foreground">Tudo tranquilo — nenhum alerta no momento.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {insights.map((i) => (
            <span
              key={i.id}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${TONE_CLASS[i.tone]}`}
            >
              <span>{i.emoji}</span>
              {i.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
