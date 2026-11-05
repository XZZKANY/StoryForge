import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useChatSubmission } from '../src/components/chat-window/useChatSubmission';
import { useRevisionBatch } from '../src/components/chat-window/useRevisionBatch';
import { RevisionBatchPanel } from '../src/components/chat-window/RevisionBatchPanel';
import type { RunAuthorAgent, RunAuthorAgentOutcome } from '../src/components/chat-window/types';
import type { AgentPermissionProfile } from '../src/lib/agent-permission';
import { executeIdeCommand } from '../src/lib/api/ide-commands';
import { sendAgentControlMessage } from '../src/lib/api-client';
import { reportChapterWriteback } from '../src/lib/write-batch-writeback';
import { emitPatchRejected } from '../src/lib/assistant-events';
vi.mock('../src/lib/api/ide-commands', () => ({ executeIdeCommand: vi.fn() }));
vi.mock('../src/lib/api-client', async (original) => ({
  ...(await original<typeof import('../src/lib/api-client')>()),
  sendAgentControlMessage: vi.fn(async () => ({})),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const PROJECT = 'D:/revision-book';
let root: Root,
  host: HTMLDivElement,
  serial = 0;
let api: {
  state: ReturnType<typeof useChatWindowState>;
  scheduler: ReturnType<typeof useRevisionBatch>;
  submission: ReturnType<typeof useChatSubmission>;
};
const run = vi.fn<RunAuthorAgent>();
function Harness({
  project = PROJECT,
  session = 1,
  permission = 'ask',
}: {
  project?: string;
  session?: number;
  permission?: AgentPermissionProfile;
}) {
  const state = useChatWindowState({
    projectPath: project,
    currentFile: null,
    assistantSessionId: session,
  });
  const scheduler = useRevisionBatch({
    state,
    runAuthorAgent: run,
    projectPath: project,
    assistantSessionId: session,
    permissionProfile: permission,
  });
  const submission = useChatSubmission(
    state,
    run,
    { projectPath: project, assistantSessionId: session },
    { occupied: scheduler.occupied, cardOpen: scheduler.confirming, onRevision: scheduler.offer },
  );
  api = { state, scheduler, submission };
  return <RevisionBatchPanel scheduler={scheduler} permissionProfile={permission} />;
}
const chapters = [1, 2, 3].map((ordinal) => ({
  ordinal,
  relative_path: '正文/第00' + ordinal + '章.md',
  estimated_chars: 2500,
}));
async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(<Harness {...props} />));
}
async function open() {
  await act(async () => {
    await api.submission.handleComposerSubmit('连续修改第1-3章，把世界规则融入情节');
  });
  await vi.waitFor(() => expect(host.textContent).toContain('确认范围'));
}
async function start() {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="revision-batch-start"]')!.click(),
  );
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
}
async function save(call: number) {
  const result = (await run.mock.results[call].value) as Extract<
    RunAuthorAgentOutcome,
    { kind: 'settled' }
  >;
  await act(async () =>
    reportChapterWriteback(result.runId, {
      written: true,
      filePath: result.proposal!.filePath,
      snapshotVersion: 'snapshot',
      factsBefore: null,
      factsAdded: null,
      factDisputes: 0,
      factError: null,
    }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(executeIdeCommand).mockResolvedValue({ payload: { book_context: { chapters } } });
  run.mockImplementation(async (_goal, _action, _intent, _excluded, options) => {
    const id = 'revision-run-' + ++serial;
    api.state.agentRunIdRef.current = id;
    return {
      kind: 'settled',
      runId: id,
      proposal: {
        patchId: 'p-' + id,
        filePath: PROJECT + '/' + options!.revisionTargetFilePath,
        requiresConfirmation: true,
      },
    };
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test('range command opens a confirmation card, runs one chapter at a time and carries requirements', async () => {
  await render();
  await open();
  expect(run).not.toHaveBeenCalled();
  await start();
  await vi.waitFor(() => expect(host.textContent).toContain('等待第 1 章'));
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][2]).toBe('file.revise');
  expect(run.mock.calls[0][4]).toMatchObject({
    revisionTargetFilePath: '正文/第001章.md',
    revisionAbortSignal: expect.any(AbortSignal),
  });
  await save(0);
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  await save(1);
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
  await save(2);
  await vi.waitFor(() => expect(host.textContent).toContain('所选 3 章已逐章修改并保存'));
  expect(api.scheduler.occupied).toBe(false);
  for (const [goal] of run.mock.calls) expect(goal).toContain('把世界规则融入情节');
});

test('read-only never dispatches; missing chapters cannot start', async () => {
  await render({ permission: 'read' });
  await act(async () => {
    api.scheduler.offer('/改 1-3 要求');
  });
  expect(host.textContent).toContain('权限改为询问或自动');
  expect(run).not.toHaveBeenCalled();
  await render();
  vi.mocked(executeIdeCommand).mockResolvedValue({
    payload: { book_context: { chapters: chapters.slice(0, 2) } },
  });
  await act(async () => {
    api.scheduler.offer('/改 1-3 要求');
  });
  await vi.waitFor(() => expect(host.textContent).toContain('第 3 章不存在'));
  expect(run).not.toHaveBeenCalled();
});

test.each(['stop', 'reject', 'project', 'permission'])(
  '%s prevents the next chapter even when the save arrives late',
  async (mode) => {
    await render();
    await open();
    await start();
    await vi.waitFor(() => expect(api.scheduler.view?.phase).toBe('waiting'));
    if (mode === 'stop') await act(async () => api.scheduler.stop());
    if (mode === 'reject')
      await act(async () =>
        emitPatchRejected({
          runId: api.state.agentRunIdRef.current!,
          projectPath: PROJECT,
          filePath: PROJECT + '/正文/第001章.md',
          patchId: 'p',
          direction: '',
        }),
      );
    if (mode === 'project') await render({ project: 'D:/another' });
    if (mode === 'permission') await render({ permission: 'read' });
    await save(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(api.scheduler.occupied).toBe(false);
  },
);

test('stopping generation sends stop to the owned run and blocks new instructions', async () => {
  let finish!: (outcome: RunAuthorAgentOutcome) => void;
  run.mockImplementationOnce(() => {
    api.state.agentRunIdRef.current = 'in-flight';
    api.state.setAgentBusy(true);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await render();
  await open();
  await start();
  await act(async () => {
    await api.submission.handleComposerSubmit('修改别的文件');
  });
  expect(run).toHaveBeenCalledTimes(1);
  await act(async () => api.scheduler.stop());
  expect(sendAgentControlMessage).toHaveBeenCalledWith(
    expect.objectContaining({ runId: 'in-flight', type: 'stop_run' }),
  );
  await act(async () => finish({ kind: 'unsettled', runId: 'in-flight' }));
  expect(run).toHaveBeenCalledTimes(1);
});
