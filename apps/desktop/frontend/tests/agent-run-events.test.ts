import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reconstructAgentResultFromEvents } from '../src/lib/api/agent-run-events';
import type { AgentErrorMessage, AgentResultMessage } from '../src/lib/api/types';

const CONTEXT = { sessionId: 'session-1', runId: 'run-1' };

test('reconstructs an agent_result from a completed event payload', () => {
  const message = reconstructAgentResultFromEvents(
    [
      {
        event_type: 'agent_plan_created',
        payload: { plan: [{ step: 'agent.loop', detail: '循环', status: 'completed' }] },
      },
      {
        event_type: 'tool_trace',
        payload: { trace: { tool_name: 'fs.read', status: 'completed', input_summary: {} } },
      },
      {
        event_type: 'agent_run_completed',
        message: '收工。',
        payload: {
          intent: 'chat.explain',
          assistant_session_id: 42,
          requires_user_confirmation: false,
          summary: '已完成审阅。',
        },
      },
    ],
    CONTEXT,
  );

  assert.ok(message);
  assert.equal(message.type, 'agent_result');
  const result = message as AgentResultMessage;
  assert.equal(result.assistant_session_id, 42);
  assert.equal(result.intent, 'chat.explain');
  assert.equal(result.agent_result.summary, '已完成审阅。');
  assert.equal(result.agent_result.requires_user_confirmation, false);
  assert.equal(result.plan.length, 1);
  assert.deepEqual(
    result.tool_trace.map((trace) => trace.tool_name),
    ['fs.read'],
  );
});

test('reconstructs an error message from a failed event', () => {
  const message = reconstructAgentResultFromEvents(
    [{ event_type: 'agent_run_failed', message: '进程重启，运行未完成即收尸。', payload: {} }],
    CONTEXT,
  );

  assert.ok(message);
  assert.equal(message.type, 'error');
  const error = message as AgentErrorMessage;
  assert.equal(error.detail, '进程重启，运行未完成即收尸。');
  assert.equal(error.run_id, 'run-1');
});

test('treats a permission_required event as a confirmation-pending result', () => {
  const message = reconstructAgentResultFromEvents(
    [
      {
        event_type: 'permission_required',
        payload: {
          assistant_session_id: 7,
          intent: 'chat.explain',
          proposed_patch: { kind: 'file_revision', file_path: '正文/第01章.md' },
        },
      },
    ],
    CONTEXT,
  );

  assert.ok(message);
  const result = message as AgentResultMessage;
  assert.equal(result.type, 'agent_result');
  assert.equal(result.agent_result.requires_user_confirmation, true);
  assert.equal(result.agent_result.writeback_blocked_until_user_confirms, true);
  assert.ok(result.proposed_patch);
});

test('returns null when no terminal event is present yet', () => {
  const message = reconstructAgentResultFromEvents(
    [
      { event_type: 'agent_run_started', payload: {} },
      { event_type: 'tool_trace', payload: { trace: { tool_name: 'fs.list' } } },
    ],
    CONTEXT,
  );

  assert.equal(message, null);
});

test('returns null when a completed event lacks assistant_session_id to rebuild', () => {
  const message = reconstructAgentResultFromEvents(
    [{ event_type: 'agent_run_completed', payload: { summary: '缺少会话 id' } }],
    CONTEXT,
  );

  assert.equal(message, null);
});
