// Reconciliação da jornada: mescla o tracking BRUTO (registros_atividade, intocado)
// com os ajustes APROVADOS (ajustes_jornada) e produz a "jornada efetiva" — a lista
// de segmentos que a linha do tempo desenha e da qual os totais são recalculados.
//
// É a ÚNICA fonte do overlay: render e números consomem o mesmo resultado, então
// visual e totais nunca divergem.
//
// Mapeamento de contribuição aos totais:
//   - ajuste_periodo  → assume `status_alvo` (ex.: INATIVO→ATIVO passa a contar como
//                       trabalhado). O segmento é marcado `editado`.
//   - atestado / abono → não são status de tracking; viram o bucket sintético ABONO
//                       (justificado, não-produtivo), também `editado`.

import type { Tables } from "@/integrations/supabase/types";

export type AjusteJornada = Tables<"ajustes_jornada">;

/** Status sintético dos segmentos vindos de atestado/abono (fora do enum de tracking). */
export const STATUS_ABONO = "ABONO";

// Janela padrão para atestado/abono "dia inteiro" (sem período explícito): 08:00–17:00
// local. Conta a duração literal desse bloco como Abonado. Para contagem precisa,
// prefira informar um período na solicitação.
const JORNADA_PADRAO_INICIO_H = 8;
const JORNADA_PADRAO_FIM_H = 17;

export type RegistroBase = {
  id: string;
  status: string;
  inicio: string;
  fim: string | null;
  duracao_minutos: number | null;
};

export type SegmentoEfetivo = {
  id: string;
  status: string; // status de tracking OU STATUS_ABONO
  inicio: string;
  fim: string | null;
  duracao_minutos: number | null;
  // Opcional para que um Registro bruto (sem overlay) seja atribuível a SegmentoEfetivo
  // sem cast (ex.: as mini-linhas-do-tempo do histórico de 30 dias).
  editado?: boolean;
  tipoAjuste?: AjusteJornada["tipo"];
  ajusteId?: string;
};

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Janela [inicioTs, fimTs] do ajuste; usa período explícito ou a jornada padrão do dia. */
function janelaAjuste(a: AjusteJornada, dia: Date): [number, number] | null {
  if (a.inicio && a.fim) {
    const s = new Date(a.inicio).getTime();
    const e = new Date(a.fim).getTime();
    return e > s ? [s, e] : null;
  }
  // Dia inteiro (atestado/abono sem período): jornada padrão do dia selecionado.
  const base = new Date(dia);
  const s = new Date(base);
  s.setHours(JORNADA_PADRAO_INICIO_H, 0, 0, 0);
  const e = new Date(base);
  e.setHours(JORNADA_PADRAO_FIM_H, 0, 0, 0);
  return [s.getTime(), e.getTime()];
}

/** Recorta um segmento para [startTs, endTs), recomputando a duração e a chave. */
function recorte(seg: SegmentoEfetivo, startTs: number, endTs: number): SegmentoEfetivo {
  return {
    ...seg,
    id: `${seg.id}@${startTs}`,
    inicio: new Date(startTs).toISOString(),
    fim: new Date(endTs).toISOString(),
    duracao_minutos: (endTs - startTs) / 60000,
  };
}

/**
 * Aplica os ajustes APROVADOS sobre os registros brutos e devolve os segmentos
 * efetivos (ordenados por início). Os registros de entrada NÃO são mutados.
 */
export function aplicarAjustes(
  records: RegistroBase[],
  ajustes: AjusteJornada[],
  dia: Date,
  agoraTs: number = Date.now(),
): SegmentoEfetivo[] {
  let segs: SegmentoEfetivo[] = records.map((r) => ({
    id: r.id,
    status: r.status,
    inicio: r.inicio,
    fim: r.fim,
    duracao_minutos: r.duracao_minutos,
    editado: false,
  }));

  const aprovados = ajustes.filter((a) => a.status === "aprovada");

  for (const a of aprovados) {
    const janela = janelaAjuste(a, dia);
    if (!janela) continue;
    const [aStart, aEnd] = janela;

    // Corta os segmentos existentes que cruzam a janela do ajuste; o miolo coberto
    // é descartado e substituído pelo segmento editado.
    const next: SegmentoEfetivo[] = [];
    for (const seg of segs) {
      const s = new Date(seg.inicio).getTime();
      const e = seg.fim ? new Date(seg.fim).getTime() : agoraTs;
      if (!overlaps(s, e, aStart, aEnd)) {
        next.push(seg);
        continue;
      }
      if (s < aStart) next.push(recorte(seg, s, aStart));
      if (e > aEnd) next.push(recorte(seg, aEnd, e));
    }

    const statusResultante =
      a.tipo === "ajuste_periodo" ? (a.status_alvo ?? "ATIVO") : STATUS_ABONO;
    next.push({
      id: `ajuste-${a.id}`,
      status: statusResultante,
      inicio: new Date(aStart).toISOString(),
      fim: new Date(aEnd).toISOString(),
      duracao_minutos: (aEnd - aStart) / 60000,
      editado: true,
      tipoAjuste: a.tipo,
      ajusteId: a.id,
    });
    segs = next;
  }

  segs.sort((x, y) => new Date(x.inicio).getTime() - new Date(y.inicio).getTime());
  return segs;
}

/** Totais por status (minutos) a partir dos segmentos efetivos, incluindo ABONO. */
export function totaisPorStatus(
  segs: SegmentoEfetivo[],
  agoraTs: number = Date.now(),
): Record<string, number> {
  const t: Record<string, number> = {};
  for (const seg of segs) {
    const dur =
      seg.duracao_minutos ??
      (seg.fim
        ? (new Date(seg.fim).getTime() - new Date(seg.inicio).getTime()) / 60000
        : (agoraTs - new Date(seg.inicio).getTime()) / 60000);
    t[seg.status] = (t[seg.status] ?? 0) + dur;
  }
  return t;
}
