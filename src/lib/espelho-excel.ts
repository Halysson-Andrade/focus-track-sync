// Exportação Excel do espelho de ponto — resumo por colaborador (uma linha por
// pessoa) com os totais do período. Usa `xlsx` (já dependência, mesmo padrão de
// [exports.ts]).
//
// Recebe listas PARALELAS `espelhos` + `calculos` (mesmo contrato de
// [espelho-pdf.ts] gerarEspelhoPDF): cada índice é um colaborador; `calculos[i]`
// traz a apuração de jornada (previsto/HE/pendente/…) quando há jornada resolvida.
//
// Horas saem em DECIMAL numérico (ex.: 8,5) para serem somáveis no Excel.

import * as XLSX from "xlsx";
import type { EspelhoData } from "./espelho-ponto";
import type { CalcPeriodo } from "./jornada-padrao";

/** Minutos → horas decimais numéricas (2 casas), célula somável no Excel. */
const min2h = (min: number): number => +(min / 60).toFixed(2);

/** Monta a linha-resumo de um colaborador. Colunas de apuração ficam vazias
 *  ("") quando não há jornada resolvida (`calc` nulo). */
function linhaResumo(e: EspelhoData, calc: CalcPeriodo | null) {
  const k = e.kpis;
  const t = calc?.totais;
  return {
    Nome: e.perfil?.nome ?? "—",
    Setor: e.perfil?.departamento ?? "",
    Cargo: e.perfil?.cargo ?? "",
    Email: e.perfil?.email ?? "",
    "Período de": e.periodo.de,
    "Período até": e.periodo.ate,
    "Dias com registro": k.diasComRegistro,
    // Apuração de jornada (vs. horário padrão)
    "Previsto (h)": t ? min2h(t.previstoMin) : "",
    "Trabalhado (h)": t ? min2h(t.realizadoMin) : "",
    "Saldo (h)": t ? min2h(t.saldoMin) : "",
    "HE (h)": t ? min2h(t.extraMin) : "",
    "Pendentes (h)": t ? min2h(t.pendenteMin) : "",
    "Noturno (h)": t ? min2h(t.noturnoMin) : "",
    "Faltas (dias)": t ? t.faltas : "",
    "Feriados trab.": t ? t.feriadosTrabalhados : "",
    // KPIs do período (sempre presentes)
    "Tempo ativo (h)": min2h(k.ativoMin),
    "Ocioso (h)": min2h(k.ocioMin),
    "Efetivo (h)": min2h(k.efetivoMin),
    "Produtividade (%)": Math.round(k.produtividade),
    "Pausa (h)": min2h(k.pausaMin),
    "Almoço (h)": min2h(k.almocoMin),
    "Inativo (h)": min2h(k.inativoMin),
    "Abonado (h)": min2h(k.abonoMin),
  };
}

/** Gera (e baixa) uma planilha .xlsx com uma linha-resumo por colaborador,
 *  ordenada por nome. `calculos` é paralelo a `espelhos`. */
export function gerarEspelhoExcel(
  espelhos: EspelhoData[],
  filename = "espelho-resumo.xlsx",
  calculos?: (CalcPeriodo | null)[],
) {
  const linhas = espelhos
    .map((e, i) => linhaResumo(e, calculos?.[i] ?? null))
    .sort((a, b) => a.Nome.localeCompare(b.Nome, "pt-BR"));

  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Resumo");
  XLSX.writeFile(wb, filename);
}
