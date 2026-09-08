import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { useBranchManifest } from '../src/components/editor/useBranchManifest';
import {
  emptyManifest,
  loadBranchManifest,
  saveBranchManifest,
  type BranchManifest,
} from '../src/lib/branches';
vi.mock('../src/lib/branches', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/branches')>()),
  loadBranchManifest: vi.fn(),
  saveBranchManifest: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let latest: ReturnType<typeof useBranchManifest>;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const disk = new Map<string, BranchManifest>();
function Harness({ project, file }: { project: string; file: string }) {
  latest = useBranchManifest(project, file);
  return null;
}
async function render(project = 'D:/A', file = 'D:/A/章.md') {
  await act(async () => root.render(<Harness project={project} file={file} />));
}
beforeEach(async () => {
  disk.clear();
  const manifest = emptyManifest();
  manifest.branches.push({ ...manifest.branches[0], id: 'other', label: '另一条线' });
  disk.set('D:/A/章.md', manifest);
  vi.mocked(loadBranchManifest).mockImplementation(async (_project, file) =>
    structuredClone(disk.get(file) ?? emptyManifest()),
  );
  vi.mocked(saveBranchManifest).mockImplementation(async (_project, file, manifest) => {
    disk.set(file, structuredClone(manifest));
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await render();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.resetAllMocks();
});

for (const change of ['project', 'file', 'branch']) {
  test(`旧快照完成推进原文件原分支，而非当前选择：${change}`, async () => {
    const advance = latest.advanceBranchHead;
    const target = {
      projectPath: 'D:/A',
      filePath: 'D:/A/章.md',
      branchId: latest.getActiveBranchSnapshot().id,
    };
    if (change === 'project') await render('D:/B', 'D:/B/章.md');
    if (change === 'file') await render('D:/A', 'D:/A/另一章.md');
    if (change === 'branch')
      await act(async () => {
        await latest.selectBranch('other');
      });
    vi.mocked(saveBranchManifest).mockClear();
    await act(async () => {
      await advance(42, target);
    });
    const save = vi.mocked(saveBranchManifest).mock.calls[0];
    assert.equal(save[0], target.projectPath);
    assert.equal(save[1], target.filePath);
    assert.equal(save[2].branches.find((branch) => branch.id === target.branchId)?.headNodeId, 42);
    assert.equal(latest.getActiveBranchSnapshot().headNodeId, null, '不得移动当前选择的分支头');
    if (change === 'branch') assert.equal(latest.branchManifest.activeBranchId, 'other');
  });
}
