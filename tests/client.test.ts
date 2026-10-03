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
