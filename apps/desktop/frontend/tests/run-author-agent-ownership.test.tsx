/**
 * T01 准备期请求归属：提交身份冻结 + 每个 await 后复验。
 *
 * 一轮 run 在真正 POST 之前要经过读盘 / 建上下文 / 外部写回协商等 await。作者在这些窗口里
 * 切会话、切项目、切目标或卸载时，绝不能把「起跑时的资料 + 当前的会话」拼成一条请求发出去。
 * 断言落在真实网络发送边界（sendAgentUserMessage 的请求体）上。
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useRunAuthorAgent } from '../src/components/chat-window/useRunAuthorAgent';
import {
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
} from '../src/lib/assistant-events';
import { sendAgentUserMessage, type AgentUserMessageRequest } from '../src/lib/api-client';
import { buildContextBundle, type ContextBundle } from '../src/lib/project-context';
import { TauriFileSystem } from '../src/lib/tauri-fs';

vi.mock('../src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api-client')>()),
  sendAgentUserMessage: vi.fn(),
}));
vi.mock('../src/lib/project-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/project-context')>()),
  buildContextBundle: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const PROJECT = 'D:/books/wu-gang';
const OTHER_PROJECT = 'D:/books/other-book';
const FILE = 'D:/books/wu-gang/chapter-01.md';
const OTHER_FILE = 'D:/books/wu-gang/chapter-02.md';
const RUN_GOAL = '检查这段设定';

function contextBundle(): ContextBundle {
  return {
    projectRoot: PROJECT,
    currentFile: null,
    files: [],
    summary: { hasStoryStructure: true, counts: {} },
    budget: {
      fileCount: 0,
      charCount: 0,
      maxFiles: 8,
      maxExcerptChars: 1200,
      truncated: false,
      pinnedFileCount: 0,
      missingPinnedFiles: [],
    },
  } as unknown as ContextBundle;
}

let root: Root | undefined;
let host: HTMLDivElement;
let api: {
  state: ReturnType<typeof useChatWindowState>;
  run: ReturnType<typeof useRunAuthorAgent>;
};
let changeSession: ((id: number | null) => void) | null = null;
let contextGate: (() => void) | null = null;

function Body({
  project,
  session,
  currentFile,
  onSessionChange,
}: {
  project: string;
  session: number | null;
  currentFile: string | null;
  onSessionChange: (id: number | null) => void;
}) {
  const state = useChatWindowState({
    projectPath: project,
    currentFile,
    assistantSessionId: session,
  });
  const run = useRunAuthorAgent(
    state,
    () => undefined,
    () => undefined,
    async () => undefined,
    onSessionChange,
    'ask',
  );
  api = { state, run };
  return null;
}

function Shell({
  project,
  initialSession,
  currentFile,
}: {
  project: string;
  initialSession: number | null;
  currentFile: string | null;
}) {
  const [session, setSession] = useState<number | null>(initialSession);
  changeSession = setSession;
  return (
    <Body
      project={project}
      session={session}
      currentFile={currentFile}
      onSessionChange={setSession}
    />
  );
}

let harnessProps: {
  project: string;
  initialSession: number | null;
  currentFile: string | null;
} = { project: PROJECT, initialSession: 7, currentFile: null };

async function render(next: Partial<typeof harnessProps> = {}) {
  harnessProps = { ...harnessProps, ...next };
  await act(async () => root!.render(<Shell {...harnessProps} />));
}

async function startRun() {
  await act(async () => {
    void api.run(RUN_GOAL, 'agent');
  });
}

async function releaseContext() {
  const gate = contextGate;
  contextGate = null;
  await act(async () => {
    gate?.();
  });
}

function sentRequests(): AgentUserMessageRequest[] {
  return vi.mocked(sendAgentUserMessage).mock.calls.map(([request]) => request);
}

function acknowledgeFlush(event: Event) {
  const detail = (event as CustomEvent<{ filePath: string }>).detail;
  window.dispatchEvent(
    new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, {
      detail: { filePath: detail.filePath, status: 'ok' },
    }),
  );
}

beforeEach(() => {
  harnessProps = { project: PROJECT, initialSession: 7, currentFile: null };
  changeSession = null;
  contextGate = null;
  vi.mocked(sendAgentUserMessage).mockImplementation(() => new Promise(() => undefined));
  vi.mocked(buildContextBundle).mockImplementation(
    () =>
      new Promise<ContextBundle>((resolve) => {
        contextGate = () => resolve(contextBundle());
      }),
  );
  vi.spyOn(TauriFileSystem, 'readProjectFile').mockResolvedValue('正文A');
  window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, acknowledgeFlush);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) {
    const active = root;
    root = undefined;
    await act(async () => active.unmount());
  }
  host.remove();
  window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, acknowledgeFlush);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('准备期切会话：不发出「A 的资料 + B 的会话」请求', async () => {
  await render({ currentFile: null });
  await startRun();
  expect(contextGate).not.toBeNull();

  await act(async () => changeSession!(8));
  await releaseContext();

  // 修复前：POST 的 assistantSessionId=8 而 args 仍是会话 7 起跑时的项目资料。
  expect(sentRequests()).toHaveLength(0);
});

it('准备期切项目：撤权，不再发出', async () => {
  await render({ currentFile: null });
  await startRun();

  await render({ project: OTHER_PROJECT });
  await releaseContext();

  expect(sentRequests()).toHaveLength(0);
});

it('准备期只换目标文件：请求仍锚定起跑时冻结的目标，不混入新打开的文件', async () => {
  await render({ currentFile: FILE });
  await startRun();
  expect(contextGate).not.toBeNull();

  await render({ currentFile: OTHER_FILE });
  await releaseContext();

  const requests = sentRequests();
  expect(requests).toHaveLength(1);
  expect(requests[0].assistantSessionId).toBe(7);
  expect(requests[0].args?.assistant_session_id).toBe(7);
  expect(requests[0].args?.project_path).toBe(PROJECT);
  expect(requests[0].args?.current_file).toBe(FILE);
  expect(requests[0].args?.content).toBe('正文A');
  expect(JSON.stringify(requests[0].args?.context_bundle)).not.toContain(OTHER_FILE);
});

it('准备期卸载：不再发出', async () => {
  await render({ currentFile: null });
  await startRun();

  const active = root!;
  root = undefined;
  await act(async () => active.unmount());
  await releaseContext();

  expect(sentRequests()).toHaveLength(0);
});

it('切走又切回：不因身份值相同而误判回同一任务', async () => {
  await render({ currentFile: null });
  await startRun();

  await act(async () => changeSession!(8));
  await act(async () => changeSession!(7));
  await releaseContext();

  expect(sentRequests()).toHaveLength(0);
});

it('准备期切会话：撤权同时释放 claim 与 agentBusy，新会话可立刻发起新一轮', async () => {
  await render({ currentFile: null });
  await startRun();
  expect(contextGate).not.toBeNull();

  await act(async () => changeSession!(8));
  await releaseContext();

  // ① 旧 run 的请求不发。
  expect(sentRequests()).toHaveLength(0);
  // ② agentBusy 归位：否则新会话 composer 永远 busy。
  expect(api.state.agentBusy).toBe(false);
  // ③ 新会话里能立刻发起新一轮，不被残留 claim / busy 拦下。
  await startRun();
  await releaseContext();
  const requests = sentRequests();
  expect(requests).toHaveLength(1);
  expect(requests[0].assistantSessionId).toBe(8);
});

it('同一 React 批内切会话 + 释放 gate：同步观测到撤权，不发旧会话请求', async () => {
  await render({ currentFile: null });
  await startRun();
  const gate = contextGate;
  contextGate = null;

  // 切换与释放放进同一个 act（中间只让出一拍微任务，不给切换单独 act）：
  // 归属判据必须在提交期同步前进，否则同一批内切走后释放准备期 await 仍会发出旧会话请求。
  await act(async () => {
    changeSession!(8);
    await Promise.resolve();
    gate?.();
  });

  expect(sentRequests()).toHaveLength(0);
});

it('正常对照：不切换时请求体与现状逐字段一致', async () => {
  await render({ currentFile: null });
  await startRun();
  await releaseContext();

  const requests = sentRequests();
  expect(requests).toHaveLength(1);
  expect(requests[0].sessionId).toBe(requests[0].runId);
  expect(requests[0].stream).toBe(true);
  expect(requests[0].assistantSessionId).toBe(7);
  expect(requests[0].userMessage).toBe(RUN_GOAL);
  expect(requests[0].args?.assistant_session_id).toBe(7);
  expect(requests[0].args?.project_path).toBe(PROJECT);
  expect(requests[0].args?.project_name).toBe('wu-gang');
  expect(requests[0].args?.instruction).toBe(RUN_GOAL);
});
