import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test, vi } from 'vitest';
import { useBranchManifest } from '../src/components/editor/useBranchManifest';
import type { BranchManifest } from '../src/lib/branches';

const io = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(async () => {}) }));
vi.mock('../src/lib/branches', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/branches')>();
  return { ...original, loadBranchManifest: io.load, saveBranchManifest: io.save };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function manifest(headNodeId: number): BranchManifest {
  return {
    activeBranchId: 'main',
    branches: [{ id: 'main', label: '主线', color: '#333', baseNodeId: null, headNodeId }],
  };
}

test('原文件迟到的快照推进只写原分支清单，不修改新页签分支', async () => {
  io.load.mockImplementation(async (_project: string, file: string) =>
    manifest(file === 'a.md' ? 1 : 20),
  );
  let handle!: ReturnType<typeof useBranchManifest>;
  function Harness({ file }: { file: string }) {
    handle = useBranchManifest('D:/book', file);
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness file="a.md" />));
    const advanceOriginal = handle.advanceBranchHead;
    await act(async () => root.render(<Harness file="b.md" />));
    await act(async () =>
      advanceOriginal(2, { projectPath: 'D:/book', filePath: 'a.md', branchId: 'main' }),
    );
    assert.deepEqual(io.save.mock.calls.at(-1), ['D:/book', 'a.md', manifest(2)]);
    assert.equal(handle.branchManifest.branches[0].headNodeId, 20);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
