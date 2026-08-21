// Justificativas de ociosidade — tipos e helpers compartilhados pelo Espelho de
// Ponto, pelo Relatório de Inatividade e pela fila de aprovação.
//
// Uma justificativa é OVERLAY: cobre um intervalo do dia e, quando `aprovada`,
// desconta do ócio via `ocioDetalhado` (src/lib/ocio.ts). Pendentes e rejeitadas
// aparecem na UI mas NÃO descontam nada — o desconto é sempre derivado do status
// atual, então aprovar/revogar reflete na hora, sem migrar dado.

import type { Tables } from "@/integrations/supabase/types";
import type { Intervalo } from "./ocio";

/** Linha da tabela `justificativas_ociosidade`. */
export type JustificativaOcio = Tables<"justificativas_ociosidade">;

/**
 * Subconjunto que as RPCs `espelho_ponto` / `relatorio_inatividade` devolvem
 * dentro do payload jsonb (não vem `criado_por`/`decidido_por`).
 */
export type JustificativaOcioPayload = Pick<
  JustificativaOcio,
  | "id"
  | "usuario_id"
  | "usuario_nome"
  | "departamento"
  | "dia"
  | "inicio"
  | "fim"
  | "justificativa"
  | "status"
  | "decidido_por_nome"
  | "justificativa_decisao"
  | "decidido_em"
  | "criado_em"
>;

/** Só as APROVADAS descontam ócio. */
export function apenasAprovadas<T extends { status: JustificativaOcio["status"] }>(js: T[]): T[] {
  return js.filter((j) => j.status === "aprovada");
}

/** Intervalos das justificativas aprovadas, no formato aceito por `ocioDetalhado`. */
export function intervalosAprovados(
  js: Pick<JustificativaOcioPayload, "status" | "inicio" | "fim">[],
): Intervalo[] {
  return apenasAprovadas(js).map((j) => ({ inicio: j.inicio, fim: j.fim }));
}

/** Duração do intervalo justificado, em minutos (o pedido, não o desconto efetivo). */
export function duracaoMin(j: Pick<JustificativaOcioPayload, "inicio" | "fim">): number {
  return Math.max(0, (new Date(j.fim).getTime() - new Date(j.inicio).getTime()) / 60000);
}

/** Rótulos do status (reusa o enum `ajuste_status`). */
export const JUSTIFICATIVA_STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  aprovada: "Aprovada",
  rejeitada: "Rejeitada",
};
