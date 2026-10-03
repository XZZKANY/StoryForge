import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatWindowView } from '../src/components/chat-window/ChatWindowView';
import {
  projectOverviewActivity,
  overviewActivityLabel,
} from '../src/components/chat-window/overview-activity';
import { useChatSubmission } from '../src/components/chat-window/useChatSubmission';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useRunAuthorAgent } from '../src/components/chat-window/useRunAuthorAgent';
import { useAgentRunRecovery } from '../src/components/chat-window/useAgentRunRecovery';
import { useAgentRunControls } from '../src/components/chat-window/useAgentRunControls';
import {
  APPLY_FILE_SUGGESTION_EVENT,
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
} from '../src/lib/assistant-events';
import { useAgentStreamEvent } from '../src/components/chat-window/useAgentStreamEvent';

vi.mock('../src/lib/api/config', () => ({
  getApiConfig: async () => ({ baseUrl: 'http://agent.test', apiKey: 'fixture-key' }),
  trimApiBaseUrl: (url: string) => url,
}));
vi.mock('../src/lib/project-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/project-context')>()),
  buildContextBundle: vi.fn(async () => ({
    projectRoot: 'D:/synthetic-book',
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
  })),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const noop = () => undefined;
const acknowledgeSyntheticEditor = (event: Event) => {
  const filePath = (event as CustomEvent<{ filePath: string }>).detail.filePath;
  if (!['D:/synthetic-book/01.md', 'D:/synthetic-book/02.md'].includes(filePath))
    throw new Error('Unexpected synthetic flush');
  window.dispatchEvent(
    new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, { detail: { filePath, status: 'ok' } }),
  );
};
let root: Root;
let host: HTMLDivElement;
let events: Record<string, unknown>[];
let activeRun = '';
let transport: 'lost' | 'rejected' | 'hanging' | 'streaming' = 'lost';
let textController: ReadableStreamDefaultController<Uint8Array>;
let readEvents: (() => Promise<Response>) | undefined;
let sendControl: ((body: Record<string, unknown>) => Promise<Response>) | undefined;
let projectionStatus = 'running';
let projectionDetails: Record<string, unknown> = {};
const consumedPrompt = vi.fn();
let lateStream: ((value: Response) => void) | undefined;
const fetchMock = vi.fn<typeof fetch>();
let current: {
  state: ReturnType<typeof useChatWindowState>;
  run: ReturnType<typeof useRunAuthorAgent>;
  controls: ReturnType<typeof useAgentRunControls>;
  changeSession: (session: number | null) => void;
  submission: ReturnType<typeof useChatSubmission>;
};
function Harness({
  project = 'D:/synthetic-book',
  initialSession = 7,
  pendingInitialPrompt,
}: {
  project?: string;
  initialSession?: number | null;
  pendingInitialPrompt?: string | null;
}) {
  const [session, setSession] = useState(initialSession);
  const state = useChatWindowState({
    projectPath: project,
    currentFile: null,
    assistantSessionId: session,
  });
  const recovery = useAgentRunRecovery(state, setSession);
  const onEvent = useAgentStreamEvent(state, recovery.refreshAgentRunRecovery);
  const run = useRunAuthorAgent(
    state,
    onEvent,
    recovery.updateAgentStatus,
    recovery.refreshAgentRunRecovery,
    setSession,
    'ask',
  );
  const controls = useAgentRunControls(state, run, onEvent, recovery);
  const submission = useChatSubmission(state, run, {
    projectPath: project,
    assistantSessionId: session,
    pendingInitialPrompt,
    onPendingInitialPromptConsumed: consumedPrompt,
  });
  current = { state, run, controls, changeSession: setSession, submission };
  return (
    <ChatWindowView
      state={state}
      projectPath={project}
      assistantSessionId={session}
      layoutMode="balanced"
      onSetLayoutMode={noop}
      onOpenObservatory={noop}
      observatoryAttention={false}
      agentPermissionProfile="ask"
      onAgentPermissionProfileChange={noop}
      handleSelectSession={setSession}
      handleNewSession={noop}
      retryAssistantSessionLoad={noop}
      retryContextCandidates={noop}
      addExplicitContext={noop}
      togglePinnedContext={noop}
      handleSubmit={submission.handleSubmit}
      handleComposerSubmit={submission.handleComposerSubmit}
      userMessageHistory={submission.userMessageHistory}
      queuedMessages={submission.queuedMessages}
      onRemoveQueuedMessage={submission.removeQueuedMessage}
      conversationScope={submission.conversationScope}
      retryLastFailedRun={controls.retryLastFailedRun}
      retryWritingRunSubscription={controls.retryWritingRunSubscription}
      agentRunControls={controls.agentRunControls}
    />
  );
}
async function mount(initialSession: number | null = 7) {
  await act(async () => root.render(<Harness initialSession={initialSession} />));
}
async function startAndExhaustObservation() {
  await act(async () => {
    void current.run('检查这段设定', 'agent');
  });
  await act(async () => vi.advanceTimersByTimeAsync(300_000));
}
function button(testid: string) {
  const value = host.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`);
  expect(value, testid).not.toBeNull();
  return value!;
}
function posts() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
}
beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  activeRun = '';
  transport = 'lost';
  readEvents = undefined;
  sendControl = undefined;
  projectionStatus = 'running';
  projectionDetails = {};
  consumedPrompt.mockClear();
  lateStream = undefined;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST' && url === 'http://agent.test/api/ide/review/cross-chapter')
      return Response.json({ findings: [], model: 'synthetic' });
    if (init?.method === 'POST' && url.endsWith('/stream')) {
      const body = JSON.parse(String(init.body));
      activeRun = body.run_id;
      if (transport === 'rejected')
        return Response.json({ detail: 'unauthorized' }, { status: 401 });
      if (transport === 'streaming')
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              textController = controller;
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      if (transport === 'hanging')
        return new Promise<Response>((resolve) => {
          lateStream = resolve;
        });
      throw new TypeError('response lost after dispatch');
    }
    if (init?.method === 'GET' && url === `http://agent.test/api/agent-runs/${activeRun}/events`)
      return readEvents ? readEvents() : Response.json(events);
    if (
      init?.method === 'GET' &&
      url === `http://agent.test/api/agent-runs/${activeRun}/save-points`
    )
      return Response.json({
        run_id: activeRun,
        status: projectionStatus,
        current_step: 'model',
        pending: {},
        recoverability: {},
        runtime_recovery: {},
        save_points: [],
        ...projectionDetails,
      });
    if (
      init?.method === 'POST' &&
      url === `http://agent.test/api/ide/agent/sessions/${activeRun}/control`
    ) {
      const body = JSON.parse(String(init.body));
      return sendControl
        ? sendControl(body)
        : Response.json({
            type: body.type,
            run_id: activeRun,
            session_id: activeRun,
            event_id: 11,
            status: 'recorded',
            control_effect: 'requested',
            runtime_state: 'in_flight',
            run_status: 'running',
          });
    }
    throw new Error(`Unexpected synthetic request: ${init?.method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, acknowledgeSyntheticEditor);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, acknowledgeSyntheticEditor);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('real transport exhaustion cannot offer a second POST instead of same-run reconciliation', async () => {
  await mount();
  await startAndExhaustObservation();
  const retry = [...host.querySelectorAll('button')].find(
    (value) => value.textContent === '重试本轮',
  );
  await act(async () => retry?.click());
  expect(posts()).toHaveLength(1);
  expect(host.textContent).toContain('结果未知');
  expect(current.state.agentBusy).toBe(false);
  button('run-reconcile');
});

function complete(summary = '核对取回本轮结果', assistantSessionId = 7) {
  return [
    {
      sequence: 12,
      event_type: 'agent_run_completed',
      payload: {
        assistant_session_id: assistantSessionId,
        summary,
        requires_user_confirmation: false,
      },
    },
  ];
}
async function clickReconcile() {
  await act(async () => button('run-reconcile').click());
}
function retryButton() {
  return [...host.querySelectorAll('button')].find((value) => value.textContent === '重试本轮');
}

it('unknown blocks ordinary send, keyboard submit, direct callbacks, and stale retry callbacks', async () => {
  await mount();
  const oldRun = current.run;
  const oldRetry = current.controls.retryLastFailedRun;
  await startAndExhaustObservation();
  await act(async () => current.state.setInput('继续同一个任务'));
  expect(button('composer-submit').disabled).toBe(false);
  await act(async () => {
    button('composer-submit').click();
    host
      .querySelector('textarea')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    void current.run('继续同一个任务', 'agent');
    void oldRun('继续同一个任务', 'agent');
    current.controls.retryLastFailedRun();
    oldRetry();
  });
  expect(posts()).toHaveLength(1);
  expect(retryButton()).toBeUndefined();
});

it('same-frame repeated initial invocations dispatch only one user request', async () => {
  await mount();
  const run = current.run;
  await act(async () => {
    void run('检查', 'agent');
    void run('检查', 'agent');
  });
  expect(posts()).toHaveLength(1);
});

it('same-run GET terminal delivers once and allows a genuinely new user request afterwards', async () => {
  await mount();
  await startAndExhaustObservation();
  const originalRun = activeRun;
  events = complete();
  projectionStatus = 'completed';
  const reconcile = button('run-reconcile');
  await act(async () => {
    reconcile.click();
    reconcile.click();
  });
  expect(current.state.agentRun?.id).toBe(originalRun);
  expect(current.state.agentRun?.status).toBe('completed');
  expect(
    current.state.messages.filter((message) => message.content === '核对取回本轮结果'),
  ).toHaveLength(1);
  expect(posts()).toHaveLength(1);
  expect(host.querySelector('[data-testid="run-reconcile"]')).toBeNull();
  await act(async () => {
    void current.run('真正的下一轮', 'agent');
  });
  expect(posts()).toHaveLength(2);
  expect(activeRun).not.toBe(originalRun);
});

it('a recovered patch is delivered once through the existing proposal boundary, never written here', async () => {
  await mount();
  await startAndExhaustObservation();
  const delivered = vi.fn();
  window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, delivered);
  try {
    events = [
      {
        sequence: 12,
        event_type: 'permission_required',
        payload: {
          assistant_session_id: 7,
          summary: '待确认补丁',
          requires_user_confirmation: true,
          proposed_patch: {
            id: 'synthetic-patch',
            kind: 'file_revision',
            file_path: 'chapter.md',
            before: '旧稿',
            after: '新稿',
            requires_confirmation: true,
          },
        },
      },
    ];
    const reconcile = button('run-reconcile');
    await act(async () => {
      reconcile.click();
      reconcile.click();
    });
    expect(delivered).toHaveBeenCalledOnce();
    expect(current.state.agentRun?.status).toBe('waiting');
    expect(posts()).toHaveLength(1);
  } finally {
    window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, delivered);
  }
});

it('explicit HTTP rejection remains a real failure, with an explicit new-run retry', async () => {
  await mount();
  transport = 'rejected';
  await act(async () => current.run('检查', 'agent'));
  expect(current.state.agentRun?.status).toBe('failed');
  expect(current.state.agentRun?.deliveryUnknown).toBeUndefined();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(0);
  const originalRun = activeRun;
  const retry = retryButton();
  expect(retry).toBeDefined();
  await act(async () => {
    retry!.click();
    retry!.click();
  });
  expect(posts()).toHaveLength(2);
  expect(activeRun).not.toBe(originalRun);
});

it('a real failed event permits retry even if its savepoint read is an older paused projection', async () => {
  await mount();
  await startAndExhaustObservation();
  events = [{ sequence: 12, event_type: 'agent_run_failed', message: 'provider 拒绝了请求' }];
  projectionStatus = 'paused';
  await clickReconcile();
  expect(current.state.agentRun?.status).toBe('failed');
  expect(current.state.agentRun?.deliveryUnknown).toBeUndefined();
  const retry = retryButton();
  expect(retry).toBeDefined();
  await act(async () => retry!.click());
  expect(posts()).toHaveLength(2);
});

it('savepoint status alone and a permission terminal shadowed by execution_started cannot settle unknown', async () => {
  await mount();
  await startAndExhaustObservation();
  projectionStatus = 'failed';
  events = [
    { sequence: 3, event_type: 'permission_required', payload: { assistant_session_id: 7 } },
    { sequence: 4, event_type: 'agent_execution_started' },
  ];
  await clickReconcile();
  expect(current.state.agentRun?.deliveryUnknown).toBeDefined();
  expect(current.state.agentRun?.status).not.toBe('failed');
  expect(current.state.agentBusy).toBe(false);
  expect(retryButton()).toBeUndefined();
  expect(posts()).toHaveLength(1);
  button('run-reconcile');
});

it.each(['reject', 'hang'] as const)(
  'GET %s releases observation and permits a later GET, not another POST',
  async (failure) => {
    await mount();
    await startAndExhaustObservation();
    readEvents =
      failure === 'hang'
        ? () => new Promise(() => undefined)
        : async () => {
            throw new TypeError('offline');
          };
    await clickReconcile();
    if (failure === 'hang') await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(host.textContent).toContain('核对本轮失败');
    expect(current.state.agentBusy).toBe(false);
    readEvents = undefined;
    events = complete();
    await clickReconcile();
    expect(current.state.agentRun?.status).toBe('completed');
    expect(posts()).toHaveLength(1);
  },
);

it('a new draft adopts the assistant session only from its original bound run result', async () => {
  await mount(null);
  await startAndExhaustObservation();
  events = complete('新草稿结果', 91);
  await clickReconcile();
  expect(current.state.assistantSessionIdRef.current).toBe(91);
  expect(current.state.selfPersistedSessionIdRef.current).toBe(91);
  expect(current.state.agentRun?.status).toBe('completed');
  expect(current.state.messages.filter((message) => message.content === '新草稿结果')).toHaveLength(
    1,
  );
  expect(posts()).toHaveLength(1);
});

it('an existing assistant session cannot receive a different session result', async () => {
  await mount();
  await startAndExhaustObservation();
  events = complete('错误会话结果', 91);
  await clickReconcile();
  expect(current.state.assistantSessionIdRef.current).toBe(7);
  expect(current.state.messages.some((message) => message.content === '错误会话结果')).toBe(false);
  expect(current.state.agentRun?.deliveryUnknown).toBeDefined();
});

it('late GET cannot cross a project A→B→A lifetime change', async () => {
  await mount();
  await startAndExhaustObservation();
  let resolve!: (response: Response) => void;
  readEvents = () =>
    new Promise((done) => {
      resolve = done;
    });
  await clickReconcile();
  await act(async () => root.render(<Harness project="D:/another-synthetic-book" />));
  await act(async () => root.render(<Harness />));
  await act(async () => resolve(Response.json(complete('过期结果'))));
  expect(current.state.messages.some((message) => message.content === '过期结果')).toBe(false);
  readEvents = undefined;
  events = complete('重新核对结果');
  await clickReconcile();
  expect(current.state.messages.some((message) => message.content === '重新核对结果')).toBe(true);
});

it('a hung SSE followed by exhausted observation ignores its late result after GET delivery', async () => {
  await mount();
  transport = 'hanging';
  await act(async () => {
    void current.run('检查', 'agent');
  });
  await act(async () => vi.advanceTimersByTimeAsync(660_000));
  expect(current.state.agentRun?.deliveryUnknown).toBeDefined();
  events = complete();
  await clickReconcile();
  const late = {
    type: 'agent_result',
    session_id: activeRun,
    run_id: activeRun,
    assistant_session_id: 7,
    plan: [],
    tool_trace: [],
    agent_result: { summary: '迟到流结果' },
  };
  await act(async () => lateStream?.(new Response(`data: ${JSON.stringify(late)}\n\n`)));
  expect(current.state.agentRun?.status).toBe('completed');
  expect(current.state.messages.some((message) => message.content === '迟到流结果')).toBe(false);
  expect(posts()).toHaveLength(1);
});

it.each(['pause_run', 'stop_run'] as const)(
  'unknown allows %s on the original run but recorded is not completion',
  async (type) => {
    await mount();
    await startAndExhaustObservation();
    await act(async () => {
      if (type === 'pause_run') button('run-pause').click();
      else button('run-stop').click();
    });
    if (type === 'stop_run') {
      expect(posts()).toHaveLength(1);
      await act(async () => button('run-stop').click());
    }
    const control = posts().at(-1)!;
    expect(String(control[0])).toContain(`/sessions/${activeRun}/control`);
    expect(JSON.parse(String(control[1]?.body))).toMatchObject({ type, run_id: activeRun });
    expect(current.state.agentRun?.deliveryUnknown).toBeDefined();
    expect(current.state.agentRun?.status).not.toBe('completed');
    expect(current.state.agentBusy).toBe(false);
    expect(retryButton()).toBeUndefined();
  },
);

it('a late settled control ACK cannot overwrite a result already delivered by GET', async () => {
  await mount();
  await startAndExhaustObservation();
  let resolve!: (response: Response) => void;
  sendControl = () =>
    new Promise((done) => {
      resolve = done;
    });
  await act(async () => button('run-pause').click());
  events = complete();
  await clickReconcile();
  await act(async () =>
    resolve(
      Response.json({
        type: 'pause_run',
        run_id: activeRun,
        session_id: activeRun,
        event_id: 13,
        status: 'recorded',
        control_effect: 'applied',
        runtime_state: 'settled',
        run_status: 'paused',
      }),
    ),
  );
  expect(current.state.agentRun?.status).toBe('completed');
  expect(
    current.state.messages.filter((message) => message.content === '核对取回本轮结果'),
  ).toHaveLength(1);
});

it('a hung poll GET still reaches unknown at the bounded observation deadline', async () => {
  await mount();
  readEvents = () => new Promise(() => undefined);
  await startAndExhaustObservation();
  expect(current.state.agentRun?.deliveryUnknown).toBeDefined();
  expect(current.state.agentBusy).toBe(false);
  const reads = fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET');
  expect(reads.length).toBeGreaterThan(1);
  expect(reads.every(([, init]) => init?.signal?.aborted)).toBe(true);
  readEvents = undefined;
  events = complete();
  await clickReconcile();
  expect(current.state.agentRun?.status).toBe('completed');
  expect(posts()).toHaveLength(1);
});

it('a late GET cannot deliver into a different assistant session', async () => {
  await mount();
  await startAndExhaustObservation();
  let resolve!: (response: Response) => void;
  readEvents = () =>
    new Promise((done) => {
      resolve = done;
    });
  await clickReconcile();
  await act(async () => current.changeSession(8));
  await act(async () => resolve(Response.json(complete('旧会话结果'))));
  expect(current.state.assistantSessionIdRef.current).toBe(8);
  expect(current.state.messages.some((message) => message.content === '旧会话结果')).toBe(false);
  expect(posts()).toHaveLength(1);
});

it('a late initial transport failure does not overwrite state after project A→B→A', async () => {
  await mount();
  await act(async () => {
    void current.run('检查', 'agent');
  });
  await act(async () => root.render(<Harness project="D:/another-synthetic-book" />));
  await act(async () => root.render(<Harness />));
  const before = current.state.messages;
  await act(async () => vi.advanceTimersByTimeAsync(300_000));
  expect(current.state.messages).toEqual(before);
  expect(current.state.agentRun?.deliveryUnknown).toBeUndefined();
  expect(posts()).toHaveLength(1);
});

async function prepareCrossChapterCandidates() {
  vi.spyOn(TauriFileSystem, 'readProjectFile').mockImplementation(async (project, path) => {
    if (
      project !== 'D:/synthetic-book' ||
      !['D:/synthetic-book/01.md', 'D:/synthetic-book/02.md'].includes(path)
    )
      throw new Error('Unexpected synthetic file read');
    return '合成章节';
  });
  await act(async () =>
    current.state.setContextCandidates(
      [1, 2].map((ordinal) => ({
        name: `0${ordinal}.md`,
        path: `D:/synthetic-book/0${ordinal}.md`,
        relativePath: `0${ordinal}.md`,
        kind: 'draft',
        modified: 0,
        size: 10,
      })),
    ),
  );
}
async function submitComposer(value: string) {
  await act(async () => current.state.setInput(value));
  await act(async () => button('composer-submit').click());
}

it.each(['检查第1章和第2章是否一致', '普通待发指令'])(
  'real submission retains queued %s through transport unknown, then dispatches once after terminal',
  async (instruction) => {
    await mount();
    await prepareCrossChapterCandidates();
    await submitComposer('检查这段设定');
    await submitComposer(instruction);
    expect(current.submission.queuedMessages).toHaveLength(1);
    await act(async () => current.state.setInput('作者后续草稿'));
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(posts()).toHaveLength(1);
    expect(current.submission.queuedMessages).toHaveLength(1);
    expect(current.state.input).toBe('作者后续草稿');
    expect(TauriFileSystem.readProjectFile).not.toHaveBeenCalled();
    events = complete();
    await clickReconcile();
    expect(posts()).toHaveLength(2);
    expect(String(posts()[1][0])).toBe(
      instruction === '普通待发指令'
        ? `http://agent.test/api/ide/agent/sessions/${activeRun}/stream`
        : 'http://agent.test/api/ide/review/cross-chapter',
    );
    expect(current.submission.queuedMessages).toHaveLength(0);
    expect(current.state.input).toBe('作者后续草稿');
  },
);

it('unknown blocks direct cross-chapter submission before consuming input or touching project files', async () => {
  await mount();
  await prepareCrossChapterCandidates();
  const staleSubmit = current.submission.handleComposerSubmit;
  await startAndExhaustObservation();
  await act(async () => current.state.setInput('作者草稿'));
  await act(async () => current.submission.handleComposerSubmit('检查第1章和第2章是否一致'));
  await act(async () => staleSubmit('检查第1章和第2章是否一致'));
  expect(posts()).toHaveLength(1);
  expect(TauriFileSystem.readProjectFile).not.toHaveBeenCalled();
  expect(current.state.input).toContain('作者草稿');
  expect(current.state.input).toContain('检查第1章和第2章是否一致');
});

it('pendingInitialPrompt is not consumed and overview does not claim running or retryable while unknown', async () => {
  await mount();
  await startAndExhaustObservation();
  await act(async () => root.render(<Harness pendingInitialPrompt="继续原任务" />));
  expect(consumedPrompt).not.toHaveBeenCalled();
  expect(posts()).toHaveLength(1);
  const overview = projectOverviewActivity({
    projectPath: 'D:/synthetic-book',
    assistantSessionId: 7,
    agentRun: current.state.agentRun,
    chapterBrief: null,
    agentBusy: false,
    sessionLoadError: null,
    retryableFailure: true,
  });
  expect(overview?.message).toContain('结果未知');
  expect(overview?.retryable).toBe(false);
  expect(overviewActivityLabel(overview!.status)).not.toBe('Agent 正在工作');
});

it('an actual paused checkpoint result removes delivery uncertainty but only offers same-run resume', async () => {
  await mount();
  await startAndExhaustObservation();
  const result = {
    type: 'agent_result',
    session_id: activeRun,
    run_id: activeRun,
    assistant_session_id: 7,
    intent: 'chat.explain',
    user_message: '检查',
    plan: [],
    tool_trace: [],
    proposed_patch: null,
    agent_result: {
      summary: '执行已在安全边界暂停',
      requires_user_confirmation: false,
      runtime_interrupted: true,
    },
    runtime_interruption: { status: 'paused', boundary: 'after_model' },
    runtime_recovery: {
      reason: 'durable_checkpoint_ready',
      can_resume: true,
      resume_strategy: 'continue_checkpoint',
    },
  };
  events = [
    { sequence: 12, event_type: 'agent_run_interrupted', payload: { execution_result: result } },
  ];
  projectionStatus = 'paused';
  projectionDetails = {
    current_step: 'runtime.recovery',
    recoverability: { can_resume: true, resume_strategy: 'continue_checkpoint' },
    runtime_recovery: {
      checkpoint_resume: {
        kind: 'runtime_checkpoint_resume',
        can_resume: true,
        artifact_id: 9,
        reason: 'durable_checkpoint_ready',
        resume_strategy: 'continue_checkpoint',
        resume_via_control_channel: true,
      },
    },
  };
  const originalRun = activeRun;
  await clickReconcile();
  expect(current.state.agentRun?.deliveryUnknown).toBeUndefined();
  expect(current.state.agentRun?.status).toBe('paused');
  expect(retryButton()).toBeUndefined();
  expect(button('run-resume').disabled).toBe(false);
  await act(async () => button('run-resume').click());
  expect(posts()).toHaveLength(2);
  expect(JSON.parse(String(posts()[1][1]?.body))).toMatchObject({
    type: 'resume_run',
    run_id: originalRun,
  });
  expect(current.state.agentRun?.status).not.toBe('completed');
});

it('partial text survives real observation-budget exhaustion and same-run manual GET settlement', async () => {
  await mount();
  transport = 'streaming';
  await act(async () => {
    void current.run('检查这段设定', 'agent');
  });
  const frame = (type: string, sequence: number, text?: string) => ({
    type,
    session_id: activeRun,
    run_id: activeRun,
    stream_id: 'partial-stream',
    round_index: 1,
    chunk_sequence: sequence,
    ...(text ? { text_delta: text } : {}),
  });
  await act(async () => {
    for (const value of [
      frame('agent_text_stream_started', 0),
      frame('agent_text_delta', 1, '断线前的真实正文片段'),
    ])
      textController.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(value) + '\n\n'));
  });
  const node = host.querySelector('[data-testid="assistant-message"]');
  const id = current.state.messages.find((message) => message.stream)?.id;
  expect(node?.textContent).toContain('断线前的真实正文片段');
  await act(async () => textController.error(new TypeError('fixture disconnected')));
  await act(async () => vi.advanceTimersByTimeAsync(300_000));
  expect(current.state.agentRun?.deliveryUnknown).toBeDefined();
  expect(current.state.agentBusy).toBe(false);
  expect(host.contains(node)).toBe(true);
  expect(node?.textContent).toContain('等待核对');
  expect(node?.textContent).not.toContain('回复未完成');
  expect(posts()).toHaveLength(1);
  events = complete('核对后的权威正文');
  projectionStatus = 'completed';
  const reconcile = button('run-reconcile');
  await act(async () => {
    reconcile.click();
    reconcile.click();
  });
  expect(host.contains(node)).toBe(true);
  expect(node?.textContent).toContain('核对后的权威正文');
  expect(node?.textContent).not.toContain('断线前的真实正文片段');
  expect(current.state.messages.find((message) => message.id === id)?.stream?.phase).toBe(
    'complete',
  );
  expect(
    current.state.messages.filter((message) => message.content === '核对后的权威正文'),
  ).toHaveLength(1);
  expect(posts()).toHaveLength(1);
});
