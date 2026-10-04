import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorText, postJson } from '../src/lib/client';

test('timeout gives an error without technical text, so the UI shows its own message', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); });
  try {
    await assert.rejects(() => postJson('/api/ai', {}, 5), (e: unknown) => errorText(e, 'fallback') === 'fallback');
  } finally {
    globalThis.fetch = original;
  }
});

test('server error text is passed through', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'AI jest niedostępne.' }), { status: 503 });
  try {
    await assert.rejects(() => postJson('/api/ai', {}), /AI jest niedostępne/);
  } finally {
    globalThis.fetch = original;
  }
});

test('an HTML error page from a proxy never leaks parser errors', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>502</html>', { status: 502 });
  try {
    await assert.rejects(() => postJson('/api/journey', {}), (e: unknown) => errorText(e, 'fallback') === 'fallback');
  } finally {
    globalThis.fetch = original;
  }
});

test('browser-specific network and parser errors use the localized fallback', async () => {
  for (const e of [new TypeError('Failed to fetch'), new TypeError('Load failed'), new SyntaxError('Unexpected token <'), new DOMException('The operation was aborted', 'AbortError')]) {
    assert.equal(errorText(e, 'Nie udało się pobrać trasy.'), 'Nie udało się pobrać trasy.');
  }
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    await assert.rejects(() => postJson('/api/journey', {}), (e: unknown) => errorText(e, 'lokalisiert') === 'lokalisiert');
  } finally { globalThis.fetch = original; }
});

test('changing route inputs can cancel an in-flight request', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    requestSignal = init?.signal;
    requestSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  try {
    const pending = postJson('/api/journey', {}, 35000, {}, controller.signal);
    controller.abort();
    await assert.rejects(pending, (e: unknown) => errorText(e, 'fallback') === 'fallback');
    assert.equal(requestSignal?.aborted, true);
  } finally { globalThis.fetch = original; }
});
