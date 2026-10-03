import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test, vi } from 'vitest';
import { useBranchManifest } from '../src/components/editor/useBranchManifest';
import { setActiveBranch, setBranchHead } from '../src/lib/branches';
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

/** 清单任务在 per-file 链上多跳微任务后才会调 save，断言前先放它跑。 */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

function mount(initial: string | null) {
  let handle!: ReturnType<typeof useBranchManifest>;
  function Harness({ file }: { file: string | null }) {
    handle = useBranchManifest('D:/book', file);
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    get handle() {
      return handle;
    },
    render: (file: string | null) => act(async () => root.render(<Harness file={file} />)),
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
    initial,
  };
}

test('原文件迟到的快照推进只写原分支清单，不修改新页签分支', async () => {
  io.load.mockImplementation(async (_project: string, file: string) =>
    manifest(file === 'a.md' ? 1 : 20),
  );
  const app = mount('a.md');
  try {
    await app.render('a.md');
    const advanceOriginal = app.handle.advanceBranchHead;
    await app.render('b.md');
    await act(async () =>
      advanceOriginal(2, { projectPath: 'D:/book', filePath: 'a.md', branchId: 'main' }),
    );
    assert.deepEqual(io.save.mock.calls.at(-1), ['D:/book', 'a.md', manifest(2)]);
    assert.equal(app.handle.branchManifest.branches[0].headNodeId, 20);
  } finally {
    app.cleanup();
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
  const app = mount('a.md');
  try {
    await app.render('a.md');
    const advanceOriginal = app.handle.advanceBranchHead;
    const pending = advanceOriginal(2, {
      projectPath: 'D:/book',
      filePath: 'a.md',
      branchId: 'main',
    });
    await flush();
    assert.equal(io.save.mock.calls.length, 1);
    assert.deepEqual(io.save.mock.calls[0], ['D:/book', 'a.md', manifest(2)]);
    await app.render('b.md');
    assert.equal(app.handle.branchManifest.branches[0].headNodeId, 20);
    await act(async () => {
      release();
      await pending;
    });
    assert.equal(app.handle.branchManifest.branches[0].headNodeId, 20);
    assert.equal(app.handle.branchManifest.activeBranchId, 'main');
    await act(async () =>
      app.handle.advanceBranchHead(21, {
        projectPath: 'D:/book',
        filePath: 'b.md',
        branchId: 'main',
      }),
    );
    assert.equal(app.handle.branchManifest.branches[0].headNodeId, 21);
    assert.deepEqual(io.save.mock.calls.at(-1), ['D:/book', 'b.md', manifest(21)]);
  } finally {
    app.cleanup();
  }
});

test('保存推进与切分支并发时互相 rebase，两个变更都保留', async () => {
  io.load.mockImplementation(async () => twoBranchManifest());
  io.save.mockClear();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  io.save.mockImplementationOnce(async () => {
    await gate;
  });
  const app = mount('a.md');
  try {
    await app.render('a.md');
    const advanced = setBranchHead(twoBranchManifest(), 'main', 2);
    const advancing = app.handle.advanceBranchHead(2, {
      projectPath: 'D:/book',
      filePath: 'a.md',
      branchId: 'main',
    });
    await flush();
    assert.deepEqual(io.save.mock.calls[0], ['D:/book', 'a.md', advanced]);
    const selecting = app.handle.selectBranch('b1');
    await flush();
    assert.equal(io.save.mock.calls.length, 1);
    await act(async () => {
      release();
      await advancing;
      await selecting;
    });
    const merged = setActiveBranch(advanced, 'b1');
    assert.deepEqual(io.save.mock.calls.at(-1), ['D:/book', 'a.md', merged]);
    assert.equal(app.handle.branchManifest.activeBranchId, 'b1');
    assert.equal(app.handle.branchManifest.branches[0].headNodeId, 2);
  } finally {
    app.cleanup();
  }
});

test('等待中建分支与保存推进并发时两个变更都保留', async () => {
  io.load.mockImplementation(async () => twoBranchManifest());
  io.save.mockClear();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  io.save.mockImplementationOnce(async () => {
    await gate;
  });
  const app = mount('a.md');
  try {
    await app.render('a.md');
    const advancing = app.handle.advanceBranchHead(2, {
      projectPath: 'D:/book',
      filePath: 'a.md',
      branchId: 'main',
    });
    await flush();
    const creating = app.handle.createBranchFromNode(1, '支线');
    await flush();
    await act(async () => {
      release();
      await advancing;
      await creating;
    });
    const lastSave = io.save.mock.calls.at(-1) as unknown as [string, string, BranchManifest];
    const created = lastSave[2].branches.find((branch) => branch.label === '支线');
    assert.ok(created);
    assert.equal(lastSave[1], 'a.md');
    assert.equal(lastSave[2].activeBranchId, created.id);
    assert.equal(lastSave[2].branches[0].headNodeId, 2);
    assert.equal(app.handle.branchManifest.activeBranchId, created.id);
    assert.equal(app.handle.branchManifest.branches[0].headNodeId, 2);
  } finally {
    app.cleanup();
  }
});

test('原文件保存失败时错误照旧上报且不投影', async () => {
  io.load.mockImplementation(async () => manifest(1));
  io.save.mockClear();
  io.save.mockImplementationOnce(async () => {
    throw new Error('disk full');
  });
  const app = mount('a.md');
  try {
    await app.render('a.md');
    await act(async () => {
      await assert.rejects(
        app.handle.advanceBranchHead(2, {
          projectPath: 'D:/book',
          filePath: 'a.md',
          branchId: 'main',
        }),
        /disk full/,
      );
    });
    assert.equal(app.handle.branchManifest.branches[0].headNodeId, 1);
  } finally {
    app.cleanup();
  }
});

test('切走又切回后迟到的推进以已落盘结果收敛', async () => {
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
  const app = mount('a.md');
  try {
    await app.render('a.md');
    const advanceOriginal = app.handle.advanceBranchHead;
    const pending = advanceOriginal(2, {
      projectPath: 'D:/book',
      filePath: 'a.md',
      branchId: 'main',
    });
    await flush();
    await app.render('b.md');
    await app.render('a.md');
    assert.equal(app.handle.branchManifest.branches[0].headNodeId, 1);
    await act(async () => {
      release();
      await pending;
    });
    assert.equal(app.handle.branchManifest.branches[0].headNodeId, 2);
    await act(async () =>
      app.handle.advanceBranchHead(3, {
        projectPath: 'D:/book',
        filePath: 'a.md',
        branchId: 'main',
      }),
    );
    assert.equal(app.handle.branchManifest.branches[0].headNodeId, 3);
  } finally {
    app.cleanup();
  }
});
