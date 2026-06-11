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

/** Tempo efetivamente trabalhado em uma linha granular (nunca negativo). */
export function tempoTrabalhado(
  duracaoSegundos: number | null | undefined,
  inativoSegundos: number | null | undefined,
): number {
  return Math.max(0, (duracaoSegundos || 0) - (inativoSegundos || 0));
}
