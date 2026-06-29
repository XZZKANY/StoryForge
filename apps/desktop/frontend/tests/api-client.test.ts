import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getAgentRunSavePoints,
  probeApiRuntimeHealth,
  probeProviderHealth,
  requestRevision,
  sendAgentControlMessage,
  sendAgentUserMessage,
} from '../src/lib/api-client';

test('agent websocket streams events and resolves with the final result', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const sentPayloads: Array<Record<string, unknown>> = [];
  const seenEvents: string[] = [];

  class MockWebSocket {
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    constructor(readonly url: string) {
      setTimeout(() => this.onopen?.(new Event('open')), 0);
    }

    send(raw: string) {
      sentPayloads.push(JSON.parse(raw) as Record<string, unknown>);
      const messages = [
        { type: 'agent_run_started', session_id: 'agent-session', run_id: 'run-1' },
        {
          type: 'agent_step',
          session_id: 'agent-session',
          run_id: 'run-1',
          index: 0,
          step: 'context-agent',
          detail: '读取上下文',
          status: 'completed',
        },
        {
          type: 'tool_trace',
          session_id: 'agent-session',
          run_id: 'run-1',
          index: 0,
          trace: {
            tool_name: 'subagent.context',
            status: 'completed',
            input_summary: {},
            output_summary: { context_file_count: 1 },
          },
        },
        {
          type: 'permission_required',
          session_id: 'agent-session',
          run_id: 'run-1',
          permission_profile: 'risk_confirm',
          reason: 'requires_user_confirmation',
          proposed_patch: null,
        },
        {
          type: 'agent_result',
          session_id: 'agent-session',
          run_id: 'run-1',
          assistant_session_id: 42,
          intent: 'file.review',
          user_message: '审一下',
          plan: [],
          agent_result: { summary: '完成', requires_user_confirmation: false },
          tool_trace: [],
          proposed_patch: null,
        },
      ];
      messages.forEach((message, index) => {
        setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
        }, index);
      });
    }

    close() {
      this.onclose?.({ code: 1000, reason: '' } as CloseEvent);
    }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
    },
  });
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: MockWebSocket,
  });

  try {
    const result = await sendAgentUserMessage({
      sessionId: 'agent-session',
      runId: 'run-1',
      userMessage: '审一下',
      args: { file_path: '正文/第01章.md' },
      onEvent: (event) => seenEvents.push(event.type),
    });

    assert.deepEqual(seenEvents, ['agent_run_started', 'agent_step', 'tool_trace', 'permission_required', 'agent_result']);
    assert.equal(result.type, 'agent_result');
    assert.equal(sentPayloads[0].stream, true);
    assert.equal(sentPayloads[0].run_id, 'run-1');
    assert.equal(sentPayloads[0].type, 'user_message');
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (previousWebSocket) {
      Object.defineProperty(globalThis, 'WebSocket', previousWebSocket);
    } else {
      Reflect.deleteProperty(globalThis, 'WebSocket');
    }
  }
});

test('agent websocket user message includes agent role hints in args', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const sentPayloads: Array<Record<string, unknown>> = [];

  class MockWebSocket {
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    constructor(readonly url: string) {
      setTimeout(() => this.onopen?.(new Event('open')), 0);
    }

    send(raw: string) {
      sentPayloads.push(JSON.parse(raw) as Record<string, unknown>);
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: 'agent_result',
            session_id: 'agent-session',
            run_id: 'run-1',
            assistant_session_id: 42,
            intent: 'file.review',
            user_message: '@剧情 审一下',
            plan: [],
            agent_result: { summary: '完成', requires_user_confirmation: false },
            tool_trace: [],
            proposed_patch: null,
          }),
        } as MessageEvent);
      }, 0);
    }

    close() {
      this.onclose?.({ code: 1000, reason: '' } as CloseEvent);
    }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
    },
  });
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: MockWebSocket,
  });

  try {
    await sendAgentUserMessage({
      sessionId: 'agent-session',
      runId: 'run-1',
      userMessage: '@剧情 审一下',
      args: { file_path: '正文/第01章.md' },
      agentRoleHints: ['plot_reviewer'],
      agentRoleMentions: ['@剧情'],
    });

    assert.deepEqual(sentPayloads[0].args, {
      file_path: '正文/第01章.md',
      agent_role_hints: ['plot_reviewer'],
      agent_role_mentions: ['@剧情'],
    });
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (previousWebSocket) {
      Object.defineProperty(globalThis, 'WebSocket', previousWebSocket);
    } else {
      Reflect.deleteProperty(globalThis, 'WebSocket');
    }
  }
});

test('agent websocket user message forwards explicit revise intent to the backend', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const sentPayloads: Array<Record<string, unknown>> = [];

  class MockWebSocket {
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    constructor(readonly url: string) {
      setTimeout(() => this.onopen?.(new Event('open')), 0);
    }

    send(raw: string) {
      sentPayloads.push(JSON.parse(raw) as Record<string, unknown>);
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: 'agent_result',
            session_id: 'agent-session',
            run_id: 'run-1',
            assistant_session_id: 42,
            intent: 'file.revise',
            user_message: '修选中问题：plot-1',
            plan: [],
            agent_result: { summary: '完成', requires_user_confirmation: true },
            tool_trace: [],
            proposed_patch: null,
          }),
        } as MessageEvent);
      }, 0);
    }

    close() {
      this.onclose?.({ code: 1000, reason: '' } as CloseEvent);
    }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
    },
  });
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: MockWebSocket,
  });

  try {
    // 含「问题」的修订话术若靠后端关键词分类会被判成 file.review；
    // 桌面端显式传 intent，必须原样发上线（后端据此跳过关键词分类）。
    await sendAgentUserMessage({
      sessionId: 'agent-session',
      runId: 'run-1',
      userMessage: '修选中问题：plot-1',
      intent: 'file.revise',
      args: { file_path: '正文/第01章.md' },
    });

    assert.equal(sentPayloads[0].intent, 'file.revise');
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (previousWebSocket) {
      Object.defineProperty(globalThis, 'WebSocket', previousWebSocket);
    } else {
      Reflect.deleteProperty(globalThis, 'WebSocket');
    }
  }
});

test('agent control websocket sends control message and resolves ack', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const sentPayloads: Array<Record<string, unknown>> = [];

  class MockWebSocket {
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    constructor(readonly url: string) {
      setTimeout(() => this.onopen?.(new Event('open')), 0);
    }

    send(raw: string) {
      sentPayloads.push(JSON.parse(raw) as Record<string, unknown>);
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: 'permission_approved',
            session_id: 'agent-session',
            run_id: 'run-1',
            status: 'recorded',
          }),
        } as MessageEvent);
      }, 0);
    }

    close() {
      this.onclose?.({ code: 1000, reason: '' } as CloseEvent);
    }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
    },
  });
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: MockWebSocket,
  });

  try {
    const result = await sendAgentControlMessage({
      sessionId: 'agent-session',
      runId: 'run-1',
      type: 'approve_permission',
      payload: { source: 'test' },
    });

    assert.equal(result.type, 'permission_approved');
    assert.deepEqual(sentPayloads[0], {
      type: 'approve_permission',
      run_id: 'run-1',
      payload: { source: 'test' },
    });
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (previousWebSocket) {
      Object.defineProperty(globalThis, 'WebSocket', previousWebSocket);
    } else {
      Reflect.deleteProperty(globalThis, 'WebSocket');
    }
  }
});

test('agent control websocket accepts retry_from_checkpoint ack', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const sentPayloads: Array<Record<string, unknown>> = [];

  class MockWebSocket {
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    constructor(readonly url: string) {
      setTimeout(() => this.onopen?.(new Event('open')), 0);
    }

    send(raw: string) {
      sentPayloads.push(JSON.parse(raw) as Record<string, unknown>);
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: 'retry_from_checkpoint',
            session_id: 'agent-session',
            run_id: 'bookrun-7',
            status: 'recorded',
          }),
        } as MessageEvent);
      }, 0);
    }

    close() {
      this.onclose?.({ code: 1000, reason: '' } as CloseEvent);
    }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
    },
  });
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: MockWebSocket,
  });

  try {
    const result = await sendAgentControlMessage({
      sessionId: 'agent-session',
      runId: 'bookrun-7',
      type: 'retry_from_checkpoint',
      payload: { reason: 'retry latest checkpoint' },
    });

    assert.equal(result.type, 'retry_from_checkpoint');
    assert.deepEqual(sentPayloads[0], {
      type: 'retry_from_checkpoint',
      run_id: 'bookrun-7',
      payload: { reason: 'retry latest checkpoint' },
    });
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (previousWebSocket) {
      Object.defineProperty(globalThis, 'WebSocket', previousWebSocket);
    } else {
      Reflect.deleteProperty(globalThis, 'WebSocket');
    }
  }
});

test('getAgentRunSavePoints fetches durable recovery projection', async () => {
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          run_id: 'bookrun-7',
          status: 'running',
          current_step: 'resumed',
          save_points: [
            {
              kind: 'control_message',
              source: 'event',
              event_id: 3,
              event_type: 'retry_from_checkpoint',
              sequence: 3,
              summary: { control_type: 'retry_from_checkpoint' },
            },
          ],
          pending: { permission_required: false },
          recoverability: { resume_strategy: 'bookrun_checkpoint' },
          runtime_recovery: {
            latest_control: { event_type: 'retry_from_checkpoint' },
          },
          interruption_model: { has_interrupted_event: false },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  try {
    const projection = await getAgentRunSavePoints('bookrun-7');

    assert.equal(fetchCalls[0].url, 'http://127.0.0.1:8000/api/agent-runs/bookrun-7/save-points');
    assert.equal(fetchCalls[0].init?.method, 'GET');
    assert.equal((fetchCalls[0].init?.headers as Record<string, string>)['X-StoryForge-API-Key'], 'local-dev-key');
    assert.equal(projection.run_id, 'bookrun-7');
    assert.equal(projection.save_points[0].kind, 'control_message');
    assert.equal(projection.runtime_recovery.latest_control?.['event_type'], 'retry_from_checkpoint');
  } finally {
    if (previousFetch) {
      Object.defineProperty(globalThis, 'fetch', previousFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});

test('requestRevision posts backend payload and maps revision response', async () => {
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          before: '旧正文',
          after: '新正文',
          summary: '已润色',
          model: 'story-model',
          latency_ms: 123,
          completion_tokens: 456,
          assistant_session_id: 99,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  try {
    const result = await requestRevision({
      filePath: '正文/第01章.md',
      content: '旧正文',
      instruction: '更紧张',
      projectName: '雾港回声',
      assistantSessionId: 12,
      contextBundle: {
        projectRoot: 'D:\\StoryForge\\Books\\雾港回声',
        currentFile: '正文/第01章.md',
        files: [
          {
            path: 'D:\\StoryForge\\Books\\雾港回声\\人物\\林岚.md',
            relativePath: '人物\\林岚.md',
            kind: 'character',
            title: '林岚.md',
            excerpt: '怕失去证据。',
          },
        ],
        summary: { hasStoryStructure: true, counts: { character: 1 } },
        budget: {
          fileCount: 1,
          charCount: 6,
          maxFiles: 8,
          maxExcerptChars: 1200,
          truncated: false,
          pinnedFileCount: 1,
          missingPinnedFiles: [],
        },
      },
    });

    assert.equal(fetchCalls[0].url, 'http://127.0.0.1:8000/api/assistant/revise');
    assert.equal(fetchCalls[0].init?.method, 'POST');
    assert.equal((fetchCalls[0].init?.headers as Record<string, string>)['X-StoryForge-API-Key'], 'local-dev-key');
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), {
      file_path: '正文/第01章.md',
      content: '旧正文',
      instruction: '更紧张',
      project_name: '雾港回声',
      assistant_session_id: 12,
      context_bundle: {
        project_root: 'D:\\StoryForge\\Books\\雾港回声',
        current_file: '正文/第01章.md',
        files: [
          {
            path: 'D:\\StoryForge\\Books\\雾港回声\\人物\\林岚.md',
            relative_path: '人物\\林岚.md',
            kind: 'character',
            title: '林岚.md',
            excerpt: '怕失去证据。',
          },
        ],
        summary: { hasStoryStructure: true, counts: { character: 1 } },
        budget: {
          file_count: 1,
          char_count: 6,
          max_files: 8,
          max_excerpt_chars: 1200,
          truncated: false,
          pinned_file_count: 1,
          missing_pinned_files: [],
        },
      },
    });
    assert.deepEqual(result, {
      before: '旧正文',
      after: '新正文',
      summary: '已润色',
      model: 'story-model',
      latencyMs: 123,
      completionTokens: 456,
      assistantSessionId: 99,
    });
  } finally {
    if (previousFetch) {
      Object.defineProperty(globalThis, 'fetch', previousFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});

test('requestRevision surfaces backend JSON error detail', async () => {
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () =>
      new Response(JSON.stringify({ detail: '上下文文件不可读' }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
  });

  try {
    await assert.rejects(
      () =>
        requestRevision({
          filePath: '正文/第01章.md',
          content: '正文',
          instruction: '修订',
        }),
      /上下文文件不可读/,
    );
  } finally {
    if (previousFetch) {
      Object.defineProperty(globalThis, 'fetch', previousFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});

test('probeProviderHealth maps health response and falls back for non-json errors', async () => {
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let callIndex = 0;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            reachable: true,
            base_url: 'https://provider.test',
            model: 'writer-model',
            latency_ms: 321,
            model_count: 2,
            detail: null,
            missing_env: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('temporary gateway failure', { status: 503 });
    },
  });

  try {
    assert.deepEqual(await probeProviderHealth(), {
      status: 'ok',
      reachable: true,
      baseUrl: 'https://provider.test',
      model: 'writer-model',
      latencyMs: 321,
      modelCount: 2,
      detail: null,
      missingEnv: [],
    });
    await assert.rejects(() => probeProviderHealth(), /API 返回 503/);
  } finally {
    if (previousFetch) {
      Object.defineProperty(globalThis, 'fetch', previousFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});

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
