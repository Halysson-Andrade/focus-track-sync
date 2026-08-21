// Ociosidade RECONCILIADA — fonte ÚNICA de ócio.
//
// A partir dos intervalos discretos de `eventos_ociosidade` (gravados por
// extensão e desktop), fazemos a UNIÃO (merge) dos intervalos — deduplicando a
// sobreposição entre as fontes para NÃO contar a mesma janela de relógio duas
// vezes — e interceptamos com as janelas ATIVO do expediente (ócio só conta
// dentro do ATIVO). O mesmo conjunto de intervalos alimenta o NÚMERO e a
// TIMELINE, então nunca divergem; e o resultado é, por construção, ≤ tempo ATIVO
// (dispensa o clamp antigo).
//
// JUSTIFICATIVAS (overlay): intervalos de `justificativas_ociosidade` aprovados
// são SUBTRAÍDOS do resultado. O desconto incide sobre o conjunto já reconciliado
// (ócio ∩ ATIVO), nunca sobre o intervalo bruto informado — justificar 14:00–14:40
// quando só 14:10–14:30 era ocioso desconta 20min, não 40. Justificativas
// sobrepostas passam por merge antes, então não há desconto em dobro. Nada do
// bruto é apagado: o desconto é recalculado a cada render.

export type Intervalo = { inicio: string; fim: string | null };

/** Bloco de ócio efetivo, em epoch ms — o que sobra de (ócio ∩ ATIVO). */
export type Bloco = [number, number];

function toRange(inicio: string, fim: string | null, nowTs: number): Bloco {
  const a = new Date(inicio).getTime();
  const b = fim ? new Date(fim).getTime() : nowTs;
  return [a, Math.max(a, b)];
}

/** Funde intervalos sobrepostos/adjacentes numa lista ordenada e disjunta. */
function merge(ranges: Bloco[]): Bloco[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const out: Bloco[] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const [s, e] = sorted[i];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Interseção de duas listas JÁ mescladas (ordenadas, disjuntas), como ranges. */
function intersectRanges(a: Bloco[], b: Bloco[]): Bloco[] {
  const out: Bloco[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/** `a` menos `b` (ambas JÁ mescladas). Recorta de cada bloco de `a` o que `b` cobre.
 *  Varredura direta: `b` é a lista de justificativas do dia/período — punhado de
 *  itens —, então clareza vale mais que o ganho de um cursor compartilhado. */
function subtractRanges(a: Bloco[], b: Bloco[]): Bloco[] {
  if (b.length === 0) return a;
  const out: Bloco[] = [];
  for (const [ini, fim] of a) {
    let cursor = ini;
    for (const [bIni, bFim] of b) {
      if (bFim <= cursor) continue; // corte já ultrapassado
      if (bIni >= fim) break; // `b` ordenada: os próximos também não tocam
      if (bIni > cursor) out.push([cursor, bIni]);
      cursor = Math.max(cursor, bFim);
      if (cursor >= fim) break;
    }
    if (cursor < fim) out.push([cursor, fim]);
  }
  return out;
}

function somaSeg(ranges: Bloco[]): number {
  return ranges.reduce((acc, [ini, fim]) => acc + (fim - ini), 0) / 1000;
}

/**
 * Blocos de ócio EFETIVOS (ócio ∩ ATIVO), já mesclados e ordenados. É o mesmo
 * conjunto que alimenta o número — usado pela UI para listar "onde houve ócio"
 * (ex.: escolher o intervalo a justificar).
 */
export function ocioBlocos(eventos: Intervalo[], ativos: Intervalo[], nowTs: number): Bloco[] {
  if (eventos.length === 0 || ativos.length === 0) return [];
  const idle = merge(eventos.map((e) => toRange(e.inicio, e.fim, nowTs)));
  const active = merge(ativos.map((a) => toRange(a.inicio, a.fim, nowTs)));
  return intersectRanges(idle, active);
}

export type OcioDetalhado = {
  /** Ócio reconciliado, antes de qualquer justificativa. */
  brutoSeg: number;
  /** Parcela do bruto coberta por justificativa (≤ brutoSeg, por construção). */
  justificadoSeg: number;
  /** O que conta: bruto − justificado. */
  liquidoSeg: number;
};

/**
 * Ócio bruto, justificado e líquido (em segundos). `justificados` são os intervalos
 * das justificativas APROVADAS — o cliente filtra o status antes de chamar.
 */
export function ocioDetalhado(
  eventos: Intervalo[],
  ativos: Intervalo[],
  nowTs: number,
  justificados: Intervalo[] = [],
): OcioDetalhado {
  const blocos = ocioBlocos(eventos, ativos, nowTs);
  const brutoSeg = Math.max(0, Math.round(somaSeg(blocos)));
  if (blocos.length === 0 || justificados.length === 0) {
    return { brutoSeg, justificadoSeg: 0, liquidoSeg: brutoSeg };
  }
  const cobertura = merge(justificados.map((j) => toRange(j.inicio, j.fim, nowTs)));
  const liquidoSeg = Math.max(0, Math.round(somaSeg(subtractRanges(blocos, cobertura))));
  // Deriva o justificado da diferença (e não de uma segunda interseção) para que
  // bruto = justificado + líquido feche exatamente, sem erro de arredondamento.
  return { brutoSeg, justificadoSeg: Math.max(0, brutoSeg - liquidoSeg), liquidoSeg };
}

/**
 * Ócio (em segundos) = união dos `eventos` de ociosidade ∩ união das janelas
 * `ativos` (ATIVO), menos os intervalos `justificados` (aprovados). `nowTs` fecha
 * intervalos abertos (fim nulo) no instante atual. Sem justificativas, devolve
 * exatamente o mesmo número de antes.
 */
export function ocioReconciliadoSeg(
  eventos: Intervalo[],
  ativos: Intervalo[],
  nowTs: number,
  justificados: Intervalo[] = [],
): number {
  return ocioDetalhado(eventos, ativos, nowTs, justificados).liquidoSeg;
}
