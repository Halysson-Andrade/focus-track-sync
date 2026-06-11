import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDateTime, formatDuration, STATUS_LABEL } from "./format";

export interface ExportRow {
  usuario: string;
  data: string;
  inicio: string;
  fim: string;
  status: string;
  duracao: string;
}

export function buildRows(
  records: Array<{
    status: string;
    inicio: string;
    fim: string | null;
    duracao_minutos: number | null;
    usuario?: string;
  }>,
): ExportRow[] {
  return records.map((r) => ({
    usuario: r.usuario ?? "",
    data: new Date(r.inicio).toLocaleDateString("pt-BR"),
    inicio: formatDateTime(r.inicio),
    fim: r.fim ? formatDateTime(r.fim) : "Em andamento",
    status: STATUS_LABEL[r.status] ?? r.status,
    duracao: formatDuration(r.duracao_minutos ?? 0),
  }));
}

export function exportCSV(rows: ExportRow[], filename = "relatorio.csv") {
  const headers = ["Usuário", "Data", "Início", "Fim", "Status", "Duração"];
  const lines = [
    headers.join(";"),
    ...rows.map((r) =>
      [r.usuario, r.data, r.inicio, r.fim, r.status, r.duracao]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";"),
    ),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename);
}

export function exportExcel(rows: ExportRow[], filename = "relatorio.xlsx") {
  const ws = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      Usuário: r.usuario,
      Data: r.data,
      Início: r.inicio,
      Fim: r.fim,
      Status: r.status,
      Duração: r.duracao,
    })),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório");
  XLSX.writeFile(wb, filename);
}

export function exportPDF(rows: ExportRow[], filename = "relatorio.pdf") {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text("Relatório de Atividades", 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [["Usuário", "Data", "Início", "Fim", "Status", "Duração"]],
    body: rows.map((r) => [r.usuario, r.data, r.inicio, r.fim, r.status, r.duracao]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 64, 175] },
  });
  doc.save(filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
