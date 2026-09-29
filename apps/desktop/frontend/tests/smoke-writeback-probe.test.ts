import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(() => true), invoke: vi.fn() }));
vi.mock('../src/lib/api-client', () => ({
  getApiConfig: vi.fn(async () => ({ baseUrl: 'http://fixture.invalid', apiKey: 'synthetic' })),
}));

import { TauriFileSystem, type DiskBaseline } from '../src/lib/tauri-fs';
import type { WritebackReceipt, WritebackRequest } from '../src/lib/writeback-receipt-types';
import '../src/lib/smoke';

const controller = window.__STORYFORGE_SMOKE__!;
const projectRoot = 'C:/isolated-smoke';
const request: WritebackRequest = {
  operationKey: 'synthetic-operation',
  source: 'synthetic-proposal',
  path: `${projectRoot}/chapter.md`,
  content: 'synthetic manuscript body must not appear in probe snapshots',
};
const expected: DiskBaseline = { kind: 'content', content: 'original\r\n' };
const applied: WritebackReceipt = {
  operationId: 'a'.repeat(64),
  state: 'applied',
  current: 'after',
  checkpointTimestamp: 123,
  createdFile: false,
  receiptPersisted: true,
};
const write = () => TauriFileSystem.writeFileWithReceipt(projectRoot, request, expected, 123);

beforeEach(() => {
  controller.restoreWritebackProbe?.();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(applied);
  delete window.__STORYFORGE_MOCK_FS__;
});

afterEach(() => {
  controller.restoreWritebackProbe?.();
  vi.restoreAllMocks();
  delete window.__STORYFORGE_MOCK_FS__;
});

describe('explicit native smoke writeback probe', () => {
  it('does not install automatically or observe ordinary calls', async () => {
    const before = controller.getWritebackProbeSnapshot();
    await expect(write()).resolves.toBe(applied);
    expect(controller.getWritebackProbeSnapshot()).toEqual(before);
  });

  it('rejects browser and mock filesystem installation without wrapping methods', () => {
    const original = TauriFileSystem.writeFileWithReceipt;
    vi.mocked(isTauri).mockReturnValue(false);
    expect(controller.installWritebackProbe('observe')).toEqual({
      installed: false,
      reason: 'tauri_runtime_required',
    });
    vi.mocked(isTauri).mockReturnValue(true);
    window.__STORYFORGE_MOCK_FS__ = {};
    expect(controller.installWritebackProbe('drop-first-write-reply')).toEqual({
      installed: false,
      reason: 'mock_filesystem_active',
    });
    expect(TauriFileSystem.writeFileWithReceipt).toBe(original);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects an invalid mode arriving through the untyped smoke script boundary', () => {
    const original = TauriFileSystem.writeFileWithReceipt;
    expect(Reflect.apply(controller.installWritebackProbe, controller, ['unknown'])).toEqual({
      installed: false,
      reason: 'invalid_mode',
    });
    expect(TauriFileSystem.writeFileWithReceipt).toBe(original);
  });

  it('delegates all original arguments and receiver, awaits native calls, and exposes only counts', async () => {
    const writeSpy = vi.spyOn(TauriFileSystem, 'writeFileWithReceipt');
    const inspectSpy = vi.spyOn(TauriFileSystem, 'inspectWritebackReceipt');
    const auditSpy = vi.spyOn(TauriFileSystem, 'createWritebackAudit');
    expect(controller.installWritebackProbe('observe')).toEqual({ installed: true });
    let finish!: (value: WritebackReceipt) => void;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let settled = false;
    const pending = write().then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(applied);
    await expect(pending).resolves.toBe(applied);
    await expect(TauriFileSystem.inspectWritebackReceipt(projectRoot, request)).resolves.toBe(
      applied,
    );
    await TauriFileSystem.createWritebackAudit(projectRoot, applied.operationId, 'synthetic audit');
    expect(writeSpy).toHaveBeenCalledExactlyOnceWith(projectRoot, request, expected, 123);
    expect(inspectSpy).toHaveBeenCalledExactlyOnceWith(projectRoot, request);
    expect(auditSpy).toHaveBeenCalledExactlyOnceWith(
      projectRoot,
      applied.operationId,
      'synthetic audit',
    );
    expect(writeSpy.mock.calls[0][1]).toBe(request);
    expect(writeSpy.mock.calls[0][2]).toBe(expected);
    for (const spy of [writeSpy, inspectSpy, auditSpy]) {
      expect(spy.mock.contexts[0]).toBe(TauriFileSystem);
    }
    expect(invoke).toHaveBeenNthCalledWith(1, 'write_file_with_receipt', {
      projectRoot,
      request,
      expected,
      checkpointTimestamp: 123,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'inspect_writeback_receipt', {
      projectRoot,
      request,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'create_writeback_audit', {
      projectRoot,
      operationId: applied.operationId,
      content: 'synthetic audit',
    });
    expect(controller.getWritebackProbeSnapshot()).toEqual({
      writes: 1,
      inspections: 1,
      audits: 1,
      dropped: 0,
    });
    const snapshot = controller.getWritebackProbeSnapshot();
    snapshot.writes = 999;
    expect(controller.getWritebackProbeSnapshot().writes).toBe(1);
  });

  it('drops exactly one persisted applied reply, after the real write completes', async () => {
    controller.installWritebackProbe('drop-first-write-reply');
    await expect(write()).rejects.toThrow('STORYFORGE_SMOKE_WRITE_REPLY_DROPPED');
    expect(invoke).toHaveBeenCalledTimes(1);
    await expect(TauriFileSystem.inspectWritebackReceipt(projectRoot, request)).resolves.toBe(
      applied,
    );
    await expect(write()).resolves.toBe(applied);
    expect(controller.getWritebackProbeSnapshot()).toEqual({
      writes: 2,
      inspections: 1,
      audits: 0,
      dropped: 1,
    });
  });

  it('drops only the first successful reply even when native writes settle out of order', async () => {
    controller.installWritebackProbe('drop-first-write-reply');
    const finishes: Array<(value: WritebackReceipt) => void> = [];
    vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => finishes.push(resolve)));
    const pending = Promise.allSettled([write(), write()]);
    finishes[1](applied);
    finishes[0](applied);
    const results = await pending;
    expect(results[0]).toEqual({ status: 'fulfilled', value: applied });
    expect(results[1]).toEqual({
      status: 'rejected',
      reason: new Error('STORYFORGE_SMOKE_WRITE_REPLY_DROPPED'),
    });
    expect(controller.getWritebackProbeSnapshot()).toEqual({
      writes: 2,
      inspections: 0,
      audits: 0,
      dropped: 1,
    });
  });

  it.each([
    { ...applied, state: 'not_written' as const, current: 'before' as const },
    { ...applied, state: 'outcome_unknown' as const },
    { ...applied, receiptPersisted: false },
  ])(
    'does not consume the drop for unconfirmed receipt $state/$receiptPersisted',
    async (receipt) => {
      controller.installWritebackProbe('drop-first-write-reply');
      vi.mocked(invoke).mockResolvedValueOnce(receipt);
      await expect(write()).resolves.toBe(receipt);
      expect(controller.getWritebackProbeSnapshot().dropped).toBe(0);
      await expect(write()).rejects.toThrow('STORYFORGE_SMOKE_WRITE_REPLY_DROPPED');
      expect(controller.getWritebackProbeSnapshot().dropped).toBe(1);
    },
  );

  it('preserves native rejection and does not consume the drop on failure', async () => {
    const failure = new Error('native guard rejected drift');
    controller.installWritebackProbe('drop-first-write-reply');
    vi.mocked(invoke).mockRejectedValueOnce(failure);
    await expect(write()).rejects.toBe(failure);
    expect(controller.getWritebackProbeSnapshot()).toEqual({
      writes: 1,
      inspections: 0,
      audits: 0,
      dropped: 0,
    });
    await expect(write()).rejects.toThrow('STORYFORGE_SMOKE_WRITE_REPLY_DROPPED');
  });

  it('preserves inspection null/errors and audit errors', async () => {
    controller.installWritebackProbe('observe');
    const failure = new Error('native receipt storage unavailable');
    vi.mocked(invoke)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure);
    await expect(TauriFileSystem.inspectWritebackReceipt(projectRoot, request)).resolves.toBeNull();
    await expect(TauriFileSystem.inspectWritebackReceipt(projectRoot, request)).rejects.toBe(
      failure,
    );
    await expect(
      TauriFileSystem.createWritebackAudit(projectRoot, applied.operationId, 'audit'),
    ).rejects.toBe(failure);
    expect(controller.getWritebackProbeSnapshot()).toEqual({
      writes: 0,
      inspections: 2,
      audits: 1,
      dropped: 0,
    });
  });

  it('rejects duplicate installation without resetting counts or nesting wrappers', async () => {
    controller.installWritebackProbe('observe');
    const wrapper = TauriFileSystem.writeFileWithReceipt;
    await write();
    expect(controller.installWritebackProbe('drop-first-write-reply')).toEqual({
      installed: false,
      reason: 'already_installed',
    });
    expect(TauriFileSystem.writeFileWithReceipt).toBe(wrapper);
    await expect(write()).resolves.toBe(applied);
    expect(controller.getWritebackProbeSnapshot()).toEqual({
      writes: 2,
      inspections: 0,
      audits: 0,
      dropped: 0,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('restores exact originals, preserves final counts, and permits a fresh explicit installation', async () => {
    const originals = [
      TauriFileSystem.writeFileWithReceipt,
      TauriFileSystem.inspectWritebackReceipt,
      TauriFileSystem.createWritebackAudit,
    ];
    controller.installWritebackProbe('observe');
    await write();
    expect(controller.restoreWritebackProbe()).toEqual({
      writes: 1,
      inspections: 0,
      audits: 0,
      dropped: 0,
    });
    expect([
      TauriFileSystem.writeFileWithReceipt,
      TauriFileSystem.inspectWritebackReceipt,
      TauriFileSystem.createWritebackAudit,
    ]).toEqual(originals);
    await expect(write()).resolves.toBe(applied);
    expect(controller.getWritebackProbeSnapshot().writes).toBe(1);
    expect(controller.installWritebackProbe('observe')).toEqual({ installed: true });
    expect(controller.getWritebackProbeSnapshot()).toEqual({
      writes: 0,
      inspections: 0,
      audits: 0,
      dropped: 0,
    });
  });

  it('restore disables a pending reply drop without cancelling the underlying write', async () => {
    controller.installWritebackProbe('drop-first-write-reply');
    let finish!: (value: WritebackReceipt) => void;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = write();
    controller.restoreWritebackProbe();
    finish(applied);
    await expect(pending).resolves.toBe(applied);
    expect(controller.getWritebackProbeSnapshot()).toEqual({
      writes: 1,
      inspections: 0,
      audits: 0,
      dropped: 0,
    });
  });
});
