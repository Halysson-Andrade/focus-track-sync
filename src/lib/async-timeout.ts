export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function isTimeoutError(error: unknown) {
  return error instanceof TimeoutError || (error as Error | undefined)?.name === "TimeoutError";
}

export function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

/** Falha transitória de rede (fetch abortado/DNS/conexão), não erro de negócio. */
export function isNetworkError(error: unknown) {
  const msg = (error as Error | undefined)?.message?.toLowerCase() ?? "";
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed")
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface WithRetryOptions {
  /** Tentativas EXTRA além da primeira (default 2 => até 3 execuções). */
  retries?: number;
  /** Base do backoff exponencial em ms (default 400). */
  baseMs?: number;
  /** Teto do backoff por tentativa em ms (default 4000). */
  maxDelayMs?: number;
  /** Timeout de cada tentativa (default 12s). */
  timeoutMs?: number;
  /** Mensagem do TimeoutError. */
  message?: string;
  /** Decide se o erro é re-tentável. Default: timeout OU erro de rede. */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Executa `fn` com timeout e re-tentativas com backoff exponencial + jitter.
 * Use APENAS em operações idempotentes (login, getSession/getUser, leituras).
 * Por padrão só re-tenta timeout/erro de rede — erros determinísticos
 * (ex.: "Invalid login credentials") propagam de imediato, sem retry. O jitter
 * evita "thundering herd" quando o backend está saturado.
 */
export async function withRetry<T>(
  fn: () => PromiseLike<T>,
  opts: WithRetryOptions = {},
): Promise<T> {
  const {
    retries = 2,
    baseMs = 400,
    maxDelayMs = 4_000,
    timeoutMs = 12_000,
    message = "Tempo esgotado ao conectar.",
    shouldRetry = (err) => isTimeoutError(err) || isNetworkError(err),
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, message);
    } catch (err) {
      lastError = err;
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const backoff = Math.min(maxDelayMs, baseMs * 2 ** attempt);
      const jitter = Math.random() * backoff;
      await sleep(backoff + jitter);
    }
  }
  throw lastError;
}
