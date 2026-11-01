import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';

import { AgentStepsPanel } from '../src/components/chat-window/AgentStepsPanel';
import { RunActionBar } from '../src/components/chat-window/RunActionBar';
import {
  stepFromAgentPlanEvent,
  stepsFromAgentResult,
} from '../src/components/chat-window/agent-step-mapping';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useAgentStreamEvent } from '../src/components/chat-window/useAgentStreamEvent';
import type { AgentResultMessage } from '../src/lib/api-client';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let host: HTMLDivElement;
let current: {
  state: ReturnType<typeof useChatWindowState>;
  onEvent: ReturnType<typeof useAgentStreamEvent>;
};
const controls = {
  onPauseRun: () => undefined,
  onResumeRun: () => undefined,
  onStopRun: () => undefined,
  onApprovePermission: () => undefined,
  onDenyPermission: () => undefined,
};
function Harness() {
  const state = useChatWindowState({
    projectPath: 'D:/book',
    currentFile: null,
    assistantSessionId: 7,
  });
  const onEvent = useAgentStreamEvent(state, async () => undefined);
  current = { state, onEvent };
  return state.agentRun ? (
    <>
      <div data-testid="process-host">
        <AgentStepsPanel run={state.agentRun} />
      </div>
      <RunActionBar run={state.agentRun} controls={controls} />
    </>
  ) : null;
}
async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness />));
  await act(async () => {
    current.state.agentRunIdRef.current = 'run';
    current.state.setAgentBusy(true);
    current.state.setAgentRun({
      id: 'run',
      sessionId: 'session',
      goal: '审稿',
      status: 'running',
      steps: [stepFromAgentPlanEvent(0, 'agent.loop', 'Agent 正在运行。', 'running')],
    });
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});
function toggle() {
  const button = host.querySelector<HTMLButtonElement>('[data-testid="thinking-fold-toggle"]');
  if (!button) throw new Error('missing steps disclosure');
  return button;
}
async function progress(detail: string, sequence: number) {
  await act(async () =>
    current.onEvent({
      type: 'agent_step',
      run_id: 'run',
      session_id: 'session',
      assistant_session_id: 7,
      event_id: sequence,
      sequence,
      index: -1,
      step: 'agent.provider',
      status: 'running',
      detail,
    }),
  );
}
const processText = () => host.querySelector('[data-testid="thinking-log"]')?.textContent ?? '';
const barText = () => host.querySelector('[data-testid="thinking-active-step"]')?.textContent ?? '';

// 作者 10-16：思考过程里那行「模型请求 · 准备第 N 次模型请求」不要了。10-20 起底部运行条也去掉，
// 退避 / 重试的原因改由思考过程头部那一行报（跑着时转圈的那行），即使「整理回答」排在模型请求前面。
it('model requests stay out of the process rows; the live header spells out backoff', async () => {
  await mount();
  const details = [
    '准备第 1 次模型请求。',
    '模型请求暂不可用，等待 0.5 秒后重试。',
    '退避结束，准备重试。',
  ];
  for (const [index, detail] of details.entries()) {
    await progress(detail, 10 + index);
    expect(processText()).not.toContain('模型请求');
    expect(processText()).not.toContain(detail);
    expect(current.state.agentRun?.steps).toHaveLength(2);
    expect(current.state.agentRun?.steps[0]).toMatchObject({
      tool: 'agent.loop',
      status: 'running',
    });
    expect(current.state.agentBusy).toBe(true);
    expect(current.state.messages).toEqual([]);
  }
  // 平时写「思考中」或当前工具名，不把「准备第 N 次」念出来；重试 / 退避时写原因。
  await progress('准备第 2 次模型请求。', 20);
  expect(barText()).toContain('思考中');
  expect(barText()).not.toContain('准备第 2 次模型请求');
  await progress('模型请求暂不可用，等待 2 秒后重试。', 21);
  expect(barText()).toContain('模型请求暂不可用，等待 2 秒后重试。');
  await progress('退避结束，准备重试。', 22);
  expect(barText()).toContain('退避结束，准备重试。');
  expect(barText()).not.toContain('等待 2 秒后重试');
});

it('model-request events never reopen or refill the author-collapsed process', async () => {
  await mount();
  await progress('准备第 1 次模型请求。', 10);
  await act(async () => toggle().click());
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await progress('模型请求暂不可用，等待 2 秒后重试。', 11);
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await act(async () => toggle().click());
  expect(processText()).not.toContain('模型请求');
  expect(barText()).toContain('模型请求暂不可用，等待 2 秒后重试。');
});

it('a run with only model requests shows just the live header, no process rows', async () => {
  await mount();
  await act(async () => current.state.setAgentRun((run) => (run ? { ...run, steps: [] } : run)));
  await progress('准备第 1 次模型请求。', 10);
  expect(barText()).toContain('思考中');
  expect(processText()).toBe('');
  await progress('模型请求暂不可用，等待 2 秒后重试。', 11);
  expect(barText()).toContain('模型请求暂不可用，等待 2 秒后重试。');
});

it('a completed auto-writeback preparation step does not claim a Desktop write or snapshot receipt', async () => {
  await mount();
  const detail = '修订已准备，实际写入与快照由 Desktop 执行；这不是写入回执。';
  const response: AgentResultMessage = {
    type: 'agent_result',
    run_id: 'run',
    session_id: 'session',
    assistant_session_id: 7,
    intent: 'chat.explain',
    user_message: '修改第一章',
    plan: [{ step: 'writeback.auto', status: 'completed', detail }],
    tool_trace: [],
    agent_result: { summary: '修订建议已准备。', requires_user_confirmation: false },
    proposed_patch: {
      id: 'patch-1',
      kind: 'file_revision',
      file_path: '正文/第01章.md',
      before: '原稿',
      after: '修订稿',
      requires_confirmation: false,
    },
  };
  await act(async () => {
    current.state.setAgentRun((run) =>
      run ? { ...run, status: 'waiting', steps: stepsFromAgentResult(response) } : run,
    );
  });

  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  const row = Array.from(host.querySelectorAll('button')).find(
    (button) =>
      button.textContent?.includes('自动写进文件准备完成') && button.textContent.includes(detail),
  );
  expect(row).toBeDefined();
  expect(row?.closest('.grid')?.classList.contains('grid-rows-[1fr]')).toBe(true);
  expect(row?.closest('.grid')?.classList.contains('opacity-100')).toBe(true);
  expect(row?.textContent).toContain('✓');
  expect(row?.textContent).not.toMatch(/直接写进文件|已写入|快照完成/);
  expect(current.state.agentRun?.steps[0]).toMatchObject({
    tool: 'writeback.auto',
    status: 'completed',
    detail,
  });
});
