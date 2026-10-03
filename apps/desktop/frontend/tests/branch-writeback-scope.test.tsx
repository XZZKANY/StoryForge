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

function twoBranchManifest(): BranchManifest {
  return {
    activeBranchId: 'main',
    branches: [
      { id: 'main', label: '主线', color: '#333', baseNodeId: null, headNodeId: 1 },
      { id: 'b1', label: '分支一', color: '#555', baseNodeId: 1, headNodeId: 1 },
    ],
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

test('先发起的原文件保存迟到返回时只结算磁盘，不污染已切换页签的清单与后续保存', async () => {
  io.load.mockImplementation(async (_project: string, file: string) =>
    manifest(file === 'a.md' ? 1 : 20),
  );
  io.save.mockClear();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  io.save.mockImplementationOnce(async () => {
    await gate;
  });
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
    let pending!: Promise<void>;
    await act(async () => {
      pending = advanceOriginal(2, { projectPath: 'D:/book', filePath: 'a.md', branchId: 'main' });
    });
    assert.equal(io.save.mock.calls.length, 1);
    assert.deepEqual(io.save.mock.calls[0], ['D:/book', 'a.md', manifest(2)]);
    await act(async () => root.render(<Harness file="b.md" />));
    assert.equal(handle.branchManifest.branches[0].headNodeId, 20);
    await act(async () => {
      release();
      await pending;
    });
    assert.equal(handle.branchManifest.branches[0].headNodeId, 20);
    assert.equal(handle.branchManifest.activeBranchId, 'main');
    await act(async () =>
      handle.advanceBranchHead(21, { projectPath: 'D:/book', filePath: 'b.md', branchId: 'main' }),
    );
    assert.equal(handle.branchManifest.branches[0].headNodeId, 21);
    assert.deepEqual(io.save.mock.calls.at(-1), ['D:/book', 'b.md', manifest(21)]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('等待期间切换分支使迟到推进只落盘不投影', async () => {
  io.load.mockImplementation(async () => twoBranchManifest());
  io.save.mockClear();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  io.save.mockImplementationOnce(async () => {
    await gate;
  });
  let handle!: ReturnType<typeof useBranchManifest>;
  function Harness() {
    handle = useBranchManifest('D:/book', 'a.md');
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    let pending!: Promise<void>;
    let selecting!: Promise<void>;
    await act(async () => {
      pending = handle.advanceBranchHead(2, {
        projectPath: 'D:/book',
        filePath: 'a.md',
        branchId: 'main',
      });
    });
    await act(async () => {
      selecting = handle.selectBranch('b1');
    });
    assert.equal(handle.branchManifest.activeBranchId, 'b1');
    await act(async () => {
      release();
      await pending;
      await selecting;
    });
    assert.equal(handle.branchManifest.activeBranchId, 'b1');
    assert.equal(handle.branchManifest.branches[0].headNodeId, 1);
    const lastSave = io.save.mock.calls.at(-1) as unknown as [string, string, BranchManifest];
    assert.equal(lastSave[1], 'a.md');
    assert.equal(lastSave[2].activeBranchId, 'b1');
    assert.equal(lastSave[2].branches[0].headNodeId, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('原文件保存失败时错误照旧上报且不投影', async () => {
  io.load.mockImplementation(async () => manifest(1));
  io.save.mockClear();
  io.save.mockImplementationOnce(async () => {
    throw new Error('disk full');
  });
  let handle!: ReturnType<typeof useBranchManifest>;
  function Harness() {
    handle = useBranchManifest('D:/book', 'a.md');
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      await assert.rejects(
        handle.advanceBranchHead(2, { projectPath: 'D:/book', filePath: 'a.md', branchId: 'main' }),
        /disk full/,
      );
    });
    assert.equal(handle.branchManifest.branches[0].headNodeId, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('切走又切回后旧代际的迟到推进不得覆盖重载后的清单', async () => {
  io.load.mockImplementation(async (_project: string, file: string) =>
    manifest(file === 'a.md' ? 1 : 20),
  );
  io.save.mockClear();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  io.save.mockImplementationOnce(async () => {
    await gate;
  });
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
    let pending!: Promise<void>;
    await act(async () => {
      pending = advanceOriginal(2, { projectPath: 'D:/book', filePath: 'a.md', branchId: 'main' });
    });
    await act(async () => root.render(<Harness file="b.md" />));
    await act(async () => root.render(<Harness file="a.md" />));
    assert.equal(handle.branchManifest.branches[0].headNodeId, 1);
    await act(async () => {
      release();
      await pending;
    });
    assert.equal(handle.branchManifest.branches[0].headNodeId, 1);
    await act(async () =>
      handle.advanceBranchHead(3, { projectPath: 'D:/book', filePath: 'a.md', branchId: 'main' }),
    );
    assert.equal(handle.branchManifest.branches[0].headNodeId, 3);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
