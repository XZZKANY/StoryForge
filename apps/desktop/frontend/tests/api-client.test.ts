import assert from 'node:assert/strict';
import { test } from 'vitest';

import { probeApiRuntimeHealth } from '../src/lib/api-client';

test('probeApiRuntimeHealth maps ready response from public API health endpoint', async () => {
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          status: 'ready',
          checks: {
            redis: 'ok',
            db: 'ok',
            ignored: { nested: true },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  try {
    const health = await probeApiRuntimeHealth();

    assert.equal(fetchCalls[0].url, 'http://127.0.0.1:8000/health/ready');
    assert.equal(fetchCalls[0].init?.method, 'GET');
    assert.equal(fetchCalls[0].init?.cache, 'no-store');
    assert.equal(health.status, 'ready');
    assert.equal(health.reachable, true);
    assert.equal(health.baseUrl, 'http://127.0.0.1:8000');
    assert.deepEqual(health.checks, { db: 'ok', redis: 'ok' });
    assert.deepEqual(Object.keys(health.checks), ['db', 'redis']);
    assert.equal(health.detail, null);
    assert.equal(typeof health.latencyMs, 'number');
  } finally {
    if (previousFetch) {
      Object.defineProperty(globalThis, 'fetch', previousFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});

test('probeApiRuntimeHealth preserves degraded health responses', async () => {
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () =>
      new Response(
        JSON.stringify({
          status: 'degraded',
          checks: {
            redis: 'error',
            db: 'ok',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  });

  try {
    const health = await probeApiRuntimeHealth();

    assert.deepEqual(health, {
      status: 'degraded',
      reachable: true,
      baseUrl: 'http://127.0.0.1:8000',
      latencyMs: health.latencyMs,
      checks: { db: 'ok', redis: 'error' },
      detail: null,
    });
    assert.equal(typeof health.latencyMs, 'number');
  } finally {
    if (previousFetch) {
      Object.defineProperty(globalThis, 'fetch', previousFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});

test('probeApiRuntimeHealth degrades non-ok and failed fetches to unreachable', async () => {
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let callIndex = 0;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return new Response('starting', { status: 503 });
      }
      throw new Error('connect ECONNREFUSED');
    },
  });

  try {
    const nonOkHealth = await probeApiRuntimeHealth();
    assert.equal(nonOkHealth.status, 'unreachable');
    assert.equal(nonOkHealth.reachable, false);
    assert.equal(nonOkHealth.baseUrl, 'http://127.0.0.1:8000');
    assert.deepEqual(nonOkHealth.checks, {});
    assert.equal(nonOkHealth.detail, 'API 返回 503');
    assert.equal(typeof nonOkHealth.latencyMs, 'number');

    const failedHealth = await probeApiRuntimeHealth();
    assert.equal(failedHealth.status, 'unreachable');
    assert.equal(failedHealth.reachable, false);
    assert.equal(failedHealth.detail, 'connect ECONNREFUSED');
    assert.equal(typeof failedHealth.latencyMs, 'number');
  } finally {
    if (previousFetch) {
      Object.defineProperty(globalThis, 'fetch', previousFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});
