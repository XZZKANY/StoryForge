import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useRunAuthorAgent } from '../src/components/chat-window/useRunAuthorAgent';
import { useAgentRunRecovery } from '../src/components/chat-window/useAgentRunRecovery';
import { useAgentStreamEvent } from '../src/components/chat-window/useAgentStreamEvent';
import { statusFromAgentResult } from '../src/components/chat-window/resumed-result';
import { reconstructAgentResultFromEvents } from '../src/lib/api/agent-run-events';
import { sendAgentUserMessage, type AgentResultMessage } from '../src/lib/api-client';
import { APPLY_FILE_SUGGESTION_EVENT } from '../src/lib/assistant-events';

vi.mock('../src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api-client')>()),
  sendAgentUserMessage: vi.fn(),
  getAgentRunSavePoints: vi.fn().mockRejectedValue(new Error('no recovery projection')),
}));
vi.mock('../src/lib/project-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/project-context')>()),
  buildContextBundle: vi.fn(async () => ({
    projectRoot: 'D:/book',
    currentFile: null,
    files: [],
    summary: {
      hasStoryStructure: true,
      counts: {
        outline: 0,
        character: 0,
        setting: 0,
        timeline: 0,
        foreshadowing: 0,
        knowledge: 0,
        draft: 0,
        quality: 0,
        export: 0,
        other: 0,
      },
    },
    budget: {
      fileCount: 0,
      charCount: 0,
      maxFiles: 8,
      maxExcerptChars: 1200,
      truncated: false,
      pinnedFileCount: 0,
      missingPinnedFiles: [],
    },
  })),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const outcome = {
  status: 'partial',
  code: 'provider_connection',
  message: '本轮未完成，已完成结果已保留。',
} as const;
function result(patch = false): AgentResultMessage {
  return {
    type: 'agent_result',
    session_id: 'session',
    run_id: 'run',
    assistant_session_id: 7,
    intent: 'chat.explain',
    user_message: '检查第一章',
    plan: [{ step: 'agent.loop', detail: outcome.message, status: 'failed' }],
    tool_trace: [{ tool_name: 'file.review', status: 'completed', input_summary: {} }],
    agent_result: {
      summary: outcome.message,
      requires_user_confirmation: patch,
      execution_outcome: outcome,
      review_report: {
        kind: 'review_report',
        file_path: '正文/第一章.md',
        issues: [],
        suggested_actions: [],
      },
    },
    proposed_patch: patch
      ? {
          id: 'patch-1',
          kind: 'file_revision',
          file_path: '正文/第一章.md',
          before: '原稿',
          after: '新稿',
          requires_confirmation: true,
        }
      : null,
  };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let current: {
  state: ReturnType<typeof useChatWindowState>;
  run: ReturnType<typeof useRunAuthorAgent>;
  recovery: ReturnType<typeof useAgentRunRecovery>;
  onEvent: ReturnType<typeof useAgentStreamEvent>;
};
function Harness() {
  const state = useChatWindowState({
    projectPath: 'D:/book',
    currentFile: null,
    assistantSessionId: 7,
  });
  const recovery = useAgentRunRecovery(state, undefined);
  const onEvent = useAgentStreamEvent(state, recovery.refreshAgentRunRecovery);
  const run = useRunAuthorAgent(
    state,
    onEvent,
    recovery.updateAgentStatus,
    recovery.refreshAgentRunRecovery,
    undefined,
    'full',
  );
  current = { state, recovery, run, onEvent };
  return null;
}
async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness />));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.clearAllMocks();
});

it.each([false, true])(
  'persistent terminal reconstruction preserves partial result (patch=%s)',
  (patch) => {
    const expected = result(patch);
    const rebuilt = reconstructAgentResultFromEvents(
      [
        {
          event_type: patch ? 'permission_required' : 'agent_run_failed',
          payload: { execution_result: expected },
        },
      ],
      { runId: 'run', sessionId: 'session' },
    );
    expect(rebuilt).toEqual(expected);
    expect(statusFromAgentResult(expected)).toBe(patch ? 'waiting' : 'failed');
  },
);

it('live failure retains the review but never renders successful completion', async () => {
  vi.mocked(sendAgentUserMessage).mockResolvedValue(result());
  await mount();
  await act(async () => current.run('检查第一章', 'agent'));
  expect(current.state.agentRun?.status).toBe('failed');
  expect(current.state.lastReviewReport?.kind).toBe('review_report');
  expect(current.state.messages.at(-1)?.content).toContain(outcome.message);
  expect(current.state.agentBusy).toBe(false);
});

it('resumed failure retains the review without overwriting its failed status', async () => {
  await mount();
  await act(async () =>
    current.state.setAgentRun({
      id: 'run',
      sessionId: 'session',
      goal: '检查',
      status: 'running',
      steps: [],
    }),
  );
  await act(async () => current.recovery.applyResumedAgentResult(result()));
  expect(current.state.agentRun?.status).toBe('failed');
  expect(current.state.lastReviewReport?.kind).toBe('review_report');
});

it('a valid patch from a partial run waits even in full mode, and approval cannot erase failure', async () => {
  const suggestions: unknown[] = [];
  const listener = (event: Event) => suggestions.push((event as CustomEvent).detail);
  window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, listener);
  try {
    vi.mocked(sendAgentUserMessage).mockResolvedValue(result(true));
    await mount();
    await act(async () => current.run('检查第一章', 'agent'));
    expect(current.state.agentRun?.status).toBe('waiting');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ requiresConfirmation: true });
    await act(async () => current.recovery.updateAgentStatus('completed'));
    expect(current.state.agentRun?.status).toBe('failed');
    await act(async () =>
      current.onEvent({
        type: 'permission_approved',
        session_id: 'session',
        run_id: current.state.agentRun!.id,
        event_id: 10,
        status: 'recorded',
      }),
    );
    expect(current.state.agentRun?.status).toBe('failed');
  } finally {
    window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, listener);
  }
});

it('legacy failure events stay errors and malformed snapshots cannot become success', () => {
  expect(
    reconstructAgentResultFromEvents([{ event_type: 'agent_run_failed', message: '旧失败' }], {
      runId: 'run',
      sessionId: 'session',
    }),
  ).toMatchObject({ type: 'error', detail: '旧失败' });
  expect(() =>
    reconstructAgentResultFromEvents(
      [
        {
          event_type: 'agent_run_failed',
          payload: {
            execution_result: {
              ...result(),
              agent_result: { execution_outcome: { status: 'success' } },
            },
          },
        },
      ],
      { runId: 'run', sessionId: 'session' },
    ),
  ).toThrow();
});

it.each([
  { outer: false, inner: false },
  { outer: false, inner: true },
  { outer: true, inner: false },
])('rejects inconsistent partial patch confirmation: %j', ({ outer, inner }) => {
  const snapshot = result(true);
  snapshot.agent_result.requires_user_confirmation = outer;
  snapshot.proposed_patch = { ...snapshot.proposed_patch!, requires_confirmation: inner };
  expect(() =>
    reconstructAgentResultFromEvents(
      [{ event_type: 'permission_required', payload: { execution_result: snapshot } }],
      { runId: 'run', sessionId: 'session' },
    ),
  ).toThrow(/确认/);
});
