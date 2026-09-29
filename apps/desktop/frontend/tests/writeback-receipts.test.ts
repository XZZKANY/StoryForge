import { describe, expect, it, vi } from 'vitest';
import { performReceiptedWriteback } from '../src/lib/writeback-receipts';
import type { WritebackReceipt } from '../src/lib/writeback-receipt-types';

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
