export function formatDuration(minutes: number): string {
  if (!minutes || minutes < 0) return "0min";
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  if (h === 0) return `${m}min`;
  return `${h}h ${m.toString().padStart(2, "0")}min`;
}

/** "agora" / "há N min" / "há Nh" a partir de um intervalo em ms. */
export function formatAgo(ageMs: number): string {
  const min = Math.floor(ageMs / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)}h`;
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

// Rótulos dos tipos de ajuste de jornada (solicitação/aprovação).
export const AJUSTE_TIPO_LABEL: Record<string, string> = {
  ajuste_periodo: "Ajuste de período",
  atestado: "Atestado",
  abono: "Abono / falta justificada",
};

// Rótulos do status da solicitação de ajuste.
export const AJUSTE_STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  aprovada: "Aprovada",
  rejeitada: "Rejeitada",
};

// Cor única que marca QUALQUER segmento vindo de um ajuste aprovado como
// "editado", independentemente do status resultante. Usa --color-primary (roxo do
// app) por ser distinta das cores de status do tracking (verde/amarelo/azul/cinza).
export const EDITADO_COLOR = "var(--color-primary)";

// Atestado/abono não são status de tracking: viram um bucket "Abonado" (justificado,
// não-produtivo) na distribuição e na linha do tempo. Cor própria, separada de INATIVO.
export const ABONO_COLOR = "var(--color-info)";
export const ABONO_LABEL = "Abonado";

// Fonte única de cor por status. INATIVO macro = slate (afastado, não erro);
// o vermelho destructive fica reservado para ações destrutivas. A ociosidade
// granular (micro-ócio dentro de apps/sites) usa --color-idle, separadamente.
export const STATUS_COLOR: Record<string, string> = {
  ATIVO: "var(--color-success)",
  PAUSA: "var(--color-warning)",
  ALMOCO: "var(--color-info)",
  INATIVO: "var(--color-muted-foreground)",
  ENCERRADO: "var(--color-muted-foreground)",
};
