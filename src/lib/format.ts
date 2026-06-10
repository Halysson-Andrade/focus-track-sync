export function formatDuration(minutes: number): string {
  if (!minutes || minutes < 0) return "0min";
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  if (h === 0) return `${m}min`;
  return `${h}h ${m.toString().padStart(2, "0")}min`;
}

export function formatHM(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("pt-BR");
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("pt-BR");
}

export function minutesBetween(start: string | Date, end: string | Date): number {
  const a = typeof start === "string" ? new Date(start) : start;
  const b = typeof end === "string" ? new Date(end) : end;
  return Math.max(0, (b.getTime() - a.getTime()) / 60000);
}

export const STATUS_LABEL: Record<string, string> = {
  ATIVO: "Ativo",
  PAUSA: "Pausa",
  ALMOCO: "Almoço",
  INATIVO: "Inativo",
  ENCERRADO: "Encerrado",
};

export const STATUS_COLOR: Record<string, string> = {
  ATIVO: "var(--color-success)",
  PAUSA: "var(--color-warning)",
  ALMOCO: "var(--color-info)",
  INATIVO: "var(--color-destructive)",
  ENCERRADO: "var(--color-muted-foreground)",
};
