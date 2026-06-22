import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sendAgentUserMessage } from '../src/lib/api-client';

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

    assert.deepEqual(seenEvents, ['agent_run_started', 'agent_step', 'tool_trace', 'agent_result']);
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
