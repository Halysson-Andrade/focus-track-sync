// Geração do PDF do espelho de ponto (jsPDF + autotable — já dependências do
// projeto, mesmo padrão de [exports.ts]).
//
// Recebe uma LISTA de espelhos para suportar o lote por setor: um espelho por
// usuário, cada um começando em página nova. Por usuário renderiza: cabeçalho,
// bloco de KPIs do período, tabela diária de marcações, abonos/edições com
// motivos e top apps/sites/categorias.

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  formatHM,
  formatDate,
  formatDuration,
  AJUSTE_TIPO_LABEL,
  AJUSTE_STATUS_LABEL,
} from "./format";
import { sufixoVirada, type EspelhoData } from "./espelho-ponto";
import { situacaoDia, type CalcPeriodo } from "./jornada-padrao";

const MARGIN = 14;
const AZUL: [number, number, number] = [30, 64, 175];

function fmtHora(iso: string | null): string {
  return iso ? formatHM(iso) : "—";
}

function fmtSeg(seg: number): string {
  return formatDuration(seg / 60);
}

const sinalDur = (min: number) => `${min < 0 ? "−" : "+"}${formatDuration(Math.abs(min))}`;

/** Renderiza um espelho a partir de `startY`; devolve o Y final (após as tabelas). */
function renderEspelho(doc: jsPDF, e: EspelhoData, calc?: CalcPeriodo | null): void {
  const pageW = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  // ---- Cabeçalho ----
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text("Espelho de Ponto", MARGIN, y);
  y += 7;

  doc.setFontSize(10);
  const nome = e.perfil?.nome ?? "—";
  const cargo = e.perfil?.cargo ? ` · ${e.perfil.cargo}` : "";
  const dept = e.perfil?.departamento ? ` · ${e.perfil.departamento}` : "";
  doc.text(`${nome}${cargo}${dept}`, MARGIN, y);
  y += 5;
  doc.setTextColor(90, 90, 90);
  doc.text(
    `Período: ${formatDate(e.periodo.de)} a ${formatDate(e.periodo.ate)}  ·  Gerado em ${formatDate(new Date())} ${formatHM(new Date())}`,
    MARGIN,
    y,
  );
  doc.setTextColor(0, 0, 0);
  y += 6;

  // ---- KPIs do período ----
  const k = e.kpis;
  autoTable(doc, {
    startY: y,
    head: [
      [
        "Tempo Ativo",
        "Ociosidade",
        "Efetivo",
        "Produtividade",
        "Pausa",
        "Almoço",
        "Inativo",
        "Abonado",
      ],
    ],
    body: [
      [
        formatDuration(k.ativoMin),
        formatDuration(k.ocioMin),
        formatDuration(k.efetivoMin),
        `${k.produtividade.toFixed(0)}%`,
        formatDuration(k.pausaMin),
        formatDuration(k.almocoMin),
        formatDuration(k.inativoMin),
        formatDuration(k.abonoMin),
      ],
    ],
    styles: { fontSize: 8, halign: "center" },
    headStyles: { fillColor: AZUL, halign: "center" },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ---- Apuração de jornada (vs horário padrão), quando disponível ----
  if (calc) {
    const t = calc.totais;
    autoTable(doc, {
      startY: y,
      head: [["Previsto", "Realizado", "Saldo", "Horas extras", "Pendentes", "Faltas", "Noturno"]],
      body: [
        [
          formatDuration(t.previstoMin),
          formatDuration(t.realizadoMin),
          sinalDur(t.saldoMin),
          formatDuration(t.extraMin),
          formatDuration(t.pendenteMin),
          `${t.faltas} dia(s)`,
          formatDuration(t.noturnoMin),
        ],
      ],
      styles: { fontSize: 8, halign: "center" },
      headStyles: { fillColor: AZUL, halign: "center" },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  // ---- Tabela diária ----
  doc.setFontSize(11);
  doc.text(calc ? "Apuração diária" : "Registro diário", MARGIN, y);
  y += 2;
  if (calc) {
    autoTable(doc, {
      startY: y,
      head: [
        [
          "Dia",
          "Entrada",
          "S.Almoço",
          "V.Almoço",
          "Saída",
          "Previsto",
          "Realiz.",
          "Ocio.",
          "Saldo",
          "Not.",
          "Situação",
        ],
      ],
      body: calc.linhas.map((d) => {
        const c = d.calc;
        return [
          formatDate(d.dia),
          fmtHora(d.marcacoes.entrada),
          fmtHora(d.marcacoes.almocoInicio),
          fmtHora(d.marcacoes.almocoFim),
          d.marcacoes.saida
            ? fmtHora(d.marcacoes.saida) + sufixoVirada(d.marcacoes.saida, d.dia)
            : c.aberto
              ? "em and."
              : "—",
          c.previstoMin ? formatDuration(c.previstoMin) : "—",
          c.realizadoMin ? formatDuration(c.realizadoMin) : "—",
          d.ocioMin ? formatDuration(d.ocioMin) : "—",
          c.realizadoMin || c.previstoMin ? sinalDur(c.saldoMin) : "—",
          c.noturnoMin ? formatDuration(c.noturnoMin) : "—",
          situacaoDia(c),
        ];
      }),
      styles: { fontSize: 7 },
      headStyles: { fillColor: AZUL },
      margin: { left: MARGIN, right: MARGIN },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const c = calc.linhas[data.row.index]?.calc;
        if (c?.falta) data.cell.styles.fillColor = [254, 235, 235];
        else if (calc.linhas[data.row.index]?.editado) data.cell.styles.fillColor = [243, 240, 255];
      },
    });
  } else {
    autoTable(doc, {
      startY: y,
      head: [["Dia", "Entrada", "Saída Almoço", "Volta Almoço", "Saída", "Trabalhado", "Obs."]],
      body: e.dias.map((d) => {
        const obs: string[] = [];
        if (d.tiposAjuste.length) {
          obs.push(d.tiposAjuste.map((t) => AJUSTE_TIPO_LABEL[t] ?? t).join(", "));
        }
        if (d.marcacoes.extras.length) obs.push(`+${d.marcacoes.extras.length} intervalo(s)`);
        if (d.ocioMin > 0) obs.push(`ócio ${formatDuration(d.ocioMin)}`);
        return [
          formatDate(d.dia),
          fmtHora(d.marcacoes.entrada),
          fmtHora(d.marcacoes.almocoInicio),
          fmtHora(d.marcacoes.almocoFim),
          fmtHora(d.marcacoes.saida) + sufixoVirada(d.marcacoes.saida, d.dia),
          formatDuration(d.ativoMin),
          obs.join(" · "),
        ];
      }),
      styles: { fontSize: 8 },
      headStyles: { fillColor: AZUL },
      margin: { left: MARGIN, right: MARGIN },
      didParseCell: (data) => {
        if (data.section === "body" && e.dias[data.row.index]?.editado) {
          data.cell.styles.fillColor = [243, 240, 255];
        }
      },
    });
  }
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ---- Abonos e edições (com os dois motivos) ----
  if (e.abonos.length) {
    doc.setFontSize(11);
    doc.text("Abonos e edições", MARGIN, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [["Dia", "Tipo", "Período", "Status", "Justificativa", "Decisão"]],
      body: e.abonos.map((a) => {
        const periodo =
          a.inicio && a.fim ? `${formatHM(a.inicio)}–${formatHM(a.fim)}` : "Dia inteiro";
        const decisao = [
          a.justificativaDecisao ?? "",
          a.decididoPorNome ? `(${a.decididoPorNome})` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return [
          formatDate(a.dia),
          AJUSTE_TIPO_LABEL[a.tipo] ?? a.tipo,
          periodo,
          AJUSTE_STATUS_LABEL[a.status] ?? a.status,
          a.justificativa,
          decisao,
        ];
      }),
      styles: { fontSize: 8, cellWidth: "wrap" },
      headStyles: { fillColor: AZUL },
      columnStyles: { 4: { cellWidth: 45 }, 5: { cellWidth: 45 } },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  // ---- Top apps / sites / categorias (lado a lado em duas colunas) ----
  const half = (pageW - MARGIN * 2 - 4) / 2;

  if (e.apps.length || e.sites.length) {
    const yStart = y;
    if (e.apps.length) {
      autoTable(doc, {
        startY: yStart,
        head: [["Top aplicativos", "Total", "Efetivo"]],
        body: e.apps.slice(0, 10).map((a) => [a.label, fmtSeg(a.totalSeg), fmtSeg(a.efetivoSeg)]),
        styles: { fontSize: 7 },
        headStyles: { fillColor: AZUL },
        margin: { left: MARGIN, right: MARGIN },
        tableWidth: half,
      });
    }
    if (e.sites.length) {
      autoTable(doc, {
        startY: yStart,
        head: [["Top sites", "Total", "Efetivo"]],
        body: e.sites.slice(0, 10).map((s) => [s.label, fmtSeg(s.totalSeg), fmtSeg(s.efetivoSeg)]),
        styles: { fontSize: 7 },
        headStyles: { fillColor: AZUL },
        margin: { left: MARGIN + half + 4, right: MARGIN },
        tableWidth: half,
      });
    }
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  if (e.categorias.length) {
    autoTable(doc, {
      startY: y,
      head: [["Categoria", "Tipo", "Tempo"]],
      body: e.categorias
        .slice(0, 12)
        .map((c) => [c.categoria, c.produtiva ? "Produtiva" : "Improdutiva", fmtSeg(c.segundos)]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: AZUL },
      margin: { left: MARGIN, right: MARGIN },
    });
  }
}

/** Gera (e baixa) um PDF com um espelho por usuário (1 página cada). `calculos` é
 *  paralelo a `espelhos` (apuração de jornada por usuário; opcional). */
export function gerarEspelhoPDF(
  espelhos: EspelhoData[],
  filename = "espelho-de-ponto.pdf",
  calculos?: (CalcPeriodo | null)[],
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  espelhos.forEach((e, i) => {
    if (i > 0) doc.addPage();
    renderEspelho(doc, e, calculos?.[i] ?? null);
  });
  doc.save(filename);
}
