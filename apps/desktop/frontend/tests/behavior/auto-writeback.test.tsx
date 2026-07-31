/**
 * 自动档写回红线：护栏打在接线上，不是只测纯函数。
 *
 * 本波把「补丁必须作者点接受」放宽成「自动档免点击」，放宽的只有那一层闸。这里钉死的是
 * 剩下没放宽的部分：谁能自动落盘、落盘前必须先存快照、快照失败必须阻断、派生缓存永不自动写。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

const writes: Array<{ path: string; content: string }> = [];
const calls: string[] = [];
let snapshotFails = false;

vi.mock('../../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    writeFile: async (_root: string, path: string, content: string) => {
      calls.push('write');
      writes.push({ path, content });
    },
  },
}));

vi.mock('../../src/lib/versions', () => ({
  snapshotBeforeWrite: async () => {
    calls.push('snapshot');
    if (snapshotFails) throw new Error('快照写入失败');
    return '/snapshot.md';
  },
}));

import { emitFileSuggestion } from '../../src/lib/assistant-events';
import { useSuggestionWriteback } from '../../src/components/editor/useSuggestionWriteback';

const PROJECT = 'D:/连载/末世吞噬';
const FILE = 'D:/连载/末世吞噬/正文/第01章.md';
const BEFORE = '旧的一章。';
const AFTER = '新的一章。';

function Harness({ filePath }: { filePath: string }) {
  const editorRef = useRef({
    getValue: () => BEFORE,
    getModel: () => null,
  } as never);
  const originalContentRef = useRef(BEFORE);
  const cleanVersionIdRef = useRef<number | null>(null);
  const filePathRef = useRef<string | null>(filePath);
  const projectPathRef = useRef<string | null>(PROJECT);
  const modelCacheRef = useRef(new Map());
  filePathRef.current = filePath;

  useSuggestionWriteback({
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
  });

  return null;
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

beforeEach(() => {
  writes.length = 0;
  calls.length = 0;
  snapshotFails = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness filePath={FILE} />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

test('自动档：补丁不必点接受就落盘，且顺序仍是先快照后写盘', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });

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
