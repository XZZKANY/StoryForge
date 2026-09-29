import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { applyKnowledgePatch } from '../src/lib/project/knowledge-writeback';
import type { ApiKnowledgeProposalPatch } from '../src/lib/api/contracts';

const effects = vi.hoisted(() => ({
  snapshot: vi.fn(async () => ({ timestamp: 1, created: false })),
  record: vi.fn(async () => ({ recordPath: null, updatedBlueprintPath: null })),
  resolve: vi.fn(async () => ({})),
}));
vi.mock('../src/lib/versions', async (load) => ({
  ...(await load<typeof import('../src/lib/versions')>()),
  snapshotBeforeWrite: effects.snapshot,
}));
vi.mock('../src/lib/author-loop', () => ({ recordRevisionLoop: effects.record }));
vi.mock('../src/lib/api/knowledge-proposals', () => ({
  resolveKnowledgeProposal: effects.resolve,
}));
const FILE = 'D:/Book/setting.md';
const patch: ApiKnowledgeProposalPatch = {
  id: 'kp1',
  artifact_id: 1,
  kind: 'project_knowledge',
  patch_class: 'project_knowledge',
  proposal_id: 'proposal',
  proposal_revision: 1,
  knowledge_id: 'knowledge',
  author_confirmation_event_id: 'confirmed',
  file_path: FILE,
  relative_path: 'setting.md',
  before: 'original',
  after: 'revised',
  baseline_hash: 'baseline',
  requires_confirmation: true,
  created_by_tool: 'knowledge.propose',
};
let disk: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks();
  disk = new Map([[FILE, 'original']]);
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => disk.has(path),
    readFile: (path) => {
      const content = disk.get(path);
      if (content === undefined) throw new Error('missing');
      return content;
    },
    writeFile: (path, content) => {
      disk.set(path, content);
    },
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.__STORYFORGE_MOCK_FS__;
});

it('knowledge proposal does not accept or record after drift during snapshot', async () => {
  effects.snapshot.mockImplementationOnce(async () => {
    disk.set(FILE, 'external edit');
    return { timestamp: 1, created: false };
  });
  await expect(applyKnowledgePatch('D:/Book', patch)).rejects.toThrow(/磁盘内容已变化/);
  expect(disk.get(FILE)).toBe('external edit');
  expect(effects.record).not.toHaveBeenCalled();
  expect(effects.resolve).not.toHaveBeenCalled();
});

it('knowledge missing-to-empty write snapshots nonexistence and resolves only after write', async () => {
  disk.delete(FILE);
  await expect(applyKnowledgePatch('D:/Book', { ...patch, before: '', after: '' })).resolves.toBe(
    'written',
  );
  expect(disk.get(FILE)).toBe('');
  expect(effects.snapshot).toHaveBeenCalledOnce();
  expect(effects.record).toHaveBeenCalledOnce();
  expect(effects.resolve).toHaveBeenCalledOnce();
});
it('knowledge record failure retries audit from the durable receipt without another apply', async () => {
  effects.record.mockRejectedValueOnce(new Error('record unavailable'));
  await expect(applyKnowledgePatch('D:/Book', patch)).rejects.toThrow(/已写入.*闭环记录未完成/);
  expect(disk.get(FILE)).toBe('revised');
  expect(effects.resolve).not.toHaveBeenCalled();
  await expect(applyKnowledgePatch('D:/Book', patch)).resolves.toBe('reconciled');
  expect(effects.snapshot).toHaveBeenCalledOnce();
  expect(effects.record).toHaveBeenCalledTimes(2);
  expect(effects.resolve).toHaveBeenCalledOnce();
});

it('lost accepted-resolution response does not take another snapshot or rewrite the file', async () => {
  effects.resolve.mockRejectedValueOnce(new Error('ack lost'));
  await expect(applyKnowledgePatch('D:/Book', patch)).rejects.toThrow(/已写入.*确认回执未收到/);
  await expect(applyKnowledgePatch('D:/Book', patch)).resolves.toBe('reconciled');
  expect(effects.snapshot).toHaveBeenCalledOnce();
  expect(disk.get(FILE)).toBe('revised');
});

it('public knowledge recovery inspects applied/unreadable before reading and only repairs audit', async () => {
  const write = vi.spyOn(TauriFileSystem, 'writeFileWithReceipt');
  effects.record.mockRejectedValueOnce(new Error('audit unavailable'));
  await expect(applyKnowledgePatch('D:/Book', patch)).rejects.toThrow(/已写入.*闭环记录未完成/);
  const applied = await write.mock.results[0].value;
  expect(applied.state).toBe('applied');
  expect(applied.receiptPersisted).toBe(true);
  // Native inspect retains the durable outcome when its target read fails.
  const inspect = vi
    .spyOn(TauriFileSystem, 'inspectWritebackReceipt')
    .mockResolvedValue({ ...applied, current: 'unreadable' });
  const read = vi.spyOn(TauriFileSystem, 'readProjectFile').mockRejectedValue(new Error('EACCES'));

  await expect(applyKnowledgePatch('D:/Book', patch)).rejects.toThrow(/已写入.*无法读取核对/);
  expect(inspect).toHaveBeenCalledOnce();
  expect(read).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledOnce();
  expect(effects.snapshot).toHaveBeenCalledOnce();
  expect(effects.record).toHaveBeenCalledTimes(2);
  expect(effects.resolve).not.toHaveBeenCalled();
  expect(disk.get(FILE)).toBe('revised');

  inspect.mockRestore();
  read.mockRestore();
  await expect(applyKnowledgePatch('D:/Book', patch)).resolves.toBe('reconciled');
  expect(write).toHaveBeenCalledOnce();
  expect(effects.snapshot).toHaveBeenCalledOnce();
  expect(effects.resolve).toHaveBeenCalledOnce();
});

it('public knowledge recovery keeps unknown/unreadable blocked without reading or repeating effects', async () => {
  const write = vi.spyOn(TauriFileSystem, 'writeFileWithReceipt');
  await expect(applyKnowledgePatch('D:/Book', patch)).resolves.toBe('written');
  const applied = await write.mock.results[0].value;
  const inspect = vi.spyOn(TauriFileSystem, 'inspectWritebackReceipt').mockResolvedValue({
    ...applied,
    state: 'outcome_unknown',
    current: 'unreadable',
    receiptPersisted: false,
  });
  const read = vi.spyOn(TauriFileSystem, 'readProjectFile').mockRejectedValue(new Error('EACCES'));
  effects.record.mockClear();
  effects.resolve.mockClear();

  await expect(applyKnowledgePatch('D:/Book', patch)).rejects.toThrow(/结果未知/);
  expect(inspect).toHaveBeenCalledOnce();
  expect(read).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledOnce();
  expect(effects.snapshot).toHaveBeenCalledOnce();
  expect(effects.record).not.toHaveBeenCalled();
  expect(effects.resolve).not.toHaveBeenCalled();
  expect(disk.get(FILE)).toBe('revised');
});

it('new knowledge operation inspects first but a failed raw read still blocks every write effect', async () => {
  const inspect = vi.spyOn(TauriFileSystem, 'inspectWritebackReceipt');
  const read = vi.spyOn(TauriFileSystem, 'readProjectFile').mockRejectedValue(new Error('EACCES'));
  const write = vi.spyOn(TauriFileSystem, 'writeFileWithReceipt');

  await expect(applyKnowledgePatch('D:/Book', patch)).rejects.toThrow('EACCES');
  expect(inspect).toHaveBeenCalledOnce();
  expect(inspect.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]);
  expect(write).not.toHaveBeenCalled();
  expect(effects.snapshot).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
  expect(effects.resolve).not.toHaveBeenCalled();
  expect(disk.get(FILE)).toBe('original');
});

it('lazy knowledge read retains exact raw CRLF as the native write baseline', async () => {
  disk.set(FILE, 'original\r\n');
  const write = vi.spyOn(TauriFileSystem, 'writeFileWithReceipt');
  await expect(applyKnowledgePatch('D:/Book', { ...patch, before: 'original\n' })).resolves.toBe(
    'written',
  );
  expect(write.mock.calls[0][2]).toEqual({ kind: 'content', content: 'original\r\n' });
  expect(effects.snapshot).toHaveBeenCalledWith(
    'D:/Book',
    FILE,
    'original\r\n',
    expect.any(Object),
  );
  expect(disk.get(FILE)).toBe('revised');
});
