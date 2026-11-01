import { describe, expect, it, vi } from 'vitest';
import { DiskDriftError } from '../src/lib/host-file-errors';
import { performReceiptedWriteback } from '../src/lib/writeback-receipts';
import { decodeWritebackReceipt, type WritebackReceipt } from '../src/lib/writeback-receipt-types';

const applied: WritebackReceipt = {
  operationId: 'a'.repeat(64),
  state: 'applied',
  current: 'after',
  checkpointTimestamp: 7,
  createdFile: false,
  receiptPersisted: true,
};
function effects(receipt: WritebackReceipt | null = null) {
  return {
    inspect: vi.fn(async () => receipt),
    validate: vi.fn(),
    snapshot: vi.fn(async () => ({ timestamp: 7 })),
    advanceBranchHead: vi.fn(async () => {}),
    write: vi.fn(async () => applied),
    settle: vi.fn(),
    record: vi.fn(async (_receipt: WritebackReceipt) => ({ recordPath: 'receipt.md' })),
  };
}
describe('persistent receipt recovery boundary', () => {
  it('reports written with audit pending rather than throwing an apply failure', async () => {
    const fx = effects();
    fx.record.mockRejectedValueOnce(new Error('audit disk full'));
    const result = await performReceiptedWriteback(true, fx);
    expect(result.receipt.state).toBe('applied');
    expect(result.auditError).toContain('audit disk full');
    expect(fx.settle).toHaveBeenCalledOnce();
    expect(fx.write).toHaveBeenCalledOnce();
  });
  it('fresh caller repairs audit from persisted applied receipt without snapshot or apply', async () => {
    const fx = effects(applied);
    const result = await performReceiptedWriteback(true, fx);
    expect(result.recovered).toBe(true);
    expect(fx.validate).not.toHaveBeenCalled();
    expect(fx.snapshot).not.toHaveBeenCalled();
    expect(fx.write).not.toHaveBeenCalled();
    expect(fx.record).toHaveBeenCalledWith(applied);
  });
  it('reconciles lost native ack only from applied receipt', async () => {
    const fx = effects();
    fx.inspect.mockResolvedValueOnce(null).mockResolvedValueOnce(applied);
    fx.write.mockRejectedValueOnce(new Error('IPC response lost'));
    expect((await performReceiptedWriteback(true, fx)).recovered).toBe(true);
    expect(fx.write).toHaveBeenCalledOnce();
  });
  it('unknown intent never repeats mutation even when bytes equal after', async () => {
    const fx = effects({ ...applied, state: 'outcome_unknown' });
    await expect(performReceiptedWriteback(true, fx)).rejects.toThrow(/结果未知/);
    expect(fx.snapshot).not.toHaveBeenCalled();
    expect(fx.write).not.toHaveBeenCalled();
    expect(fx.record).not.toHaveBeenCalled();
  });
  it('snapshot failure remains a hard pre-write gate', async () => {
    const fx = effects();
    fx.snapshot.mockRejectedValueOnce(new Error('snapshot failed'));
    await expect(performReceiptedWriteback(true, fx)).rejects.toThrow('snapshot failed');
    expect(fx.write).not.toHaveBeenCalled();
  });
  it('recovered changed file is never overwritten or used to settle a stale buffer', async () => {
    const fx = effects({ ...applied, current: 'diverged' });
    const result = await performReceiptedWriteback(true, fx);
    expect(result.receipt.current).toBe('diverged');
    expect(fx.write).not.toHaveBeenCalled();
    expect(fx.settle).not.toHaveBeenCalled();
    expect(fx.record).toHaveBeenCalledOnce();
  });
});

describe('receipt IPC validation', () => {
  it.each([
    { state: 'future_state' },
    { state: ['applied'] },
    { current: ['after'] },
    { operationId: '../unsafe' },
    { checkpointTimestamp: NaN },
    { receiptPersisted: 'yes' },
  ])('fails closed before record/settle for malformed receipt %j', async (invalid) => {
    const fx = effects({ ...applied, ...invalid } as unknown as WritebackReceipt);
    await expect(performReceiptedWriteback(true, fx)).rejects.toThrow(/回执/);
    expect(fx.settle).not.toHaveBeenCalled();
    expect(fx.record).not.toHaveBeenCalled();
    expect(fx.write).not.toHaveBeenCalled();
  });
  it('keeps known applied but unreadable target separate from current-buffer success', async () => {
    const fx = effects({ ...applied, current: 'unreadable' });
    const result = await performReceiptedWriteback(true, fx);
    expect(result.receipt.state).toBe('applied');
    expect(fx.settle).not.toHaveBeenCalled();
    expect(fx.write).not.toHaveBeenCalled();
  });
});

describe('已写入正文的缓存专用恢复', () => {
  it('恢复回执时只修复缓存，不派发正文或再次快照', async () => {
    const fx = {
      ...effects({ ...applied, detail: 'canon 派生缓存未失效: locked' }),
      repairCaches: vi.fn(async () => ({ ...applied, current: 'diverged' as const })),
    };
    const result = await performReceiptedWriteback(true, fx);
    expect(result.receipt.detail).toBeUndefined();
    expect(result.receipt.current).toBe('diverged');
    expect(fx.repairCaches).toHaveBeenCalledOnce();
    expect(fx.write).not.toHaveBeenCalled();
    expect(fx.snapshot).not.toHaveBeenCalled();
    expect(fx.settle).not.toHaveBeenCalled();
  });
  it('缓存修复失败仍保留 applied 与警告，不报告正文失败或重放', async () => {
    const fx = {
      ...effects({ ...applied, detail: 'canon 派生缓存未失效: locked' }),
      repairCaches: vi.fn(async () => {
        throw new Error('still locked');
      }),
    };
    const result = await performReceiptedWriteback(true, fx);
    expect(result.receipt.state).toBe('applied');
    expect(result.receipt.detail).toContain('canon 派生缓存未失效');
    expect(fx.write).not.toHaveBeenCalled();
    expect(fx.record).toHaveBeenCalledOnce();
  });
  it('按 detailKind 认缓存未失效，不看 detail 文字', async () => {
    const fx = {
      ...effects({ ...applied, detail: 'locked', detailKind: 'canon-cache-stale' }),
      repairCaches: vi.fn(async () => applied),
    };
    const result = await performReceiptedWriteback(true, fx);
    expect(fx.repairCaches).toHaveBeenCalledOnce();
    expect(result.receipt).toEqual(applied);
  });
});

describe('回执里的失败类别', () => {
  const notWritten: WritebackReceipt = {
    ...applied,
    state: 'not_written',
    current: 'diverged',
    detail: 'drift before rename',
  };
  const rejection = (fx: ReturnType<typeof effects>) =>
    performReceiptedWriteback(true, fx).then(
      () => {
        throw new Error('应当被拒');
      },
      (error: unknown) => error,
    );

  it('新写入当场返回漂移回执：翻成 DiskDriftError，文字照旧带上', async () => {
    const fx = effects();
    fx.write.mockResolvedValueOnce({ ...notWritten, detailKind: 'drift' });
    const error = await rejection(fx);
    expect(error).toBeInstanceOf(DiskDriftError);
    expect((error as Error).message).toBe(
      '上次写入被拒绝，文件没有改动；请重新读取并生成修订。drift before rename',
    );
    expect(fx.record).not.toHaveBeenCalled();
  });
  it('恢复出落盘的漂移回执：同样是 DiskDriftError，不再写', async () => {
    const fx = effects({ ...notWritten, detailKind: 'drift' });
    expect(await rejection(fx)).toBeInstanceOf(DiskDriftError);
    expect(fx.write).not.toHaveBeenCalled();
  });
  it('其余被拒（没有类别）仍是普通错误', async () => {
    const error = await rejection(effects(notWritten));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DiskDriftError);
  });
  it('旧回执没有 detailKind：读回执时按旧前缀认一次', () => {
    const drift = '磁盘内容已变化，已拒绝覆盖；请重新读取并处理冲突: D:\\book\\chapter.md';
    expect(decodeWritebackReceipt({ ...notWritten, detail: drift }).detailKind).toBe('drift');
    expect(
      decodeWritebackReceipt({ ...applied, detail: 'canon 派生缓存未失效: locked' }).detailKind,
    ).toBe('canon-cache-stale');
    expect(decodeWritebackReceipt(notWritten).detailKind).toBeUndefined();
  });
  it('没有要补的类别时原样返回同一个回执', () => {
    for (const receipt of [applied, notWritten, { ...notWritten, detailKind: 'drift' as const }])
      expect(decodeWritebackReceipt(receipt)).toBe(receipt);
  });
  it('认不出的 detailKind 当回执无效', async () => {
    const fx = effects({ ...applied, detailKind: 'future' } as unknown as WritebackReceipt);
    await expect(performReceiptedWriteback(true, fx)).rejects.toThrow(/回执/);
    expect(fx.record).not.toHaveBeenCalled();
  });
});
