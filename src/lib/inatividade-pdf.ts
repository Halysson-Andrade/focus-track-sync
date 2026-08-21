// Geração do PDF do Relatório de Inatividade (jsPDF + jspdf-autotable — já
// dependências do projeto, mesmo padrão/estilo de [espelho-pdf.ts]).
//
// Uma página com: cabeçalho (período + setor + gerado em), KPIs do período,
// "Ranking por setor" e "Ranking por colaborador" (ambos ordenados por ócio desc).

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatDuration, formatHM } from "./format";
import type { RelatorioInatividade } from "./relatorio-inatividade";
import { JUSTIFICATIVA_STATUS_LABEL } from "./justificativas-ocio";

const MARGIN = 14;
const AZUL: [number, number, number] = [30, 64, 175];

function finalY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

export function gerarInatividadePDF(
  rel: RelatorioInatividade,
  filtro: { de: string; ate: string; setorLabel: string },
  filename = "relatorio-inatividade.pdf",
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = MARGIN;

  // ---- Cabeçalho ----
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text("Relatório de Inatividade", MARGIN, y);
  y += 7;

  doc.setFontSize(10);
  doc.text(`Setor: ${filtro.setorLabel}`, MARGIN, y);
  y += 5;
  doc.setTextColor(90, 90, 90);
  doc.text(
    `Período: ${formatDate(filtro.de)} a ${formatDate(filtro.ate)}  ·  Gerado em ${formatDate(new Date())} ${formatHM(new Date())}`,
    MARGIN,
    y,
  );
  doc.setTextColor(0, 0, 0);
  y += 6;

  // ---- KPIs do período ----
  const pctTotal = rel.totalAtivoMin > 0 ? (rel.totalOcioMin / rel.totalAtivoMin) * 100 : 0;
  autoTable(doc, {
    startY: y,
    head: [
      ["Ociosidade total", "Ócio justificado", "Tempo ativo total", "% ócio", "Colaboradores"],
    ],
    body: [
      [
        formatDuration(rel.totalOcioMin),
        formatDuration(rel.totalOcioJustificadoMin),
        formatDuration(rel.totalAtivoMin),
        `${pctTotal.toFixed(0)}%`,
        String(rel.totalColaboradores),
      ],
    ],
    styles: { fontSize: 8, halign: "center" },
    headStyles: { fillColor: AZUL, halign: "center" },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = finalY(doc) + 6;

  // ---- Ranking por setor ----
  doc.setFontSize(11);
  doc.text("Ranking por setor", MARGIN, y);
  y += 2;
  autoTable(doc, {
    startY: y,
    head: [["#", "Setor", "Colab.", "Ócio", "Tempo ativo", "% ócio"]],
    body: rel.setores.map((s, i) => [
      String(i + 1),
      s.setorLabel,
      String(s.colaboradores),
      formatDuration(s.ocioMin),
      formatDuration(s.ativoMin),
      `${s.pctOcio.toFixed(0)}%`,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: AZUL },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = finalY(doc) + 6;

  // ---- Ranking por colaborador ----
  doc.setFontSize(11);
  doc.text("Ranking por colaborador", MARGIN, y);
  y += 2;
  autoTable(doc, {
    startY: y,
    head: [["#", "Colaborador", "Setor", "Ócio", "Tempo ativo", "% ócio"]],
    body: rel.colaboradores.map((c, i) => [
      String(i + 1),
      c.nome,
      c.setorLabel,
      formatDuration(c.ocioMin),
      formatDuration(c.ativoMin),
      `${c.pctOcio.toFixed(0)}%`,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: AZUL },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = finalY(doc) + 6;

  // ---- Justificativas de ociosidade (o que saiu do ranking) ----
  if (rel.justificativas.length) {
    doc.setFontSize(11);
    doc.text("Justificativas de ociosidade", MARGIN, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [["Dia", "Colaborador", "Período", "Duração", "Status", "Justificativa", "Decisão"]],
      body: rel.justificativas.map((j) => [
        formatDate(j.dia),
        j.nome,
        `${formatHM(j.inicio)}–${formatHM(j.fim)}`,
        formatDuration(j.duracaoMin),
        JUSTIFICATIVA_STATUS_LABEL[j.status] ?? j.status,
        j.justificativa,
        [j.justificativaDecisao ?? "", j.decididoPorNome ? `(${j.decididoPorNome})` : ""]
          .filter(Boolean)
          .join(" "),
      ]),
      styles: { fontSize: 7, cellWidth: "wrap" },
      headStyles: { fillColor: AZUL },
      columnStyles: { 5: { cellWidth: 40 }, 6: { cellWidth: 32 } },
      margin: { left: MARGIN, right: MARGIN },
    });
  }

  doc.save(filename);
}
