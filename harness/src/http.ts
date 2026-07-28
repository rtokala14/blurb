/**
 * fetch with retry for transient API failures (429, 408, 5xx, 529, network).
 * Respects retry-after; exponential backoff with jitter otherwise.
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 4;
  const base = opts.baseDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  const signal = init.signal instanceof AbortSignal ? init.signal : undefined;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(maxDelay, base * 2 ** (attempt - 1)) * (0.5 + Math.random() * 0.5);
      await sleep(lastError instanceof ApiError && retryAfterMs(lastError) !== null
        ? retryAfterMs(lastError)!
        : delay, signal);
    }
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = await res.text();
      const err = new ApiError(`HTTP ${res.status}: ${body.slice(0, 500)}`, res.status, body);
      if (!RETRYABLE_STATUS.has(res.status)) throw err;
      (err as ApiError & { retryAfter?: string | null }).retryAfter =
        res.headers.get("retry-after");
      lastError = err;
    } catch (e) {
      if (e instanceof ApiError && !RETRYABLE_STATUS.has(e.status)) throw e;
      if (signal?.aborted) throw e;
      if (e instanceof TypeError || e instanceof ApiError) {
        lastError = e; // network error or retryable status
      } else {
        throw e;
      }
    }
  }
  throw lastError;
}

function retryAfterMs(err: ApiError): number | null {
  const ra = (err as ApiError & { retryAfter?: string | null }).retryAfter;
  if (!ra) return null;
  const secs = Number(ra);
  return Number.isFinite(secs) ? secs * 1000 : null;
}
