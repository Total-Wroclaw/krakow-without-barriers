/**
 * POST JSON with a timeout. Failures throw an Error whose message is the server's user-facing
 * `error` text when there is one, and an empty string otherwise (offline, timeout, HTML proxy
 * error pages), so callers can show their own translated fallback.
 */
export async function postJson(url: string, body: unknown, timeout = 35000, headers: Record<string, string> = {}, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new RequestError(typeof data?.error === 'string' ? data.error : '', res.status);
    return data;
  } catch (e) {
    if (e instanceof RequestError) throw e;
    throw new RequestError('', 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The user-facing text of an error, or the given fallback when there is none. */
export function errorText(e: unknown, fallback: string) {
  if (e instanceof TypeError || e instanceof SyntaxError || e instanceof DOMException) return fallback;
  return e instanceof Error && e.message ? e.message : fallback;
}
