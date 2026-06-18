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