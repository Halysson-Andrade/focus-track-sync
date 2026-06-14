// Ponto único de verdade dos limites de atividade/ociosidade no app web.
// Os mesmos valores são replicados em desktop/src/config.js e extension/config.js
// (processos separados, sem build compartilhado). Mantenha-os sincronizados.

// Idle granular: tempo sem mouse/teclado descontado como `inativo_segundos`.
export const IDLE_THRESHOLD_MS = 180_000; // 3 min

// Status macro INATIVO: a sessão é marcada inativa após este tempo sem atividade.
export const INACTIVITY_LIMIT_MS = 600_000; // 10 min

// Janela em que um heartbeat (extensão/desktop) ainda conta como presença.
// Precisa ser maior que INACTIVITY_LIMIT_MS, senão a checagem se desativa
// justamente quando os heartbeats param (almoço / máquina bloqueada).
export const EXT_PRESENCE_WINDOW_MS = INACTIVITY_LIMIT_MS + 5 * 60 * 1000; // 15 min

// Auto-encerramento server-side: minutos sem QUALQUER sinal no banco antes de
// uma sessão aberta (ATIVO/INATIVO) ser fechada pelo job `encerrar-ociosas`.
// Espelha o `p_timeout_min` da função SQL `encerrar_sessoes_ociosas`.
export const AUTO_LOGOUT_TIMEOUT_MIN = 15;

// Cadência do heartbeat do próprio app web (presenca_web) enquanto ATIVO. Serve
// de rede de segurança para usuário só-web (sem extensão/desktop) não ser
// auto-encerrado por engano. NÃO é lido de volta pela detecção de INATIVO.
export const WEB_PRESENCE_HEARTBEAT_MS = 60_000; // 1 min

/**
 * Verifica se `host` casa com algum domínio da whitelist (match por sufixo:
 * o próprio domínio ou um subdomínio dele). Ex.: "www.youtube.com" casa com
 * "youtube.com".
 */
export function isWhitelistedDomain(host: string | null | undefined, list: string[]): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return list.some((d) => {
    const dom = d.toLowerCase();
    return h === dom || h.endsWith("." + dom);
  });
}

// Processos do navegador Chrome — desconsiderados na monitoração de "Apps
// Desktop" e no cálculo de ociosidade, porque a navegação (e seu ócio
// passive-aware) já é capturada pela extensão. Evita contagem dupla do mesmo
// intervalo de relógio entre as fontes desktop e extensão.
const CHROME_PROCESS_RE = /chrome|chromium|google chrome/i;
export function isChromeProcess(p: string | null | undefined): boolean {
  return CHROME_PROCESS_RE.test(p || "");
}

/** Tempo efetivamente trabalhado em uma linha granular (nunca negativo). */
export function tempoTrabalhado(
  duracaoSegundos: number | null | undefined,
  inativoSegundos: number | null | undefined,
): number {
  return Math.max(0, (duracaoSegundos || 0) - (inativoSegundos || 0));
}
