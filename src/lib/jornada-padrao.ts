// Cálculo de jornada esperada vs. realizada para o espelho de ponto.
//
// A partir de um MODELO de jornada (horário padrão: entrada / almoço / saída +
// tipo de cada dia da semana) e dos feriados, compara, por dia e no período, o
// PREVISTO com o REALIZADO (base: marcações `(saída−entrada) − almoço`) e produz:
// horas pendentes, horas extras (HE), faltas e adicional noturno (22h–05h).
//
// Camada pura (sem fetch), consumindo o `DiaEspelho`/`Marcacoes` já derivados em
// [espelho-ponto.ts]. A página injeta o modelo (resolvido por usuário) e os feriados.

import type { Tables } from "@/integrations/supabase/types";
import type { DiaEspelho, Marcacoes } from "./espelho-ponto";

const DIA_MS = 86_400_000;
const H = 3_600_000;

export type DiaTipo = "trabalho" | "compensado" | "dsr" | "folga";
/** Tipo efetivo do dia (inclui feriado, que sobrepõe o dia da semana). */
export type DiaTipoCalc = DiaTipo | "feriado";

export type JornadaPadrao = {
  horaEntrada: string; // "HH:MM" ou "HH:MM:SS"
  horaAlmocoInicio: string | null;
  horaAlmocoFim: string | null;
  horaSaida: string;
  /** índice 0=dom … 6=sáb (JS getDay). */
  dias: [DiaTipo, DiaTipo, DiaTipo, DiaTipo, DiaTipo, DiaTipo, DiaTipo];
  /** Margem (min) por dia: saldo dentro de ±tolerância não vira pendente/HE. Default 15. */
  toleranciaMin?: number;
};

export type Feriado = { data: string }; // "YYYY-MM-DD"

export type DiaCalculo = {
  tipoDia: DiaTipoCalc;
  previstoMin: number;
  realizadoMin: number;
  abonoMin: number; // tempo abonado (atestado/abono) creditado na jornada
  almocoPrevistoMin: number;
  almocoRealizadoMin: number;
  saldoMin: number; // (realizado + abono creditado) − previsto, já com tolerância
  pendenteMin: number;
  extraMin: number; // HE
  noturnoMin: number;
  falta: boolean;
  aberto: boolean; // jornada do dia sem saída (hoje)
};

export type LinhaCalculo = DiaEspelho & { calc: DiaCalculo };

export type CalcPeriodo = { linhas: LinhaCalculo[]; totais: TotaisJornada };

export type TotaisJornada = {
  previstoMin: number;
  realizadoMin: number;
  abonoMin: number;
  saldoMin: number;
  pendenteMin: number;
  extraMin: number;
  noturnoMin: number;
  faltas: number; // contagem de dias
  feriadosTrabalhados: number;
  diasUteis: number;
};

export type JornadaPadraoRow = Tables<"jornada_padrao">;

export const DIA_TIPO_LABEL: Record<DiaTipoCalc, string> = {
  trabalho: "Trabalho",
  compensado: "Compensado",
  dsr: "DSR",
  folga: "Folga",
  feriado: "Feriado",
};

/** Converte a linha do banco no modelo usado no cálculo. */
export function rowToJornada(r: JornadaPadraoRow): JornadaPadrao {
  return {
    horaEntrada: r.hora_entrada,
    horaAlmocoInicio: r.hora_almoco_inicio,
    horaAlmocoFim: r.hora_almoco_fim,
    horaSaida: r.hora_saida,
    dias: [r.dia_dom, r.dia_seg, r.dia_ter, r.dia_qua, r.dia_qui, r.dia_sex, r.dia_sab],
    toleranciaMin: r.tolerancia_min ?? 15,
  };
}

// --- Helpers de tempo ---

/** "HH:MM[:SS]" → minutos desde a meia-noite (null se vazio/ inválido). */
export function parseHoraMin(h: string | null | undefined): number | null {
  if (!h) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(h);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const ms = (iso: string | null): number | null => (iso ? new Date(iso).getTime() : null);

/** Dia da semana (0=dom … 6=sáb) de "YYYY-MM-DD" no fuso LOCAL. */
function weekday(diaISO: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(diaISO);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(diaISO);
  return d.getDay();
}

function startOfLocalDayMs(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function overlapMs(aS: number, aE: number, bS: number, bE: number): number {
  const lo = Math.max(aS, bS);
  const hi = Math.min(aE, bE);
  return hi > lo ? hi - lo : 0;
}

/** Minutos de [s,e] dentro da faixa noturna 22h–05h (local), atravessando dias. */
function noturnoIntervalo(s: number, e: number): number {
  if (e <= s) return 0;
  let total = 0;
  for (let day = startOfLocalDayMs(s); day < e; day += DIA_MS) {
    total += overlapMs(s, e, day, day + 5 * H); // [00:00, 05:00)
    total += overlapMs(s, e, day + 22 * H, day + DIA_MS); // [22:00, 24:00)
  }
  return total / 60000;
}

// --- Previsto (do modelo) ---

export function previstoTrabalhoMin(j: JornadaPadrao): number {
  const ent = parseHoraMin(j.horaEntrada);
  const sai = parseHoraMin(j.horaSaida);
  const ai = parseHoraMin(j.horaAlmocoInicio);
  const af = parseHoraMin(j.horaAlmocoFim);
  if (ent == null || sai == null) return 0;
  let total = sai - ent;
  if (ai != null && af != null && af > ai) total -= af - ai;
  return Math.max(0, total);
}

export function previstoAlmocoMin(j: JornadaPadrao): number {
  const ai = parseHoraMin(j.horaAlmocoInicio);
  const af = parseHoraMin(j.horaAlmocoFim);
  if (ai == null || af == null) return 0;
  return Math.max(0, af - ai);
}

export function tipoDoDia(diaISO: string, j: JornadaPadrao, feriados: Set<string>): DiaTipoCalc {
  if (feriados.has(diaISO)) return "feriado";
  return j.dias[weekday(diaISO)];
}

// --- Noturno (das marcações) ---

/** Minutos noturnos (22h–05h) dos blocos de presença do dia (manhã+tarde, ou bloco
 *  único sem almoço). É tempo-do-dia — independe da base usada para o realizado. */
function noturnoDasMarcacoes(marc: Marcacoes): number {
  const ent = ms(marc.entrada);
  const sai = ms(marc.saida);
  const ai = ms(marc.almocoInicio);
  const af = ms(marc.almocoFim);
  if (ent == null || sai == null) return 0;
  const blocos: [number, number][] =
    ai != null && af != null && af > ai
      ? [
          [ent, ai],
          [af, sai],
        ]
      : [[ent, sai]];
  return blocos.reduce((acc, [s, e]) => acc + noturnoIntervalo(s, e), 0);
}

// --- Cálculo de um dia ---

export function calcDia(d: DiaEspelho, j: JornadaPadrao, feriados: Set<string>): DiaCalculo {
  const tipoDia = tipoDoDia(d.dia, j, feriados);
  const tol = Math.max(0, j.toleranciaMin ?? 15);

  // Realizado = PRESENÇA − ALMOÇO: tempo entre entrada e saída descontando os almoços
  // (pausas e ocioso à mesa contam como trabalhado; abono entra separado). Vem dos totais
  // da timeline DISJUNTA do dia — bate com os KPIs e com as marcações exibidas.
  const realizadoMin = d.ativoMin + d.pausaMin + d.inativoMin;
  const abonoMin = d.abonoMin;
  const almocoRealizadoMin = d.almocoMin;
  const almocoPrevistoMin = previstoAlmocoMin(j);
  const noturnoMin = noturnoDasMarcacoes(d.marcacoes);
  const aberto = d.marcacoes.entrada != null && d.marcacoes.saida == null;

  // compensado / dsr / folga / feriado: sem previsto; trabalhado é HE (com tolerância); nunca falta.
  if (tipoDia !== "trabalho") {
    const extra = realizadoMin > tol ? realizadoMin : 0;
    return {
      tipoDia,
      previstoMin: 0,
      realizadoMin,
      abonoMin,
      almocoPrevistoMin,
      almocoRealizadoMin,
      saldoMin: extra,
      pendenteMin: 0,
      extraMin: extra,
      noturnoMin,
      falta: false,
      aberto,
    };
  }

  const previstoMin = previstoTrabalhoMin(j);
  // Abono credita a jornada, mas só cobre a LACUNA do previsto — nunca vira HE.
  const abonoCredit = Math.min(abonoMin, Math.max(0, previstoMin - realizadoMin));
  const saldoMin = realizadoMin + abonoCredit - previstoMin;
  // Tolerância tudo-ou-nada, simétrica: |saldo| ≤ tol → zera pendente E HE.
  const dentroTol = Math.abs(saldoMin) <= tol;
  return {
    tipoDia,
    previstoMin,
    realizadoMin,
    abonoMin,
    almocoPrevistoMin,
    almocoRealizadoMin,
    saldoMin,
    pendenteMin: dentroTol ? 0 : Math.max(0, -saldoMin),
    extraMin: dentroTol ? 0 : Math.max(0, saldoMin),
    noturnoMin,
    falta: realizadoMin === 0 && abonoMin === 0 && !aberto, // dia útil sem presença nem abono
    aberto,
  };
}

/** Rótulo da situação do dia, para a coluna "Situação". */
export function situacaoDia(c: DiaCalculo): string {
  if (c.aberto) return "Em andamento";
  if (c.tipoDia !== "trabalho") {
    return c.extraMin > 0 ? `${DIA_TIPO_LABEL[c.tipoDia]} (HE)` : DIA_TIPO_LABEL[c.tipoDia];
  }
  if (c.realizadoMin === 0 && c.abonoMin > 0) return "Abonado";
  if (c.falta) return "Falta";
  if (c.extraMin > 0) return "HE";
  if (c.pendenteMin > 0) return "Pendente";
  return "OK";
}

// --- Enumeração e cálculo do período ---

/** Todos os dias "YYYY-MM-DD" no intervalo [de, ate], inclusive (fuso local). */
export function enumerarDias(de: string, ate: string): string[] {
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  };
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const out: string[] = [];
  const d = parse(de);
  const end = parse(ate);
  let guard = 0;
  while (d <= end && guard++ < 1000) {
    out.push(fmt(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function diaVazio(dia: string): DiaEspelho {
  return {
    dia,
    marcacoes: { entrada: null, almocoInicio: null, almocoFim: null, saida: null, extras: [] },
    ativoMin: 0,
    pausaMin: 0,
    almocoMin: 0,
    inativoMin: 0,
    abonoMin: 0,
    ocioMin: 0,
    editado: false,
    tiposAjuste: [],
  };
}

/**
 * Enumera TODOS os dias do intervalo (não só os com registro — é o que revela
 * faltas), casa cada um com o `DiaEspelho` correspondente (ou um vazio sintético)
 * e devolve as linhas com cálculo + os totais do período.
 */
export function calcularJornadaPeriodo(
  dias: DiaEspelho[],
  de: string,
  ate: string,
  jornada: JornadaPadrao,
  feriados: Feriado[],
): CalcPeriodo {
  const feriadoSet = new Set(feriados.map((f) => f.data));
  const byDia = new Map(dias.map((d) => [d.dia, d]));
  const linhas: LinhaCalculo[] = enumerarDias(de, ate).map((dia) => {
    const base = byDia.get(dia) ?? diaVazio(dia);
    return { ...base, calc: calcDia(base, jornada, feriadoSet) };
  });

  const totais: TotaisJornada = {
    previstoMin: 0,
    realizadoMin: 0,
    abonoMin: 0,
    saldoMin: 0,
    pendenteMin: 0,
    extraMin: 0,
    noturnoMin: 0,
    faltas: 0,
    feriadosTrabalhados: 0,
    diasUteis: 0,
  };
  for (const l of linhas) {
    const c = l.calc;
    totais.previstoMin += c.previstoMin;
    totais.realizadoMin += c.realizadoMin;
    totais.abonoMin += c.abonoMin;
    totais.pendenteMin += c.pendenteMin; // já tolerado por dia
    totais.extraMin += c.extraMin; // já tolerado por dia
    totais.noturnoMin += c.noturnoMin;
    if (c.tipoDia === "trabalho") totais.diasUteis += 1;
    if (c.falta) totais.faltas += 1;
    if (c.tipoDia === "feriado" && c.realizadoMin > 0) totais.feriadosTrabalhados += 1;
  }
  // Saldo coerente com a tolerância por dia (não recalcula de realizado−previsto cru).
  totais.saldoMin = totais.extraMin - totais.pendenteMin;
  return { linhas, totais };
}
