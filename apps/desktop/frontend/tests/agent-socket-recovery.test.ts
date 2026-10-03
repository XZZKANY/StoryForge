import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRunOutcomeUnknownError } from '../src/lib/api/agent-delivery';
import { sendAgentUserMessage } from '../src/lib/api/agent-socket';
import type { AgentSocketMessage } from '../src/lib/api/types';

vi.mock('../src/lib/api/config', () => ({
  getApiConfig: async () => ({ baseUrl: 'http://agent.test', apiKey: 'fixture-key' }),
  trimApiBaseUrl: (url: string) => url,
}));

const started = { type: 'agent_run_started', session_id: 'session', run_id: 'original' };
const completed = [
  {
    event_type: 'agent_run_completed',
    payload: { assistant_session_id: 7, summary: '完成', requires_user_confirmation: false },
  },
];

function brokenStream(frames: Record<string, unknown>[] = [started]): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (index < frames.length) {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(frames[index++])}\n\n`),
            );
          } else {
            controller.error(new TypeError('connection reset'));
          }
        },
      },
      { highWaterMark: 0 },
    ),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Agent delivery recovery keeps the original execution', () => {
  it.each([undefined, 'original'])(
    'reader failure recovers known run %s without a second POST',
    async (runId) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(brokenStream())
        .mockResolvedValueOnce(Response.json([]))
        .mockResolvedValueOnce(Response.json(completed));
      vi.stubGlobal('fetch', fetchMock);
      const fulfilled = vi.fn();
      const rejected = vi.fn();
      const events: AgentSocketMessage[] = [];
      const pending = sendAgentUserMessage({
        sessionId: 'session',
        runId,
        userMessage: '审稿',
        onEvent: (event) => events.push(event),
      }).then(fulfilled, rejected);
      await vi.advanceTimersByTimeAsync(0);
      expect(events.map((event) => event.type)).toEqual(['agent_run_started']);
      expect(rejected).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(6000);
      await pending;
      expect(fulfilled).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          type: 'agent_result',
          run_id: 'original',
          assistant_session_id: 7,
        }),
      );
      expect(rejected).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
      expect(fetchMock.mock.calls.slice(1).map(([url]) => url)).toEqual([
        'http://agent.test/api/agent-runs/original/events',
        'http://agent.test/api/agent-runs/original/events',
      ]);
      await vi.advanceTimersByTimeAsync(360_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it('recovers a request whose response was lost when the caller supplied its run id', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(Response.json(completed));
    vi.stubGlobal('fetch', fetchMock);
    const fulfilled = vi.fn();
    const rejected = vi.fn();
    const pending = sendAgentUserMessage({
      sessionId: 'session',
      runId: 'original',
      userMessage: '审稿',
    }).then(fulfilled, rejected);
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(fulfilled).toHaveBeenCalledOnce();
    expect(rejected).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('delivers a recovered pending patch only once even if the original timeout expires', async () => {
    const patch = {
      id: 'patch-1',
      kind: 'file_revision',
      file_path: 'chapter.md',
      before: '旧',
      after: '新',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(brokenStream())
      .mockResolvedValueOnce(
        Response.json([
          {
            event_type: 'permission_required',
            payload: {
              assistant_session_id: 7,
              proposed_patch: patch,
              requires_user_confirmation: true,
            },
          },
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    const fulfilled = vi.fn();
    const rejected = vi.fn();
    const pending = sendAgentUserMessage({
      sessionId: 'session',
      userMessage: '修订',
      timeoutMs: 100,
    }).then(fulfilled, rejected);
    await vi.advanceTimersByTimeAsync(6000);
    await pending;
    expect(fulfilled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ proposed_patch: patch }),
    );
    expect(rejected).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a stream failure without any execution identity', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(brokenStream([]));
    vi.stubGlobal('fetch', fetchMock);
    const pending = expect(
      sendAgentUserMessage({ sessionId: 'session', userMessage: '审稿' }),
    ).rejects.toThrow('connection reset');
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not turn an explicit HTTP rejection into background polling', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ detail: 'unauthorized' }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      sendAgentUserMessage({ sessionId: 'session', runId: 'original', userMessage: '审稿' }),
    ).rejects.toThrow('unauthorized');
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 422])(
    'keeps HTTP %s rejection final even when the error body never ends',
    async (status) => {
      const cancel = vi.fn();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"detail":"unfinished'));
          },
          cancel,
        }),
        { status },
      );
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response)
        .mockImplementation(async () => Response.json(completed));
      vi.stubGlobal('fetch', fetchMock);
      const fulfilled = vi.fn();
      const rejected = vi.fn();
      const pending = sendAgentUserMessage({
        sessionId: 'session',
        runId: 'original',
        userMessage: '审稿',
        timeoutMs: 100,
      }).then(fulfilled, rejected);

      await vi.advanceTimersByTimeAsync(6000);
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST')).toHaveLength(0);
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
      expect(rejected).toHaveBeenCalledExactlyOnceWith(new Error(`API 返回 ${status}`));
      expect(rejected.mock.calls[0][0]).not.toBeInstanceOf(AgentRunOutcomeUnknownError);
      expect(fulfilled).not.toHaveBeenCalled();
      await pending;
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body?.locked).toBe(false);
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(360_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    [
      'JSON detail',
      () => Response.json({ detail: '权限不足，请重新授权' }, { status: 403 }),
      '权限不足，请重新授权',
    ],
    ['malformed JSON', () => new Response('{broken', { status: 422 }), 'API 返回 422'],
    [
      'invalid detail',
      () => Response.json({ detail: ['invalid'] }, { status: 422 }),
      'API 返回 422',
    ],
    ['missing body', () => new Response(null, { status: 401 }), 'API 返回 401'],
    ...[new TypeError('read reset'), new DOMException('body aborted', 'AbortError')].map(
      (error) =>
        [
          error.name,
          () =>
            new Response(new ReadableStream({ start: (controller) => controller.error(error) }), {
              status: 403,
            }),
          'API 返回 403',
        ] as const,
    ),
  ] as const)(
    'keeps %s as a definite rejection, not an unknown outcome',
    async (_name, createResponse, detail) => {
      const response = createResponse();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
      vi.stubGlobal('fetch', fetchMock);
      const rejected = vi.fn();
      await sendAgentUserMessage({
        sessionId: 'session',
        runId: 'original',
        userMessage: '审稿',
        timeoutMs: 100,
      }).catch(rejected);
      expect(rejected).toHaveBeenCalledExactlyOnceWith(new Error(detail));
      expect(rejected.mock.calls[0][0]).not.toBeInstanceOf(AgentRunOutcomeUnknownError);
      expect(response.body?.locked ?? false).toBe(false);
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(6000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('waits for bounded error details independently of the expired SSE timeout', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      }),
      { status: 422 },
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
    vi.stubGlobal('fetch', fetchMock);
    const rejected = vi.fn();
    const pending = sendAgentUserMessage({
      sessionId: 'session',
      runId: 'original',
      userMessage: '审稿',
      timeoutMs: 100,
    }).catch(rejected);
    await vi.advanceTimersByTimeAsync(500);
    expect(rejected).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    // Split a multibyte character between chunks: preserve normal API error detail decoding.
    const encoded = new TextEncoder().encode('{"detail":"参数有误"}');
    streamController?.enqueue(encoded.slice(0, 12));
    streamController?.enqueue(encoded.slice(12));
    streamController?.close();
    await pending;
    expect(rejected).toHaveBeenCalledExactlyOnceWith(new Error('参数有误'));
    expect(response.body?.locked).toBe(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['rejects', 'never resolves'])(
    'does not await cleanup when reader cancellation %s',
    async (mode) => {
      const cancel = vi.fn(() =>
        mode === 'rejects'
          ? Promise.reject(new Error('cancel failed'))
          : new Promise<void>(() => {}),
      );
      const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 401 });
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
      vi.stubGlobal('fetch', fetchMock);
      const rejected = vi.fn();
      const pending = sendAgentUserMessage({
        sessionId: 'session',
        runId: 'original',
        userMessage: '审稿',
        timeoutMs: 60_000,
      }).catch(rejected);
      await vi.advanceTimersByTimeAsync(1999);
      expect(rejected).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(rejected).toHaveBeenCalledExactlyOnceWith(new Error('API 返回 401'));
      await pending;
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body?.locked).toBe(false);
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(360_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([1024, 65_537])(
    'bounds an endless HTTP error body with %s-byte chunks',
    async (chunkSize) => {
      const cancel = vi.fn();
      const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.enqueue(new Uint8Array(chunkSize));
      });
      const response = new Response(
        new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }),
        { status: 422 },
      );
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        sendAgentUserMessage({
          sessionId: 'session',
          runId: 'original',
          userMessage: '审稿',
          timeoutMs: 100,
        }),
      ).rejects.toThrow('API 返回 422');
      expect(pull).toHaveBeenCalledTimes(Math.floor(65_536 / chunkSize) + 1);
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body?.locked).toBe(false);
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(6000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not misclassify an event consumer exception as a network failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(brokenStream());
    vi.stubGlobal('fetch', fetchMock);
    const pending = expect(
      sendAgentUserMessage({
        sessionId: 'session',
        runId: 'original',
        userMessage: '审稿',
        onEvent: () => {
          throw new Error('consumer failed');
        },
      }),
    ).rejects.toThrow('consumer failed');
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it('exhaustion keeps the original execution identity and cannot switch to an unexpected started run', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === 'POST') return brokenStream([{ ...started, run_id: 'unexpected-run' }]);
    expect(String(url)).toBe('http://agent.test/api/agent-runs/original/events');
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  const rejected = vi.fn();
  const pending = sendAgentUserMessage({
    sessionId: 'session',
    runId: 'original',
    userMessage: '审稿',
  }).catch(rejected);
  await vi.advanceTimersByTimeAsync(300_000);
  await pending;
  expect(rejected).toHaveBeenCalledExactlyOnceWith(expect.any(AgentRunOutcomeUnknownError));
  expect(rejected.mock.calls[0][0]).toMatchObject({ runId: 'original', sessionId: 'session' });
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it.each([
  {
    type: 'agent_text_delta',
    run_id: 'other',
    stream_id: 's',
    round_index: 1,
    chunk_sequence: 1,
    text_delta: 'wrong',
  },
  { type: 'tool_trace', run_id: 'other', index: 0, trace: { tool_name: 'fs.read' } },
  { type: 'error', run_id: 'other', detail: 'wrong error' },
  {
    type: 'agent_result',
    run_id: 'other',
    session_id: 'session',
    assistant_session_id: 7,
    plan: [],
    tool_trace: [],
    agent_result: { summary: 'wrong' },
  },
  {
    type: 'agent_result',
    run_id: 'original',
    session_id: 'other-session',
    assistant_session_id: 7,
    plan: [],
    tool_trace: [],
    agent_result: { summary: 'wrong' },
  },
])(
  'foreign $type is not delivered or settled; only reconcile the original run',
  async (foreign) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(brokenStream([started, foreign]))
      .mockResolvedValueOnce(Response.json(completed));
    vi.stubGlobal('fetch', fetchMock);
    const delivered: AgentSocketMessage[] = [];
    const detached = vi.fn();
    const pending = sendAgentUserMessage({
      sessionId: 'session',
      runId: 'original',
      userMessage: '审稿',
      onEvent: (event) => delivered.push(event),
      onStreamDetached: detached,
    });
    await vi.advanceTimersByTimeAsync(6000);
    const result = await pending;
    expect(delivered).toEqual([started]);
    expect(detached).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      type: 'agent_result',
      run_id: 'original',
      agent_result: { summary: '完成' },
    });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls[1][0]).toBe('http://agent.test/api/agent-runs/original/events');
  },
);
