import assert from 'node:assert/strict';
import { test } from 'node:test';

import { subscribeBookRunEvents } from '../src/lib/api/run-events';

test('run event stream authenticates with a header and parses SSE events', async () => {
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let requestHeaders: HeadersInit | undefined;
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (_url: URL, init?: RequestInit) => {
      requestHeaders = init?.headers;
      return new Response('event: progress\ndata: {"chapter":2}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    },
  });

  try {
    const unsubscribe = await subscribeBookRunEvents(7, (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const headers = new Headers(requestHeaders);
    assert.equal(headers.get('X-StoryForge-API-Key'), 'local-dev-key');
    assert.equal(headers.get('Accept'), 'text/event-stream');
    assert.deepEqual(events, [{ event: 'progress', data: { chapter: 2 } }]);
    unsubscribe();
  } finally {
    if (previousFetch) {
      Object.defineProperty(globalThis, 'fetch', previousFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});
