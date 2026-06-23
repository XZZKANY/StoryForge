import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sendAgentControlMessage, sendAgentUserMessage } from '../src/lib/api-client';

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
