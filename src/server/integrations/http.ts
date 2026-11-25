/** HTTP helpers for vendor APIs: plain-English errors, redaction, retries, throttling. */
export class IntegrationHttpError extends Error {
  constructor(
    public status: number,
    public plainEnglish: string,
    public bodySnippet?: string,
  ) {
    super(`HTTP ${status}: ${plainEnglish}`);
  }
}

export function explainHttpStatus(system: "Paycor" | "Attendance on Demand", status: number): string {
  switch (status) {
    case 400:
      return `${system} rejected the request as malformed. Usually a wrong setting value (e.g. legal entity ID or redirect URL).`;
    case 401:
      return `${system} did not accept the credentials. The token expired, or the client secret / password is wrong.`;
    case 403:
      return `${system} recognized us but refused access. Usually the API permission (scope) for this data was not granted, the app was not activated for this legal entity, or the subscription key is wrong.`;
    case 404:
      return `${system} says this address does not exist. Usually a wrong base URL, wrong ID, or an endpoint not enabled for your account.`;
    case 429:
      return `${system} says we sent too many requests. The app will slow down and retry automatically.`;
    default:
      if (status >= 500) return `${system} had an internal error. This is on their side. Try again later and contact their support if it persists.`;
      return `${system} returned an unexpected response (HTTP ${status}).`;
  }
}

/** Strip anything that looks like a token/secret before showing or logging a body. */
export function redact(text: string): string {
  return text
    .replace(/("?(access_token|refresh_token|client_secret|password|subscription-key)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [REDACTED]")
    .slice(0, 500);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Retry 5xx responses (default true). Set false for non-idempotent POSTs. */
  retryServerErrors?: boolean;
  /** Retry when the request never got a response (default true). */
  retryNetworkErrors?: boolean;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * fetch with retries on network errors, 429 and 5xx. Honors Retry-After.
 * 4xx other than 429 are returned immediately (retrying won't help).
 */
export async function fetchWithRetry(url: string | URL, init: RequestInit, opts: RetryOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 15_000;
  const f = opts.fetchImpl ?? fetch;
  const wait = opts.sleepImpl ?? sleep;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await f(url, init);
      if (res.status !== 429 && (res.status < 500 || opts.retryServerErrors === false)) return res;
      if (attempt === retries) return res;
      const ra = res.headers.get("retry-after");
      const raMs = ra ? (Number.isFinite(Number(ra)) ? Number(ra) * 1000 : Math.max(0, Date.parse(ra) - Date.now())) : 0;
      await wait(Math.min(max, Math.max(raMs, base * 2 ** attempt + Math.random() * base)));
    } catch (e) {
      lastErr = e;
      if (attempt === retries || opts.retryNetworkErrors === false) throw e;
      await wait(Math.min(max, base * 2 ** attempt + Math.random() * base));
    }
  }
  throw lastErr;
}

/** Simple serial throttle: at most one request every `intervalMs`. */
export function createThrottle(intervalMs: number) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + intervalMs;
    if (at > now) await sleep(at - now);
  };
}
