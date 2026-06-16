// Ociosidade RECONCILIADA — fonte ÚNICA de ócio.
//
// A partir dos intervalos discretos de `eventos_ociosidade` (gravados por
// extensão e desktop), fazemos a UNIÃO (merge) dos intervalos — deduplicando a
// sobreposição entre as fontes para NÃO contar a mesma janela de relógio duas
// vezes — e interceptamos com as janelas ATIVO do expediente (ócio só conta
// dentro do ATIVO). O mesmo conjunto de intervalos alimenta o NÚMERO e a
// TIMELINE, então nunca divergem; e o resultado é, por construção, ≤ tempo ATIVO
// (dispensa o clamp antigo).

export type Intervalo = { inicio: string; fim: string | null };

function toRange(inicio: string, fim: string | null, nowTs: number): [number, number] {
  const a = new Date(inicio).getTime();
  const b = fim ? new Date(fim).getTime() : nowTs;
  return [a, Math.max(a, b)];
}

/** Funde intervalos sobrepostos/adjacentes numa lista ordenada e disjunta. */
function merge(ranges: [number, number][]): [number, number][] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const [s, e] = sorted[i];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Segundos de interseção entre duas listas JÁ mescladas (ordenadas, disjuntas). */
function intersectSeconds(a: [number, number][], b: [number, number][]): number {
  let i = 0;
  let j = 0;
  let ms = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) ms += hi - lo;
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return ms / 1000;
}

/**
 * Ócio (em segundos) = união dos `eventos` de ociosidade ∩ união das janelas
 * `ativos` (ATIVO). `nowTs` fecha intervalos abertos (fim nulo) no instante atual.
 */
export function ocioReconciliadoSeg(
  eventos: Intervalo[],
  ativos: Intervalo[],
  nowTs: number,
): number {
  if (eventos.length === 0 || ativos.length === 0) return 0;
  const idle = merge(eventos.map((e) => toRange(e.inicio, e.fim, nowTs)));
  const active = merge(ativos.map((a) => toRange(a.inicio, a.fim, nowTs)));
  return Math.max(0, Math.round(intersectSeconds(idle, active)));
}
