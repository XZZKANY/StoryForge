/**
 * 自动档写回红线：护栏打在接线上，不是只测纯函数。
 *
 * 本波把「补丁必须作者点接受」放宽成「自动档免点击」，放宽的只有那一层闸。这里钉死的是
 * 剩下没放宽的部分：谁能自动落盘、落盘前必须先存快照、快照失败必须阻断、派生缓存永不自动写；
 * 以及事后反悔那一侧——撤销一次「新建」要删文件而不是留个空文件，撤销失效也不能是死路。
 */
import assert from 'node:assert/strict';
import { createWritebackQueue } from '../../src/lib/writeback';
import type { DiskBaseline } from '../../src/lib/tauri-fs';
import type { WritebackRequest } from '../../src/lib/writeback-receipt-types';
import {
  createFixtureAudit,
  inspectFixtureReceipt,
  readFixtureAudit,
  writeFixtureReceipt,
} from '../../src/lib/writeback-receipt-fixture';
import { recordRevisionLoop } from '../../src/lib/author-loop';
import { DiskDriftError, HostFileError } from '../../src/lib/host-file-errors';
import { act } from 'react';
import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const writes: Array<{ path: string; content: string }> = [];
const deletes: string[] = [];
const droppedTabs: string[] = [];
const calls: string[] = [];
let snapshotFails = false;
/** 宿主在写入前就拒掉（漂移拒写等）：带回执写入直接报错，不留回执。 */
let hostWriteRejection: Error | null = null;
let snapshotCreated = false;
let versionHistoryOpened = 0;

const receiptFiles = new Map<string, string>();
const receiptFs = {
  pathExists: (path: string) => receiptFiles.has(path),
  readFile: (path: string) => {
    const content = receiptFiles.get(path);
    if (content === undefined) throw new Error('missing');
    return content;
  },
  writeFile: (path: string, content: string) => {
    receiptFiles.set(path, content);
  },
};

vi.mock('../../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    createWritebackAudit: (project: string, id: string, content: string) =>
      createFixtureAudit(receiptFs, project, id, content),
    projectPathExists: (_project: string, path: string) => receiptFiles.has(path),
    readProjectFile: (_project: string, path: string) => receiptFs.readFile(path),
    readWritebackAudit: (project: string, request: WritebackRequest) =>
      readFixtureAudit(receiptFs, project, request),
    inspectWritebackReceipt: (project: string, request: WritebackRequest) =>
      inspectFixtureReceipt(receiptFs, project, request),
    async writeFileWithReceipt(
      project: string,
      request: WritebackRequest,
      expected: DiskBaseline,
      checkpoint: number | null,
    ) {
      if (hostWriteRejection) throw hostWriteRejection;
      return writeFixtureReceipt(receiptFs, project, request, expected, checkpoint, async () => {
        await this.writeFileIfUnchanged(project, request.path, request.content, expected);
        receiptFiles.set(request.path, request.content);
      });
    },
    writeFileIfUnchanged: async (
      _root: string,
      path: string,
      content: string,
      expected: DiskBaseline,
    ) => {
      // 恢复 journal 是 .storyforge 内部记录，不属于正文写回断言范围。
      if (path.includes('pending-suggestions')) {
        receiptFiles.set(path, content);
        return;
      }
      if (
        expected.kind === 'missing' ? diskContent !== undefined : diskContent !== expected.content
      )
        throw new Error('磁盘内容已变化');
      diskContent = content;
      calls.push('write');
      writes.push({ path, content });
    },
    deletePath: async (_root: string, path: string) => {
      calls.push('delete');
      deletes.push(path);
      receiptFiles.delete(path);
      if (path === FILE) diskContent = undefined;
    },
  },
}));

vi.mock('../../src/lib/versions', () => ({
  snapshotBeforeWrite: async () => {
    calls.push('snapshot');
    if (snapshotFails) throw new Error('快照写入失败');
    return { path: '/snapshot.md', timestamp: 1, created: snapshotCreated };
  },
}));

/** 事实记账：记下交给它的「能不能出提示」，批量写章自动写进文件的那几章不该出。 */
const factsNotify: Array<() => boolean> = [];
vi.mock('../../src/lib/fact-write', async (load) => ({
  ...(await load<typeof import('../../src/lib/fact-write')>()),
  recordAcceptedChapterFacts: async (
    _project: string | null,
    _file: string,
    _runId: string | undefined,
    canNotify: () => boolean = () => true,
  ) => {
    factsNotify.push(canNotify);
    return { snapshotPath: null, disputes: 0, added: 0, error: null };
  },
}));

/** 带运行 id 的修订接受后要去引擎结算那次运行；这里不测结算，直接当没有可结算的。 */
vi.mock('../../src/lib/suggestion-recovery', async (load) => ({
  ...(await load<typeof import('../../src/lib/suggestion-recovery')>()),
  settleSuggestionRun: async () => undefined,
}));

/** 接受补丁后会回调后端标连载计划；不 mock 就会打真 fetch。 */
const planMarkArgs: Array<Record<string, unknown>> = [];
let planMarkFails = false;
vi.mock('../../src/lib/api/ide-commands', () => ({
  executeIdeCommand: async (commandId: string, args: Record<string, unknown>) => {
    calls.push(`command:${commandId}`);
    planMarkArgs.push(args);
    if (planMarkFails) throw new Error('计划标记失败');
    return { payload: { plan: { updated: true, ordinal: 1, next_ordinal: 2 } } };
  },
}));

import {
  emitAcceptCurrentFileSuggestion,
  emitFileSuggestion,
} from '../../src/lib/assistant-events';
import { TOAST_EVENT, type ToastAction, type ToastDetail } from '../../src/lib/toast';
import {
  TRUNCATED_ACCEPT_CONFIRM_TIMEOUT_MS,
  useSuggestionWriteback,
} from '../../src/components/editor/useSuggestionWriteback';
import { PatchReviewPanel } from '../../src/components/PatchReviewPanel';
import { acceptPatchFromChat } from '../../src/components/chat-window/accept-patch';
import { buildPatchHunks } from '../../src/lib/patch-hunks';
import {
  bindWriteBatchRun,
  issueWriteBatchGrant,
  revokeWriteBatchGrant,
} from '../../src/lib/write-batch-grant';
import { reconstructAgentResultFromEvents } from '../../src/lib/api/agent-run-events';
import type { AgentResultMessage } from '../../src/lib/api/types';
import { truncationWarningFromAgentResult } from '../../src/components/chat-window/review';
import {
  CHAPTER_TRUNCATION_WARNING,
  chapterWriteRebuildEvents,
} from '../support/chapter-write-rebuild-events';

const PROJECT = 'D:/连载/末世吞噬';
const FILE = 'D:/连载/末世吞噬/正文/第01章.md';
const BEFORE = '旧的一章。';
const AFTER = '新的一章。';

/** 编辑器当前正文——测试要在写回之后改动它，模拟「作者又接着写了」。 */
let editorContent = BEFORE;
let diskContent: string | undefined = BEFORE;
const toasts: ToastDetail[] = [];
let writeback: ReturnType<typeof useSuggestionWriteback>;
let auditGate: Promise<void> | null = null;
let releaseAudit: (() => void) | null = null;

function Harness({ filePath, withPanel = false }: { filePath: string; withPanel?: boolean }) {
  const modelVersion = useRef(1);
  const model = useRef({
    getValue: () => editorContent,
    setValue: (value: string) => {
      editorContent = value;
      modelVersion.current += 1;
    },
    getVersionId: () => modelVersion.current,
    isDisposed: () => false,
    getAlternativeVersionId: () => 1,
  });
  const queue = useRef(createWritebackQueue());
  const editorRef = useRef({
    getValue: () => editorContent,
    getModel: () => model.current,
  } as never);
  const originalContentRef = useRef(BEFORE);
  const cleanVersionIdRef = useRef<number | null>(null);
  const filePathRef = useRef<string | null>(filePath);
  const projectPathRef = useRef<string | null>(PROJECT);
  const modelCacheRef = useRef(
    new Map([
      [
        filePath,
        {
          model: model.current,
          originalContent: BEFORE,
          diskBaseline:
            diskContent === undefined
              ? { kind: 'missing' }
              : { kind: 'content', content: diskContent },
          viewState: null,
        },
      ],
    ]),
  );
  filePathRef.current = filePath;

  writeback = useSuggestionWriteback({
    enqueueWriteback: queue.current,
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
    recordRevisionLoop: async (record) => {
      calls.push('record');
      if (auditGate) await auditGate;
      await recordRevisionLoop(record);
      return { recordPath: '/loop.md' } as never;
    },
    emitAuthorLoopResult: () => undefined,
    dropOpenFilePath: (path: string) => droppedTabs.push(path),
    onRequestVersionHistory: () => {
      versionHistoryOpened += 1;
    },
  });

  // 截断两步确认要连着修订横幅一起测：照 Editor 的接法把横幅挂上。
  if (!withPanel || !writeback.pendingSuggestion) return null;
  return (
    <PatchReviewPanel
      suggestion={writeback.pendingSuggestion}
      editorFontSize={14}
      editorFontFamily="test-font"
      actionKind={writeback.actionState?.kind ?? null}
      error={writeback.actionError}
      errorCause={writeback.actionErrorCause}
      truncationArmed={writeback.truncationAcceptArmed}
      onCancelTruncatedAccept={writeback.cancelTruncatedAccept}
      onAccept={writeback.handleAcceptSuggestion}
      onAcceptHunk={writeback.handleAcceptHunk}
      onReject={writeback.rejectPendingSuggestion}
      onSaveNote={writeback.handleSaveSuggestionNote}
      onRetryWithoutKnowledge={() => undefined}
    />
  );
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'patch-1',
    filePath: FILE,
    title: 'AI 修订',
    summary: '改了第一章',
    before: BEFORE,
    after: AFTER,
    note: '用户意图：改稿',
    createdAt: 1,
    ...overrides,
  } as never;
}

/** 取最后一条带动作的通知——撤销入口就挂在那上面。 */
function lastActionableToast(): ToastAction {
  const found = [...toasts].reverse().find((toast) => toast.action);
  assert.ok(
    found?.action,
    `没有任何带动作的通知，实际：${toasts.map((t) => t.message).join(' | ')}`,
  );
  return found.action;
}

function onToast(event: Event) {
  toasts.push((event as CustomEvent<ToastDetail>).detail);
}

/** 正文写入不等于审计和撤销入口就绪；等待真实动作结束，而非固定事件循环次数。 */
async function settle() {
  await vi.waitFor(async () => {
    await act(async () => {});
    assert.equal(writeback.actionState, null, `写回仍在收尾：${calls.join(' → ')}`);
  });
}

beforeEach(() => {
  auditGate = null;
  releaseAudit = null;
  receiptFiles.clear();
  writes.length = 0;
  deletes.length = 0;
  droppedTabs.length = 0;
  calls.length = 0;
  toasts.length = 0;
  snapshotFails = false;
  hostWriteRejection = null;
  snapshotCreated = false;
  planMarkArgs.length = 0;
  planMarkFails = false;
  factsNotify.length = 0;
  versionHistoryOpened = 0;
  editorContent = BEFORE;
  diskContent = BEFORE;
  window.addEventListener(TOAST_EVENT, onToast);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness filePath={FILE} />);
  });
});

afterEach(async () => {
  releaseAudit?.();
  await settle();
  window.removeEventListener(TOAST_EVENT, onToast);
  act(() => {
    root.unmount();
  });
  container.remove();
});

test('接受补丁后回调连载计划标 done，且发生在版本记录之后', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  await settle();

  assert.deepEqual(
    planMarkArgs,
    [{ project_root: PROJECT, file_path: FILE }],
    '正文落盘后必须回调一次 plan.mark_written，且把项目根与目标文件如实带上',
  );
  assert.equal(
    calls.indexOf('record') < calls.indexOf('command:plan.mark_written'),
    true,
    `标 done 必须在版本记录之后，实际顺序：${calls.join(' → ')}`,
  );
});

test('询问档补丁还没被接受时，绝不回调标 done', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });

  assert.deepEqual(planMarkArgs, [], '补丁还挂着等作者，正文没落盘，不能去标 done');
});

test('快照失败阻断写盘时，也不回调标 done', async () => {
  snapshotFails = true;

  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  await settle();

  assert.deepEqual(planMarkArgs, [], '写盘被阻断就没有「写完一章」这回事');
});

test('标 done 失败不能伪造成「接受失败」——正文其实已经写进去了', async () => {
  planMarkFails = true;

  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  await settle();

  assert.deepEqual(writes, [{ path: FILE, content: AFTER }], '写回本身必须照常成功');
  const failed = toasts.filter((toast) => toast.tone === 'error');
  assert.deepEqual(
    failed,
    [],
    `回调失败只能吞掉，不该弹错误通知，实际：${failed.map((t) => t.message).join(' | ')}`,
  );
});

test('撤销一次新建后回调把该章退回 pending，且发生在删文件之后', async () => {
  snapshotCreated = true;
  diskContent = undefined;
  act(() => root.render(<Harness key="missing" filePath={FILE} />));

  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  await settle();
  editorContent = AFTER;
  planMarkArgs.length = 0;
  calls.length = 0;

  await act(async () => {
    await lastActionableToast().run();
  });
  await settle();

  assert.deepEqual(deletes, [FILE], '撤销新建应当删文件');
  assert.deepEqual(
    planMarkArgs,
    [{ project_root: PROJECT, file_path: FILE }],
    '正文没了，必须回调一次 plan.unmark_written',
  );
  assert.equal(
    calls.indexOf('delete') < calls.indexOf('command:plan.unmark_written'),
    true,
    `退标记必须在删文件之后，实际顺序：${calls.join(' → ')}`,
  );
});

test('撤销一次普通修订不退标记——文件还在，那章依然是写完的', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  await settle();
  editorContent = AFTER;
  planMarkArgs.length = 0;
  calls.length = 0;

  await act(async () => {
    await lastActionableToast().run();
  });
  await settle();

  assert.deepEqual(deletes, [], '普通修订的撤销是反向写回，不删文件');
  assert.deepEqual(
    calls.filter((call) => call.startsWith('command:')),
    [],
    '文件还在，不该去退标记（正向回调也只挂在接受整个补丁那一层）',
  );
});

test('自动档：补丁不必点接受就落盘，且顺序仍是先快照后写盘', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  await settle();

  assert.deepEqual(
    writes,
    [{ path: FILE, content: AFTER }],
    '自动档补丁应当无需任何点击就写到目标文件',
  );
  assert.equal(calls.indexOf('snapshot') >= 0, true, '写盘前必须存快照');
  assert.equal(
    calls.indexOf('snapshot') < calls.indexOf('write'),
    true,
    `快照必须发生在写盘之前，实际顺序：${calls.join(' → ')}`,
  );
});

test('询问档：补丁只挂起等作者，绝不自己落盘', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: true }));
  });

  assert.deepEqual(writes, [], '询问档不得在没有作者确认时写盘');
});

test('确认位缺失（老后端 / 坏数据）一律退回手动确认', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });

  assert.deepEqual(writes, [], '缺少 requiresConfirmation 时必须失败关闭');
});

test('自动档下快照失败仍然阻断写盘', async () => {
  snapshotFails = true;

  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });

  assert.deepEqual(writes, [], '快照失败时绝不能落盘');
  assert.equal(calls.includes('record'), false, '快照失败后也不该记录闭环');
});

test('撤销一次「新建」是删掉文件并摘页签，不是写回一个空文件', async () => {
  snapshotCreated = true;
  diskContent = undefined;
  act(() => root.render(<Harness key="missing" filePath={FILE} />));
  editorContent = '';

  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false, before: '', after: AFTER }));
  });
  await settle();
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);

  editorContent = AFTER;
  const undo = lastActionableToast();
  assert.match(undo.label, /删除/, '新建的撤销按钮要说清楚会删文件');

  await act(async () => {
    await undo.run();
  });
  await settle();

  assert.deepEqual(deletes, [FILE], '撤销新建必须真的把文件删掉');
  assert.deepEqual(droppedTabs, [FILE], '页签要一起摘掉，否则 autosave 会把文件写回来');
  assert.equal(writes.length, 1, '撤销新建不得再写一次空内容');
});

test('撤销一次普通修订仍是写回原文，不碰删除', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  await settle();

  editorContent = AFTER;
  await act(async () => {
    await lastActionableToast().run();
  });
  await settle();

  assert.deepEqual(deletes, [], '普通修订的撤销不该删文件');
  assert.deepEqual(writes[1], { path: FILE, content: BEFORE }, '应把原文写回去');
});

test('文件之后又变了：撤销不再是死路，给出版本历史入口', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  await settle();

  // 作者在写回之后又接着写了——此时一键撤销会吃掉这段新输入。
  editorContent = `${AFTER}\n作者后来又写的一段。`;
  await act(async () => {
    await lastActionableToast().run();
  });
  await settle();

  assert.equal(writes.length, 1, '内容已变时绝不能覆盖作者的新输入');
  assert.deepEqual(deletes, []);

  const fallback = lastActionableToast();
  assert.match(fallback.label, /版本历史/, '撤销失效后要给去处，而不是只报个错');
  await act(async () => {
    await fallback.run();
  });
  assert.equal(versionHistoryOpened, 1, '点它应当真的打开版本历史');
});

test('正文已写入但审计挂起时不提前提供撤销，审计完成后才结算', async () => {
  auditGate = new Promise<void>((resolve) => {
    releaseAudit = resolve;
  });
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    assert.ok(calls.includes('record'));
  });
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);
  assert.notEqual(writeback.actionState, null);
  assert.equal(
    toasts.some((toast) => toast.action),
    false,
  );
  assert.deepEqual(planMarkArgs, []);

  releaseAudit!();
  await settle();

  assert.match(lastActionableToast().label, /撤销/);
  assert.equal(writeback.actionState, null);
  assert.equal(calls.filter((call) => call === 'write').length, 1);
  assert.equal(calls.filter((call) => call === 'record').length, 1);
  assert.equal(planMarkArgs.length, 1);
});

const TRUNCATION =
  'AI 的输出可能没写完：原文最后 2 段在新稿里没有，且新稿停在半句（「…新的一章」）。';

function acceptButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="suggestion-accept"]');
  assert.ok(button, '修订横幅上找不到「接受」');
  return button;
}

async function clickAccept() {
  await act(async () => {
    acceptButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

async function pressCtrlY() {
  await act(async () => {
    acceptButton().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
    );
  });
  await settle();
}

async function showTruncatedPatch(overrides: Record<string, unknown> = {}) {
  act(() => root.render(<Harness key="panel" filePath={FILE} withPanel />));
  await act(async () => {
    emitFileSuggestion(
      suggestion({ requiresConfirmation: true, truncationWarning: TRUNCATION, ...overrides }),
    );
  });
}

test('新稿可能没写完：第一次点「接受」只就地武装、不写不留快照，再点一次才写', async () => {
  await showTruncatedPatch();
  await clickAccept();

  assert.deepEqual(writes, [], '第一次点不能写盘');
  assert.equal(calls.includes('snapshot'), false, '武装时连快照都不该留');
  assert.equal(acceptButton().textContent, '仍然整份接受');
  assert.equal(acceptButton().dataset.armed, 'true');
  assert.match(
    container.querySelector('[data-testid="patch-truncation-confirm"]')?.textContent ?? '',
    /AI 可能没写完.*再点一次才写/,
  );
  assert.equal(
    container.querySelector('[data-testid="app-dialog-message"]'),
    null,
    '不弹居中确认框',
  );

  await clickAccept();
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }], '武装着再点一次才写回');
});

test('Ctrl+Y 同样两步：第一次武装，第二次才写', async () => {
  await showTruncatedPatch();
  await pressCtrlY();
  assert.deepEqual(writes, []);
  assert.equal(acceptButton().textContent, '仍然整份接受');

  await pressCtrlY();
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);
});

test('武装超时就撤销：之后仍要重新点两次', async () => {
  await showTruncatedPatch();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    await act(async () => {
      acceptButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    assert.equal(acceptButton().textContent, '仍然整份接受');
    act(() => {
      vi.advanceTimersByTime(TRUNCATED_ACCEPT_CONFIRM_TIMEOUT_MS);
    });
    assert.equal(acceptButton().textContent, '接受', '超时后回到未武装');
  } finally {
    vi.useRealTimers();
  }
  await clickAccept();
  assert.deepEqual(writes, [], '超时之后的第一次点仍只武装');
  await clickAccept();
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);
});

test('武装后失焦或移开就撤销', async () => {
  await showTruncatedPatch();
  await clickAccept();
  await act(async () => {
    acceptButton().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  assert.equal(acceptButton().textContent, '接受');
  await clickAccept();
  await act(async () => {
    acceptButton().dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
  });
  assert.equal(acceptButton().textContent, '接受');
  assert.deepEqual(writes, []);
});

test('对话里点「接受」：半截稿只在编辑器横幅上武装，对话路径永不直接写', async () => {
  await showTruncatedPatch();
  const target = { patchId: 'patch-1', filePath: FILE };
  let claim: unknown;
  await act(async () => {
    claim = acceptPatchFromChat(target, PROJECT);
  });
  await settle();
  assert.equal(claim, 'armed');
  assert.deepEqual(writes, [], '对话里第一次接受不写');
  assert.equal(acceptButton().textContent, '仍然整份接受', '编辑器横幅进入待确认');
  assert.ok(
    toasts.some((toast) => /可能没写完，没有写入/.test(toast.message)),
    '对话侧要说清没写、去编辑器确认',
  );

  await act(async () => {
    claim = emitAcceptCurrentFileSuggestion(target);
  });
  await settle();
  assert.equal(claim, 'armed');
  assert.deepEqual(writes, [], '对话里再点也不写');

  await clickAccept();
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }], '只能在横幅上确认写入');
});

test('自动档的半截稿：自动接受也被硬闸拦下，不写', async () => {
  await showTruncatedPatch({ requiresConfirmation: false });
  await settle();
  assert.deepEqual(writes, [], '没经作者第二次点击不能落盘');
});

test('逐处接受不受截断两步影响', async () => {
  await showTruncatedPatch();
  const [hunk] = buildPatchHunks(BEFORE, AFTER);
  await act(async () => {
    await writeback.handleAcceptHunk(hunk);
  });
  await settle();
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);
});

test('没有截断警告的补丁照旧点一次就写', async () => {
  act(() => root.render(<Harness key="panel" filePath={FILE} withPanel />));
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: true }));
  });
  await clickAccept();
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);
  assert.equal(container.querySelector('[data-testid="patch-truncation-confirm"]'), null);
});

test('宿主漂移拒写一路带着类型到补丁面板：不提示可重试；换成写盘失败才提示', async () => {
  act(() => root.render(<Harness key="panel" filePath={FILE} withPanel />));
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: true }));
  });
  const status = () =>
    container.querySelector('[data-testid="patch-action-status"]')?.textContent ?? '';
  const drift = `磁盘内容已变化，已拒绝覆盖；请重新读取并处理冲突: ${FILE}`;

  hostWriteRejection = new DiskDriftError(drift);
  await clickAccept();
  assert.deepEqual(writes, []);
  assert.equal(status(), `操作失败：接受失败: ${drift}`);

  hostWriteRejection = new HostFileError('无法写入文件: 拒绝访问。 (os error 5)');
  await clickAccept();
  assert.deepEqual(writes, []);
  assert.equal(status(), '操作失败：接受失败: 无法写入文件: 拒绝访问。 (os error 5)，可重试');
});

/** 批量写章这一批的授权，登记上这一轮的运行 id（调度器发起每一章时就是这么做的）。 */
function batchRun(runId: string) {
  const grant = issueWriteBatchGrant({
    projectPath: PROJECT,
    batchId: 'write-batch-1',
    targets: ['正文/第01章.md'],
  });
  bindWriteBatchRun(grant, runId);
  return grant;
}

test('批量写章自动写进文件的那一章：不逐章弹撤销提示，事实记账也不出提示，撤销在清单上', async () => {
  const grant = batchRun('run-batch');
  try {
    await act(async () => {
      emitFileSuggestion(suggestion({ requiresConfirmation: false, runId: 'run-batch' }));
    });
    await settle();
    assert.deepEqual(writes, [{ path: FILE, content: AFTER }], '批量的这一章照常写进文件');
    assert.deepEqual(
      toasts.filter((toast) => toast.action).map((toast) => toast.action!.label),
      [],
      '批量写进文件的章不弹带撤销的提示',
    );
    assert.equal(factsNotify.length, 1);
    assert.equal(factsNotify[0](), false, '事实记账也不出「撤销记账」提示');
    assert.ok(
      toasts.some((toast) =>
        toast.message.startsWith('已写入当前文件 · 已留写前快照，撤销在批量写章的清单上'),
      ),
      `收尾那句要指向清单，实际：${toasts.map((toast) => toast.message).join(' | ')}`,
    );
  } finally {
    revokeWriteBatchGrant(grant);
  }
});

test.each([
  ['不是批量发起的自动写进', 'run-other', false, false],
  ['批量这一轮要作者点接受、作者手动接受', 'run-confirm', true, false],
  ['这一批停下（授权撤销）以后才写进', 'run-late', false, true],
])('%s：照旧弹撤销提示', async (_name, runId, manual, revokedFirst) => {
  const grant = runId === 'run-other' ? null : batchRun(runId);
  if (revokedFirst) revokeWriteBatchGrant(grant);
  try {
    await act(async () => {
      emitFileSuggestion(suggestion({ requiresConfirmation: manual, runId }));
    });
    if (manual)
      await act(async () => {
        emitAcceptCurrentFileSuggestion();
      });
    await settle();
    assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);
    assert.equal(lastActionableToast().label, '撤销', '撤销提示照旧弹');
    assert.equal(factsNotify.length, 1);
    assert.equal(factsNotify[0](), true, '事实记账的提示照旧出');
  } finally {
    revokeWriteBatchGrant(grant);
  }
});

/** 断线后按事件表重建的写章结果：取警告的路与对话窗一致，交给编辑器横幅。 */
async function showRebuiltChapterPatch(truncationWarning: Record<string, unknown> | null) {
  const rebuilt = reconstructAgentResultFromEvents(
    chapterWriteRebuildEvents({
      patch: { id: 'chapter-writing-1', file_path: FILE, before: BEFORE, after: AFTER },
      truncationWarning,
    }),
    { sessionId: 'agent-session', runId: 'run-1' },
  ) as AgentResultMessage;
  act(() => root.render(<Harness key="panel" filePath={FILE} withPanel />));
  await act(async () => {
    emitFileSuggestion(
      suggestion({
        id: 'chapter-writing-1',
        requiresConfirmation: rebuilt.agent_result.requires_user_confirmation,
        truncationWarning: truncationWarningFromAgentResult(rebuilt) ?? undefined,
      }),
    );
  });
}

test('断线重建的写章结果停在半句：同样红色警告、两步确认', async () => {
  await showRebuiltChapterPatch(CHAPTER_TRUNCATION_WARNING);
  assert.match(
    container.querySelector('[data-testid="patch-truncation-warning"]')?.textContent ?? '',
    /疑似没写完/,
  );
  await clickAccept();
  assert.deepEqual(writes, [], '第一次点不能写盘');
  assert.equal(acceptButton().textContent, '仍然整份接受');
  await clickAccept();
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);
});

test('断线重建的写章结果收句：没有截断警告，点一次就写', async () => {
  await showRebuiltChapterPatch(null);
  assert.equal(container.querySelector('[data-testid="patch-truncation-warning"]'), null);
  await clickAccept();
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);
});
