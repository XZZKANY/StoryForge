import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { writeReceiptAudit } from '../src/lib/writeback-audit';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
const request = {
  operationKey: 'p:whole',
  source: 'p',
  path: 'D:/Book/chapter.md',
  content: 'after',
};
const applied = {
  operationId: 'a'.repeat(64),
  state: 'applied',
  current: 'after',
  checkpointTimestamp: 1,
  createdFile: false,
  receiptPersisted: true,
};
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  delete window.__STORYFORGE_MOCK_FS__;
});
describe('native receipt/audit IPC seam', () => {
  it('passes canonical audit identity, never a caller-selected audit path', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await TauriFileSystem.createWritebackAudit('D:/Book', applied.operationId, 'envelope');
    expect(invoke).toHaveBeenCalledWith('create_writeback_audit', {
      projectRoot: 'D:/Book',
      operationId: applied.operationId,
      content: 'envelope',
    });
    await expect(
      TauriFileSystem.createWritebackAudit('D:/Book', '../escape', 'bad'),
    ).rejects.toThrow(/operationId/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('validates the response for both receipt commands and preserves unreadable', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...applied, current: 'unreadable' });
    expect((await TauriFileSystem.inspectWritebackReceipt('D:/Book', request))?.current).toBe(
      'unreadable',
    );
    vi.mocked(invoke).mockResolvedValueOnce({ ...applied, state: 'future_success' });
    await expect(
      TauriFileSystem.writeFileWithReceipt('D:/Book', request, { kind: 'missing' }, null),
    ).rejects.toThrow(/回执/);
  });
  it('does not convert native sync failure to success by reading cached bytes', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('sync failed'));
    await expect(
      writeReceiptAudit(
        'D:/Book',
        'D:/Book/.storyforge/author-loop/' + applied.operationId + '.md',
        applied.operationId,
        'payload',
        'body',
      ),
    ).rejects.toThrow('sync failed');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.mocked(invoke).mock.calls[0][0]).toBe('create_writeback_audit');
  });
});


it('reads an audit only through Native identity and a project-scoped read, without mutation', async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce({relativePath: 'chapter.md', operationId: applied.operationId, fingerprint: 'b'.repeat(64)})
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce('stored envelope');
  expect(await TauriFileSystem.readWritebackAudit('D:/Book', request)).toEqual({operationId: applied.operationId, content: 'stored envelope'});
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ['describe_writeback_operation', {projectRoot: 'D:/Book', request}],
    ['path_exists', {path: `D:/Book/.storyforge/author-loop/${applied.operationId}.md`}],
    ['read_project_file', {projectRoot: 'D:/Book', path: `D:/Book/.storyforge/author-loop/${applied.operationId}.md`}],
  ]);
});
