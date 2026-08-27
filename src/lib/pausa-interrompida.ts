/**
 * Detecção de "pausa/almoço interrompido pelo sistema".
 *
 * Até a migration 20260827120000, uma aba web defasada podia marcar INATIVO
 * durante um almoço em curso: a linha ALMOCO morria com ~10 min e a jornada era
 * encerrada pelo cron de ociosidade. A blindagem impede novos casos; esta
 * detecção existe para RECUPERAR os dias já afetados — o colaborador retoma o
 * expediente e solicita a correção do período sem edição manual no banco.
 */
export type RegistroBruto = {
  id: string;
  status: string;
  inicio: string;
  fim: string | null;
  observacao?: string | null;
};

const PAUSAS = ["PAUSA", "ALMOCO"];

/**
 * Retorna a última pausa/almoço do dia que foi fechada SEM o usuário ter voltado
 * ao trabalho e sem ele ter encerrado o expediente — ou null.
 *
 * `registros` deve vir ordenado por `inicio` crescente (como em todayRecords).
 */
export function detectarPausaInterrompida(registros: RegistroBruto[]): RegistroBruto | null {
  if (!registros.length) return null;

  // Jornada viva e coerente (ATIVO/PAUSA/ALMOCO em curso): nada a recuperar.
  const aberta = registros.find((r) => !r.fim);
  if (aberta && aberta.status !== "INATIVO") return null;

  const idx = registros.map((r) => r.status).lastIndexOf("ALMOCO");
  const idxPausa = registros.map((r) => r.status).lastIndexOf("PAUSA");
  const i = Math.max(idx, idxPausa);
  if (i < 0) return null;

  const pausa = registros[i];
  if (!PAUSAS.includes(pausa.status) || !pausa.fim) return null;

  const posteriores = registros.slice(i + 1);
  // Voltou ao trabalho depois: o registro está íntegro.
  if (posteriores.some((r) => r.status === "ATIVO")) return null;
  // Encerrou o expediente de propósito (marcador ENCERRADO logo após a pausa).
  if (posteriores.some((r) => r.status === "ENCERRADO")) return null;

  const interrompidaPorInatividade = posteriores.some((r) => r.status === "INATIVO");
  const autoEncerrada = (pausa.observacao ?? "").includes("auto-encerrado");
  // Pausa fechada sem nada depois também é interrupção: sair da pausa abre ATIVO
  // e encerrar cria o marcador ENCERRADO — nenhum dos dois aconteceu.
  const fechadaSemDestino = posteriores.length === 0;

  return interrompidaPorInatividade || autoEncerrada || fechadaSemDestino ? pausa : null;
}
