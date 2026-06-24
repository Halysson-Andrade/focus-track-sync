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
  STATUS_ABONO,
  type RegistroBase,
  type AjusteJornada,
  type SegmentoTimeline,
} from "./jornada-efetiva";
import { ocioReconciliadoSeg, type Intervalo } from "./ocio";
import { buildCategoriaIndex } from "./categorias";
import { isChromeProcess } from "./activity-config";

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

export type ItemUso = { label: string; totalSeg: number; efetivoSeg: number };
export type ItemCategoria = { categoria: string; produtiva: boolean; segundos: number };

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
  apps: ItemUso[];
  sites: ItemUso[];
  categorias: ItemCategoria[];
};

export type CategoriaRegra = {
  tipo: string;
  identificador: string;
  categoria: string;
  produtiva: boolean;
};

// --- Helpers de agrupamento por dia (chave = data LOCAL de `inicio`) ---

/** "YYYY-MM-DD" no fuso local de um timestamp ISO. */
function diaLocal(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function agruparPorDia(registros: RegistroBase[]): Map<string, RegistroBase[]> {
  const m = new Map<string, RegistroBase[]>();
  for (const r of registros) {
    const k = diaLocal(r.inicio);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
}

function agruparEventosPorDia(eventos: Intervalo[]): Map<string, Intervalo[]> {
  const m = new Map<string, Intervalo[]>();
  for (const e of eventos) {
    const k = diaLocal(e.inicio);
    const arr = m.get(k) ?? [];
    arr.push(e);
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

// --- Montagem de um dia (overlay + totais + ociosidade) ---

export function montarDiaEspelho(
  diaISO: string,
  registros: RegistroBase[],
  ajustes: AjusteEspelho[],
  eventos: Intervalo[],
  nowTs: number,
): DiaEspelho {
  const diaStart = new Date(diaISO + "T00:00:00").getTime();
  const diaEnd = new Date(diaISO + "T23:59:59.999").getTime();
  const dia = new Date(diaStart);
  // Aberto conta até AGORA (não até o fim do dia) — evita inflar a jornada de hoje.
  const cap = Math.min(nowTs, diaEnd);

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
  categoriaRegras: CategoriaRegra[] = [],
  nowTs: number = Date.now(),
): EspelhoData {
  const registrosPorDia = agruparPorDia(payload.registros);
  const eventosPorDia = agruparEventosPorDia(payload.eventos);

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

  // Top apps/sites: tempo total e efetivo (total − inativo), ordenados por total.
  const apps: ItemUso[] = payload.apps
    .filter((a) => !isChromeProcess(a.process_name) && !isChromeProcess(a.app_label))
    .map((a) => ({
      label: a.app_label && a.app_label !== a.process_name ? a.app_label : a.process_name,
      totalSeg: Number(a.segundos_totais) || 0,
      efetivoSeg: Math.max(
        0,
        (Number(a.segundos_totais) || 0) - (Number(a.segundos_inativos) || 0),
      ),
    }))
    .sort((x, y) => y.totalSeg - x.totalSeg);

  const sites: ItemUso[] = payload.sites
    .map((s) => ({
      label: s.domain,
      totalSeg: Number(s.segundos_totais) || 0,
      efetivoSeg: Math.max(
        0,
        (Number(s.segundos_totais) || 0) - (Number(s.segundos_inativos) || 0),
      ),
    }))
    .sort((x, y) => y.totalSeg - x.totalSeg);

  // Categorias: resolve via as mesmas regras do dashboard (sobre o tempo efetivo).
  // A página passa apenas regras ATIVAS (paridade com o dashboard).
  const idx = buildCategoriaIndex(categoriaRegras);
  const catMap = new Map<string, ItemCategoria>();
  const addCat = (categoria: string, produtiva: boolean, seg: number) => {
    const cur = catMap.get(categoria) ?? { categoria, produtiva, segundos: 0 };
    cur.segundos += seg;
    catMap.set(categoria, cur);
  };
  payload.sites.forEach((s) => {
    const hit = idx.matchDomain(s.domain);
    if (hit) {
      const ef = Math.max(0, (Number(s.segundos_totais) || 0) - (Number(s.segundos_inativos) || 0));
      addCat(hit.categoria, hit.produtiva, ef);
    }
  });
  payload.apps.forEach((a) => {
    if (isChromeProcess(a.process_name) || isChromeProcess(a.app_label)) return;
    const hit = idx.matchProcess(a.process_name, a.app_label);
    if (hit) {
      const ef = Math.max(0, (Number(a.segundos_totais) || 0) - (Number(a.segundos_inativos) || 0));
      addCat(hit.categoria, hit.produtiva, ef);
    }
  });
  const categorias = Array.from(catMap.values()).sort((x, y) => y.segundos - x.segundos);

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
    apps,
    sites,
    categorias,
  };
}
