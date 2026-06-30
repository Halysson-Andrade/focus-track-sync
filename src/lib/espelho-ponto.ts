// Montagem do "espelho de ponto": a partir do payload cru da RPC `espelho_ponto`
// (registros, ajustes, eventos de ócio, agregados de apps/sites), deriva por DIA
// as marcações estilo folha de frequência (entrada, almoço, saída), os totais e a
// ociosidade — e agrega os KPIs do período.
//
// REUSO total das libs do dashboard, para que os números do espelho batam com a
// tela: aplicarAjustes/totaisPorStatus ([jornada-efetiva.ts]) e
// ocioReconciliadoSeg ([ocio.ts]). Esta camada só organiza/deriva — não busca dados.

import {
  aplicarAjustes,
  resolverJornada,
  atribuirDiaJornada,
  janelaDiaJornada,
  diaLocal,
  STATUS_ABONO,
  type RegistroBase,
  type AjusteJornada,
  type SegmentoTimeline,
} from "./jornada-efetiva";
import { ocioReconciliadoSeg, type Intervalo } from "./ocio";

// --- Tipos do payload cru (espelho exatamente o que a RPC devolve) ---

export type AjusteEspelho = Pick<
  AjusteJornada,
  | "id"
  | "dia"
  | "tipo"
  | "inicio"
  | "fim"
  | "status"
  | "status_alvo"
  | "justificativa"
  | "justificativa_decisao"
  | "decidido_por_nome"
  | "decidido_em"
>;

export type EspelhoPayload = {
  perfil: {
    nome: string | null;
    cargo: string | null;
    departamento: string | null;
    email: string | null;
  } | null;
  registros: RegistroBase[];
  ajustes: AjusteEspelho[];
  eventos: Intervalo[];
  apps: {
    process_name: string;
    app_label: string | null;
    segundos_totais: number;
    segundos_inativos: number;
  }[];
  sites: { domain: string; segundos_totais: number; segundos_inativos: number }[];
};

// --- Tipos derivados (consumidos pela página e pelo PDF) ---

export type Marcacoes = {
  entrada: string | null;
  almocoInicio: string | null;
  almocoFim: string | null;
  saida: string | null; // null = jornada do dia ficou em andamento
  /** Pausas e almoços além do primeiro almoço — vão para a coluna "Obs.". */
  extras: { status: string; inicio: string; fim: string | null }[];
};

export type DiaEspelho = {
  dia: string; // YYYY-MM-DD
  marcacoes: Marcacoes;
  ativoMin: number;
  pausaMin: number;
  almocoMin: number;
  inativoMin: number;
  abonoMin: number;
  ocioMin: number;
  editado: boolean;
  tiposAjuste: string[]; // tipos de ajuste aplicados no dia (para a coluna "Obs.")
};

export type AbonoLinha = {
  dia: string;
  tipo: AjusteEspelho["tipo"];
  inicio: string | null;
  fim: string | null;
  status: AjusteEspelho["status"];
  justificativa: string;
  justificativaDecisao: string | null;
  decididoPorNome: string | null;
  decididoEm: string | null;
};

export type EspelhoData = {
  perfil: EspelhoPayload["perfil"];
  periodo: { de: string; ate: string };
  dias: DiaEspelho[];
  kpis: {
    ativoMin: number;
    ocioMin: number;
    efetivoMin: number;
    produtividade: number; // %
    pausaMin: number;
    almocoMin: number;
    inativoMin: number;
    abonoMin: number;
    diasComRegistro: number;
  };
  abonos: AbonoLinha[];
};

// --- Helpers de agrupamento por DIA DA JORNADA (vira-noite: pertence ao dia que começou) ---

export function agruparPorDia(registros: RegistroBase[]): Map<string, RegistroBase[]> {
  const diaDe = atribuirDiaJornada(registros);
  const m = new Map<string, RegistroBase[]>();
  for (const r of registros) {
    const k = diaDe.get(r.id) ?? diaLocal(r.inicio);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
}

/** Atribui cada evento de ócio ao dia da jornada cuja JANELA [start, fim] contém seu
 *  `inicio` (janelas derivadas dos registros já agrupados); fallback = dia local. */
function agruparEventosPorDia(
  eventos: Intervalo[],
  registrosPorDia: Map<string, RegistroBase[]>,
  nowTs: number,
): Map<string, Intervalo[]> {
  const janelas = Array.from(registrosPorDia.entries()).map(([dia, regs]) => {
    let start = Infinity;
    let end = -Infinity;
    for (const r of regs) {
      const s = new Date(r.inicio).getTime();
      const e = r.fim ? new Date(r.fim).getTime() : nowTs;
      if (s < start) start = s;
      if (e > end) end = e;
    }
    return { dia, start, end };
  });
  const m = new Map<string, Intervalo[]>();
  for (const ev of eventos) {
    const t = new Date(ev.inicio).getTime();
    const hit = janelas.find((j) => t >= j.start && t <= j.end);
    const k = hit ? hit.dia : diaLocal(ev.inicio);
    const arr = m.get(k) ?? [];
    arr.push(ev);
    m.set(k, arr);
  }
  return m;
}

// --- Derivação das marcações de um dia (a partir dos segmentos efetivos) ---

export function derivarMarcacoes(segs: SegmentoTimeline[], emAndamento: boolean): Marcacoes {
  if (segs.length === 0) {
    return { entrada: null, almocoInicio: null, almocoFim: null, saida: null, extras: [] };
  }
  const iso = (ms: number) => new Date(ms).toISOString();
  const ord = [...segs].sort((a, b) => a.inicio - b.inicio);
  const entrada = iso(ord[0].inicio);

  // Saída = maior `fim` do dia (a timeline já fecha abertos em `now`); se a jornada do dia
  // está em andamento (hoje, com registro aberto), fica "em andamento" (null).
  let saidaTs = -Infinity;
  for (const s of ord) if (s.fim > saidaTs) saidaTs = s.fim;
  const saida = emAndamento ? null : iso(saidaTs);

  const almocos = ord.filter((s) => s.status === "ALMOCO");
  const almocoInicio = almocos[0] ? iso(almocos[0].inicio) : null;
  const almocoFim = almocos[0] ? iso(almocos[0].fim) : null;

  const extras = [...almocos.slice(1), ...ord.filter((s) => s.status === "PAUSA")].map((s) => ({
    status: s.status,
    inicio: iso(s.inicio),
    fim: iso(s.fim),
  }));

  return { entrada, almocoInicio, almocoFim, saida, extras };
}

/** Sufixo " +N" quando o horário ISO cai N dias civis DEPOIS do dia da linha (vira-noite);
 *  "" no mesmo dia. Ex.: jornada de 15/06 que termina 16/06 08:46 → "08:46 +1". */
export function sufixoVirada(iso: string | null | undefined, diaBaseISO: string): string {
  if (!iso) return "";
  const base = new Date(diaBaseISO + "T00:00:00").getTime();
  const alvo = new Date(diaLocal(iso) + "T00:00:00").getTime();
  const diff = Math.round((alvo - base) / (24 * 3600_000));
  return diff > 0 ? ` +${diff}` : "";
}

// --- Montagem de um dia (overlay + totais + ociosidade) ---

export function montarDiaEspelho(
  diaISO: string,
  registros: RegistroBase[],
  ajustes: AjusteEspelho[],
  eventos: Intervalo[],
  nowTs: number,
): DiaEspelho {
  // Janela do dia da jornada: fim estende-se além da meia-noite se a sessão cruzou
  // (o rabo pós-meia-noite pertence a este dia). Aberto conta até AGORA (não infla hoje).
  const { diaStart, diaEnd, cap } = janelaDiaJornada(registros, diaISO, nowTs);
  const dia = new Date(diaStart);

  // aplicarAjustes só lê um subconjunto dos campos de AjusteJornada (id, status,
  // tipo, inicio, fim, status_alvo); o cast é seguro estruturalmente.
  const segs = aplicarAjustes(registros, ajustes as AjusteJornada[], dia, cap);
  // Timeline DISJUNTA + totais (cada instante conta uma vez; sobreposição resolvida).
  const { timeline, totais } = resolverJornada(segs, diaStart, diaEnd, nowTs);

  // "Em andamento" = há registro aberto E o dia é hoje (no fuso local).
  const emAndamento =
    segs.some((s) => !s.fim) && diaISO === diaLocal(new Date(nowTs).toISOString());

  // Ócio reconciliado contra as janelas ATIVO BRUTAS (mesma semântica do dashboard).
  const ativosRaw: Intervalo[] = registros
    .filter((r) => r.status === "ATIVO")
    .map((r) => ({ inicio: r.inicio, fim: r.fim }));
  const ocioMin = ocioReconciliadoSeg(eventos, ativosRaw, cap) / 60;

  const tiposAjuste = Array.from(
    new Set(ajustes.filter((a) => a.status === "aprovada").map((a) => a.tipo as string)),
  );

  return {
    dia: diaISO,
    marcacoes: derivarMarcacoes(timeline, emAndamento),
    ativoMin: totais["ATIVO"] ?? 0,
    pausaMin: totais["PAUSA"] ?? 0,
    almocoMin: totais["ALMOCO"] ?? 0,
    inativoMin: totais["INATIVO"] ?? 0,
    abonoMin: totais[STATUS_ABONO] ?? 0,
    ocioMin,
    editado: timeline.some((s) => s.editado),
    tiposAjuste,
  };
}

// --- Montagem do espelho completo (todos os dias + KPIs do período) ---

export function montarEspelho(
  payload: EspelhoPayload,
  de: string,
  ate: string,
  nowTs: number = Date.now(),
): EspelhoData {
  const registrosPorDia = agruparPorDia(payload.registros);
  const eventosPorDia = agruparEventosPorDia(payload.eventos, registrosPorDia, nowTs);

  // Decisão de produto: intervalo livre → apenas dias COM registro viram linha.
  const diasISO = Array.from(registrosPorDia.keys()).sort();

  const dias: DiaEspelho[] = diasISO.map((d) =>
    montarDiaEspelho(
      d,
      registrosPorDia.get(d) ?? [],
      payload.ajustes.filter((a) => a.dia === d),
      eventosPorDia.get(d) ?? [],
      nowTs,
    ),
  );

  const soma = (sel: (x: DiaEspelho) => number) => dias.reduce((acc, x) => acc + sel(x), 0);
  const ativoMin = soma((x) => x.ativoMin);
  const ocioMin = soma((x) => x.ocioMin);
  const efetivoMin = Math.max(0, ativoMin - ocioMin);
  const produtividade = ativoMin > 0 ? (efetivoMin / ativoMin) * 100 : 0;

  // Abonos/edições com os DOIS motivos (solicitação + decisão).
  const abonos: AbonoLinha[] = payload.ajustes.map((a) => ({
    dia: a.dia,
    tipo: a.tipo,
    inicio: a.inicio,
    fim: a.fim,
    status: a.status,
    justificativa: a.justificativa,
    justificativaDecisao: a.justificativa_decisao,
    decididoPorNome: a.decidido_por_nome,
    decididoEm: a.decidido_em,
  }));

  return {
    perfil: payload.perfil,
    periodo: { de, ate },
    dias,
    kpis: {
      ativoMin,
      ocioMin,
      efetivoMin,
      produtividade,
      pausaMin: soma((x) => x.pausaMin),
      almocoMin: soma((x) => x.almocoMin),
      inativoMin: soma((x) => x.inativoMin),
      abonoMin: soma((x) => x.abonoMin),
      diasComRegistro: dias.length,
    },
    abonos,
  };
}
