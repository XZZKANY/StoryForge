/**
 * 拒绝 = 带意图的通道：护栏打在接线上。
 *
 * 改动前 `rejectPendingSuggestion` 只做两件事——清面板、弹一条 toast。后端零感知，
 * run 的 approval 步永远停在 waiting，作者「哪儿不对」的判断一个字都没留下。它还是
 * 全仓唯一没有行为测试的分支，改之前谁也证伪不了它做了什么。
 *
 * 这里钉死三件事：
 * ①拒绝广播出去的事件带得动作者的方向与补丁 id；
 * ②拒绝这条路径**一个字节都不写盘**（不快照、不写文件、不回调标 done）；
 * ③方向非空才转成一次真实的作者发言发出去——空方向不许烧新一轮 BYO-key。
 *
 * 加第④条（第12条功能）：待确认补丁时对话区 RunActionBar 能就地接受/拒绝，
 * 不必切到编辑器。
 */
import assert from 'node:assert/strict';
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: string[] = [];

vi.mock('../../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    writeFile: async () => {
      calls.push('write');
    },
    deletePath: async () => {
      calls.push('delete');
    },
  },
}));

vi.mock('../../src/lib/versions', () => ({
  snapshotBeforeWrite: async () => {
    calls.push('snapshot');
    return { path: '/snapshot.md', timestamp: 1, created: false };
  },
}));

vi.mock('../../src/lib/api/ide-commands', () => ({
  executeIdeCommand: async (commandId: string) => {
    calls.push(`command:${commandId}`);
    return { payload: {} };
  },
}));

import {
  PATCH_REJECTED_EVENT,
  emitFileSuggestion,
  type PatchRejection,
} from '../../src/lib/assistant-events';
import { buildRejectionPrompt } from '../../src/components/chat-window/conversation-utils';
import { conversationKey } from '../../src/components/chat-window/session-guard';
import { useSuggestionWriteback } from '../../src/components/editor/useSuggestionWriteback';
import { useAgentRunControls } from '../../src/components/chat-window/useAgentRunControls';
import { useChatSubmission } from '../../src/components/chat-window/useChatSubmission';
import type { AgentRunControlHandlers } from '../../src/components/chat-window/types';

const PROJECT = 'D:/连载/末世吞噬';
const FILE = 'D:/连载/末世吞噬/正文/第03章.md';
const BEFORE = '旧的一章。';
const AFTER = '新的一章。';

const rejections: PatchRejection[] = [];
function onRejected(event: Event) {
  rejections.push((event as CustomEvent<PatchRejection>).detail);
}

let reject: (direction?: string) => void = () => undefined;
let panelHasPatch = false;

function WritebackHarness() {
  const editorRef = useRef({ getValue: () => BEFORE, getModel: () => null } as never);
  const originalContentRef = useRef(BEFORE);
  const cleanVersionIdRef = useRef<number | null>(null);
  const filePathRef = useRef<string | null>(FILE);
  const projectPathRef = useRef<string | null>(PROJECT);
  const modelCacheRef = useRef(new Map());

  const { pendingSuggestion, rejectPendingSuggestion } = useSuggestionWriteback({
    editorRef,
    originalContentRef,
    cleanVersionIdRef,
    filePathRef,
    projectPathRef,
    modelCacheRef: modelCacheRef as never,
    setLoadedContentPreview: () => undefined,
    setIsDirty: () => undefined,
    normalizeEol: (text: string) => text.replace(/\r\n/g, '\n'),
    getActiveBranchSnapshot: () => ({ id: 'main', label: '主线', headNodeId: null }) as never,
    advanceBranchHead: async () => {
      calls.push('branch');
    },
    recordRevisionLoop: async () => {
      calls.push('record');
      return { recordPath: '/loop.md' } as never;
    },
    emitAuthorLoopResult: () => undefined,
    dropOpenFilePath: () => undefined,
    onRequestVersionHistory: () => undefined,
  });

  reject = rejectPendingSuggestion;
  panelHasPatch = pendingSuggestion !== null;
  return null;
}

const submitted: string[] = [];

function SubmissionHarness() {
  const projectPathRef = useRef<string | null>(PROJECT);
  const assistantSessionIdRef = useRef<number | null>(7);
  const draftNonceRef = useRef<number>(0);

  useChatSubmission(
    {
      agentBusy: false,
      setAgentBusy: () => undefined,
      setMessages: () => undefined,
      projectPathRef,
      assistantSessionIdRef,
      draftNonceRef,
      input: '',
      setInput: () => undefined,
      messages: [],
      setConversationTitle: () => undefined,
      contextCandidates: [],
    } as never,
    (async (instruction: string) => {
      submitted.push(instruction);
    }) as never,
    { projectPath: PROJECT, pendingInitialPrompt: null, onPendingInitialPromptConsumed: undefined },
  );
  return null;
}

const stepPatches: Array<{ stepId: string; patch: Record<string, unknown> }> = [];
const runStatuses: string[] = [];
/** 让会话守卫「认为」这个 run 属于当前会话；测越界场景时改掉它。 */
let runStartKey: string | null = null;
let controlPatchId = 'file-revision-abc123';
let runControls: AgentRunControlHandlers | null = null;

function ControlsHarness() {
  const agentRunIdRef = useRef<string | null>('run-1');
  const assistantSessionIdRef = useRef<number | null>(7);
  const draftNonceRef = useRef<number>(0);
  const projectPathRef = useRef<string | null>(PROJECT);
  const runStartConversationKeyRef = useRef<string | null>(runStartKey);
  runStartConversationKeyRef.current = runStartKey;

  const controls = useAgentRunControls(
    {
      retryRequest: null,
      agentBusy: false,
      setMessages: () => undefined,
      agentRun: {
        id: 'run-1',
        sessionId: 'run-1',
        goal: '改稿',
        status: 'waiting',
        steps: [
          {
            id: 'approval',
            title: '等待作者确认',
            tool: 'author.approval',
            status: 'waiting',
            detail: '等待作者确认补丁',
            filePath: FILE,
            patchId: controlPatchId,
          },
        ],
      },
      pendingRepairCommand: null,
      setPendingRepairCommand: () => undefined,
      agentRunIdRef,
      assistantSessionIdRef,
      draftNonceRef,
      runStartConversationKeyRef,
      projectPathRef,
    } as never,
    (async () => undefined) as never,
    () => undefined,
    {
      updateAgentStep: (stepId: string, patch: Record<string, unknown>) => {
        stepPatches.push({ stepId, patch });
      },
      updateAgentStatus: (status: string) => {
        runStatuses.push(status);
      },
      refreshAgentRunRecovery: async () => undefined,
      applyResumedAgentResult: () => undefined,
      applyResumeDiagnostic: () => undefined,
    } as never,
  );
  runControls = controls.agentRunControls;
  return null;
}

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-revision-abc123',
    filePath: FILE,
    title: 'AI 修订',
    summary: '改了第三章',
    before: BEFORE,
    after: AFTER,
    note: '用户意图：改稿',
    createdAt: 1,
    requiresConfirmation: true,
    ...overrides,
  } as never;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  calls.length = 0;
  rejections.length = 0;
  submitted.length = 0;
  stepPatches.length = 0;
  runStatuses.length = 0;
  panelHasPatch = false;
  runStartKey = conversationKey(PROJECT, 7, 0);
  controlPatchId = 'file-revision-abc123';
  runControls = null;
  window.addEventListener(PATCH_REJECTED_EVENT, onRejected);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <>
        <WritebackHarness />
        <SubmissionHarness />
        <ControlsHarness />
      </>,
    );
  });
});

afterEach(() => {
  window.removeEventListener(PATCH_REJECTED_EVENT, onRejected);
  act(() => {
    root.unmount();
  });
  container.remove();
});

test('否掉一版时，作者的方向连同补丁 id 一起广播出去', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });
  assert.equal(panelHasPatch, true, '补丁没进面板，后面的断言证明不了任何事');

  await act(async () => {
    reject('这段对话太生硬，把玄铁令的来历留到后面再抖');
  });

  assert.equal(rejections.length, 1);
  assert.deepEqual(rejections[0], {
    filePath: FILE,
    patchId: 'file-revision-abc123',
    direction: '这段对话太生硬，把玄铁令的来历留到后面再抖',
  });
  assert.equal(panelHasPatch, false, '否掉之后面板还留着补丁');
});

test('拒绝这条路径一个字节都不写盘', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });
  await act(async () => {
    reject('重写一版');
  });

  assert.deepEqual(calls, [], `拒绝不该触碰磁盘或后端，实际调用：${calls.join(' | ') || '(无)'}`);
});

test('对话区拒绝由编辑器处理并清掉同一 patchId 的待确认补丁', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });
  assert.equal(panelHasPatch, true);

  await act(async () => {
    runControls?.onRejectPatch?.('把玄铁令的来历留到后面');
  });

  assert.equal(panelHasPatch, false, '对话区拒绝后编辑器仍保留旧补丁');
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0].patchId, 'file-revision-abc123');
});

test('对话区接受不会误写 patchId 不匹配的编辑器补丁', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });
  controlPatchId = 'another-patch';
  await act(async () => {
    root.render(
      <>
        <WritebackHarness />
        <SubmissionHarness />
        <ControlsHarness />
      </>,
    );
  });

  await act(async () => {
    runControls?.onAcceptPatch?.();
  });

  assert.equal(panelHasPatch, true, '错误 patchId 不应清掉编辑器补丁');
  assert.deepEqual(calls, [], '错误 patchId 不应触发快照、写盘或记录');
});

test('对话区接受把同一 patchId 交给既有 guarded writeback', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });

  await act(async () => {
    runControls?.onAcceptPatch?.();
  });

  assert.equal(panelHasPatch, false, '接受后编辑器仍保留已写回补丁');
  assert.deepEqual(calls.slice(0, 4), ['snapshot', 'branch', 'write', 'record']);
});

test('方向非空才转成一次真实的作者发言；留空只否掉、不烧新一轮', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });
  await act(async () => {
    reject('   ');
  });

  assert.deepEqual(submitted, [], '空方向不该发起新一轮模型调用');
  assert.equal(rejections.length, 1, '空方向仍要广播——流程树那一步得靠它收尾');
  assert.equal(rejections[0].direction, '');

  await act(async () => {
    emitFileSuggestion(suggestion({ id: 'file-revision-def456' }));
  });
  await act(async () => {
    reject('节奏太赶，第三章先别揭底');
  });

  assert.equal(submitted.length, 1, '给了方向却没发起新一轮');
  assert.match(submitted[0], /第03章\.md/, '发出的话里没有被否文件的锚点');
  assert.match(submitted[0], /节奏太赶，第三章先别揭底/, '作者的原话没带上');
});

test('buildRejectionPrompt：只给锚点与作者原话，不塞正文', () => {
  const prompt = buildRejectionPrompt({
    filePath: 'D:\\连载\\末世吞噬\\正文\\第12章.md',
    patchId: 'file-revision-x',
    direction: '把结尾的独白删掉',
  });

  assert.match(prompt, /第12章\.md/, 'Windows 反斜杠路径没取到文件名');
  assert.match(prompt, /把结尾的独白删掉$/);
  assert.ok(prompt.length < 60, `拼出来的话不该长到挤占历史窗口：${prompt}`);
});

test('buildRejectionPrompt：没给方向时只留否决本身', () => {
  const prompt = buildRejectionPrompt({
    filePath: 'D:/连载/末世吞噬/正文/第12章.md',
    patchId: 'file-revision-x',
    direction: '  ',
  });

  assert.equal(prompt, '刚才那版对《第12章.md》的修订我没要。');
});

/**
 * 改动前，作者否掉一版后 run 会永远停在 approval: waiting——既不 completed 也不 failed，
 * 流程树上那一步一直转着，作者只能靠关掉面板假装它结束了。
 */
test('否掉之后，那个永远挂 waiting 的确认步会收尾', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });
  await act(async () => {
    reject('换个开头');
  });

  const approval = stepPatches.filter((item) => item.stepId === 'approval');
  assert.equal(approval.length, 1, `确认步没有被收尾：${JSON.stringify(stepPatches)}`);
  // 这一步叫「等待作者确认」——作者答复了它就完成了，哪怕答复是「不要」。
  assert.equal(approval[0].patch.status, 'completed');
  assert.match(String(approval[0].patch.detail), /否掉/);
  assert.deepEqual(runStatuses, ['completed']);
});

test('切走会话后否掉旧补丁，不污染当前会话的流程树', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });
  // run 起跑于另一个会话：纯 runId 守卫看不出区别，会话键才看得出。
  runStartKey = conversationKey(PROJECT, 99, 0);
  await act(async () => {
    root.render(
      <>
        <WritebackHarness />
        <SubmissionHarness />
        <ControlsHarness />
      </>,
    );
  });

  await act(async () => {
    reject('换个开头');
  });

  assert.deepEqual(
    stepPatches,
    [],
    `旧会话的拒绝写进了当前会话的流程树：${JSON.stringify(stepPatches)}`,
  );
});
