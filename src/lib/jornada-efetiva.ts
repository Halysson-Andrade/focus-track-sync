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

// --- Atribuição ao "dia da jornada" (vira-noite: a jornada pertence ao dia que começou) ---

/** "YYYY-MM-DD" no fuso LOCAL de um timestamp ISO. */
export function diaLocal(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Gap acima do qual consideramos que houve um intervalo "foi pra casa" → nova jornada.
 *  Como os registros são contíguos (abrir_registro fecha o anterior), gaps só surgem
 *  quando o tracking parou. Uma sessão que cruza a meia-noite tem gap ≈ 0 e fica no
 *  mesmo dia; descanso noturno (8h+) ou volta no dia seguinte ultrapassa o limite. */
export const GAP_NOVA_JORNADA_MS = 4 * 3600_000;

/**
 * Atribui cada registro ao DIA DA JORNADA (data local do INÍCIO da cadeia contígua):
 * uma nova jornada começa no primeiro registro, após um `ENCERRADO`, ou quando o gap
 * desde o fim anterior passa de `GAP_NOVA_JORNADA_MS`. Registros contíguos carregam o
 * dia através da meia-noite — assim o rabo pós-meia-noite NÃO vira um novo dia.
 */
export function atribuirDiaJornada(registros: RegistroBase[]): Map<string, string> {
  const ord = [...registros].sort(
    (a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime(),
  );
  const map = new Map<string, string>();
  let diaAtual: string | null = null;
  let prevEnd = -Infinity;
  let prevEncerrado = false;
  for (const r of ord) {
    const ini = new Date(r.inicio).getTime();
    const novaJornada = diaAtual === null || prevEncerrado || ini - prevEnd > GAP_NOVA_JORNADA_MS;
    if (novaJornada) diaAtual = diaLocal(r.inicio);
    map.set(r.id, diaAtual as string);
    const fim = r.fim ? new Date(r.fim).getTime() : ini;
    prevEnd = Math.max(prevEnd, fim);
    prevEncerrado = r.status === "ENCERRADO";
  }
  return map;
}

/**
 * Janela do dia da jornada: início = 00:00 local de `diaJornadaISO`; fim = o MAIOR entre
 * o fim do dia civil (23:59:59.999) e o maior `fim` dos registros (aberto → `nowTs`) —
 * para que o rabo que cruzou a meia-noite NÃO seja recortado por `resolverJornada`.
 */
export function janelaDiaJornada(
  registros: RegistroBase[],
  diaJornadaISO: string,
  nowTs: number,
): { diaStart: number; diaEnd: number; cap: number } {
  const diaStart = new Date(diaJornadaISO + "T00:00:00").getTime();
  const fimCivil = diaStart + 24 * 3600_000 - 1;
  let maxFim = fimCivil;
  for (const r of registros) {
    const fim = r.fim ? new Date(r.fim).getTime() : nowTs;
    if (fim > maxFim) maxFim = fim;
  }
  const diaEnd = maxFim;
  return { diaStart, diaEnd, cap: Math.min(nowTs, diaEnd) };
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

/** Totais por status (minutos) a partir dos segmentos efetivos, incluindo ABONO.
 *  Soma CRUA por status (sem recorte ao dia nem resolução de sobreposição). Para a
 *  jornada do dia, prefira `resolverJornada`, que recorta e resolve overlaps. */
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

// --- Jornada resolvida: timeline DISJUNTA por status + totais (fonte única) ---

/** Faixa da timeline disjunta (ms), com a procedência do segmento que a venceu. */
export type SegmentoTimeline = {
  inicio: number; // ms
  fim: number; // ms
  status: string;
  origemId: string;
  editado: boolean;
  tipoAjuste?: AjusteJornada["tipo"];
  ajusteId?: string;
};

export type JornadaResolvida = {
  /** Disjunta, ordenada, dentro de [diaStart, min(now, diaEnd)]. */
  timeline: SegmentoTimeline[];
  /** Minutos por status, somados sobre a timeline (cada instante conta UMA vez). */
  totais: Record<string, number>;
};

type SegNorm = {
  s: number;
  e: number;
  startOrig: number; // `inicio` ORIGINAL (não clampado) — chave do desempate
  status: string;
  origemId: string;
  editado: boolean;
  tipoAjuste?: AjusteJornada["tipo"];
  ajusteId?: string;
};

/**
 * Resolve a jornada de UM dia: recorta cada segmento à janela [diaStart, min(now, diaEnd)],
 * fecha abertos em min(now, diaEnd) e resolve SOBREPOSIÇÃO por LATEST-START-WINS — o
 * registro de `inicio` mais recente domina o instante, reproduzindo o invariante do
 * `abrir_registro` (abrir um status fecha o anterior). Devolve uma timeline disjunta e os
 * totais por status. É no-op em dias "limpos" (sem sobreposição) a menos do clamp do aberto.
 */
export function resolverJornada(
  segs: SegmentoEfetivo[],
  diaStart: number,
  diaEnd: number,
  nowTs: number,
): JornadaResolvida {
  const cap = Math.min(nowTs, diaEnd);

  const norm: SegNorm[] = [];
  for (const seg of segs) {
    const ini = new Date(seg.inicio).getTime();
    const rawEnd = seg.fim
      ? new Date(seg.fim).getTime()
      : seg.duracao_minutos != null
        ? ini + seg.duracao_minutos * 60000
        : cap;
    const s = Math.max(diaStart, ini);
    const e = Math.min(rawEnd, cap);
    if (e <= s) continue;
    norm.push({
      s,
      e,
      startOrig: ini,
      status: seg.status,
      origemId: seg.id,
      editado: !!seg.editado,
      tipoAjuste: seg.tipoAjuste,
      ajusteId: seg.ajusteId,
    });
  }
  if (norm.length === 0) return { timeline: [], totais: {} };

  // Fronteiras (todas as bordas distintas) → fatias [b_i, b_{i+1}).
  const bset = new Set<number>();
  for (const n of norm) {
    bset.add(n.s);
    bset.add(n.e);
  }
  const bounds = Array.from(bset).sort((a, b) => a - b);

  const timeline: SegmentoTimeline[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (b <= a) continue;

    // Vencedor da fatia: cobre [a,b) com o MAIOR startOrig; desempate estável por origemId.
    let win: SegNorm | null = null;
    for (const n of norm) {
      if (n.s <= a && n.e >= b) {
        if (
          win === null ||
          n.startOrig > win.startOrig ||
          (n.startOrig === win.startOrig && n.origemId > win.origemId)
        ) {
          win = n;
        }
      }
    }
    if (!win) continue; // fatia sem cobertura (buraco) — não emite

    // Coalesce com a faixa anterior se mesmo status+origem e contígua.
    const last = timeline[timeline.length - 1];
    if (last && last.fim === a && last.status === win.status && last.origemId === win.origemId) {
      last.fim = b;
    } else {
      timeline.push({
        inicio: a,
        fim: b,
        status: win.status,
        origemId: win.origemId,
        editado: win.editado,
        tipoAjuste: win.tipoAjuste,
        ajusteId: win.ajusteId,
      });
    }
  }

  const totais: Record<string, number> = {};
  for (const seg of timeline) {
    totais[seg.status] = (totais[seg.status] ?? 0) + (seg.fim - seg.inicio) / 60000;
  }
  return { timeline, totais };
}
