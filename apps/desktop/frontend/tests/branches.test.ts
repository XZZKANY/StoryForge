import assert from 'node:assert/strict';
import { test } from 'vitest';

import { invalidateFileSystemCache } from '../src/lib/tauri-fs';
import {
  buildGraph,
  createBranch,
  emptyManifest,
  getActiveBranch,
  loadBranchManifest,
  MAIN_BRANCH_ID,
  normalizeManifest,
  saveBranchManifest,
  setActiveBranch,
  setBranchHead,
} from '../src/lib/branches';
import type { VersionEntry } from '../src/lib/versions';

function withMockFs(
  mockFs: NonNullable<Window['__STORYFORGE_MOCK_FS__']>,
  run: () => Promise<void>,
) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __STORYFORGE_MOCK_FS__: mockFs },
  });
  return run().finally(() => {
    invalidateFileSystemCache();
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });
}

function version(timestamp: number, extra: Partial<VersionEntry> = {}): VersionEntry {
  return { path: `snap/${timestamp}.snapshot.md`, timestamp, ...extra };
}

test('createBranch forks from a node, activates it, and keeps ids unique', () => {
  const base = emptyManifest();
  const first = createBranch(base, 1000, '放飞自我线');
  assert.equal(first.activeBranchId, 'b1000');
  const branch = getActiveBranch(first);
  assert.equal(branch.id, 'b1000');
  assert.equal(branch.label, '放飞自我线');
  assert.equal(branch.baseNodeId, 1000);
  assert.equal(branch.headNodeId, 1000);

  // 同一节点再开一条 → id 去重
  const second = createBranch(first, 1000, '另一种结局');
  assert.equal(second.activeBranchId, 'b1000-2');
  assert.equal(second.branches.length, 3);
});

test('setActiveBranch ignores unknown branch and switches known one', () => {
  const manifest = createBranch(emptyManifest(), 1000, '支线');
  assert.equal(setActiveBranch(manifest, '不存在').activeBranchId, manifest.activeBranchId);
  assert.equal(setActiveBranch(manifest, MAIN_BRANCH_ID).activeBranchId, MAIN_BRANCH_ID);
});

test('setBranchHead advances only the target branch tip', () => {
  const manifest = createBranch(emptyManifest(), 1000, '支线');
  const advanced = setBranchHead(manifest, 'b1000', 2000);
  assert.equal(advanced.branches.find((b) => b.id === 'b1000')?.headNodeId, 2000);
  assert.equal(advanced.branches.find((b) => b.id === MAIN_BRANCH_ID)?.headNodeId, null);
});

test('normalizeManifest guarantees main and a valid active branch', () => {
  const fromBroken = normalizeManifest({ activeBranchId: '幽灵', branches: [] });
  assert.equal(fromBroken.activeBranchId, MAIN_BRANCH_ID);
  assert.equal(fromBroken.branches.some((b) => b.id === MAIN_BRANCH_ID), true);

  const missingMain = normalizeManifest({
    activeBranchId: 'x',
    branches: [{ id: 'x', label: 'X' }],
  });
  assert.equal(missingMain.branches.some((b) => b.id === MAIN_BRANCH_ID), true);
  assert.equal(missingMain.activeBranchId, 'x');
});

test('buildGraph keeps legacy flat snapshots as a linear main line', () => {
  const versions = [version(300), version(100), version(200)]; // 乱序
  const graph = buildGraph(versions, emptyManifest());
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  assert.equal(graph.nodes.length, 3);
  assert.equal(byId.get(100)?.parentId, null); // 首节点为根
  assert.equal(byId.get(200)?.parentId, 100);
  assert.equal(byId.get(300)?.parentId, 200);
  assert.equal(graph.nodes.every((node) => node.branchId === MAIN_BRANCH_ID), true);
  assert.equal(graph.nodes.every((node) => node.lane === 0), true);
});

test('buildGraph honours explicit lineage and assigns lanes per branch', () => {
  const manifest = setBranchHead(createBranch(emptyManifest(), 100, '支线'), 'b100', 150);
  const versions = [
    version(100, { branchId: MAIN_BRANCH_ID }),
    version(120, { branchId: MAIN_BRANCH_ID, parentId: 100 }),
    version(150, { branchId: 'b100', parentId: 100 }), // 从 100 分叉
  ];
  const graph = buildGraph(versions, manifest);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  assert.equal(byId.get(150)?.parentId, 100);
  assert.equal(byId.get(150)?.lane, 1); // 支线在第二条泳道
  assert.equal(byId.get(120)?.lane, 0);
});

test('loadBranchManifest falls back to main when manifest is absent', async () => {
  await withMockFs(
    {
      readFile() {
        throw new Error('ENOENT');
      },
    },
    async () => {
      const manifest = await loadBranchManifest('D:\\Book', 'D:\\Book\\正文\\第一章.md');
      assert.deepEqual(manifest, emptyManifest());
    },
  );
});

test('saveBranchManifest writes JSON beside the file version dir and round-trips', async () => {
  const store = new Map<string, string>();
  const expectedPath = 'D:\\Book\\.storyforge\\versions\\正文\\第一章.md\\branches.json';
  await withMockFs(
    {
      writeFile(path: string, content: string) {
        store.set(path, content);
      },
      readFile(path: string) {
        const value = store.get(path);
        if (value === undefined) throw new Error('ENOENT');
        return value;
      },
    },
    async () => {
      const manifest = createBranch(emptyManifest(), 1000, '支线');
      await saveBranchManifest('D:\\Book', 'D:\\Book\\正文\\第一章.md', manifest);
      assert.equal(store.has(expectedPath), true);

      const loaded = await loadBranchManifest('D:\\Book', 'D:\\Book\\正文\\第一章.md');
      assert.equal(loaded.activeBranchId, 'b1000');
      assert.equal(loaded.branches.length, 2);
    },
  );
});
