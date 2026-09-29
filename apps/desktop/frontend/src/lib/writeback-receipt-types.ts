/** Desktop-native receipt contract. Manuscript effects are never retried from byte equality. */
export type WritebackRequest = {
  operationKey: string;
  /** Immutable proposal identity/content, separate from the mutable disk baseline. */
  source: string;
  path: string;
  content: string;
};

export type WritebackReceipt = {
  operationId: string;
  state: 'applied' | 'not_written' | 'outcome_unknown';
  current: 'before' | 'after' | 'missing' | 'diverged' | 'unreadable';
  checkpointTimestamp: number | null;
  createdFile: boolean;
  /** False after a successful write whose applied marker could not be flushed. */
  receiptPersisted: boolean;
  detail?: string;
};

/** Decode the native IPC boundary; a new/invalid state must never mean applied. */
export function decodeWritebackReceipt(value: unknown): WritebackReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('写回回执格式无效，结果未知；请核对文件与版本');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.operationId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.operationId) ||
    typeof record.state !== 'string' ||
    !['applied', 'not_written', 'outcome_unknown'].includes(record.state) ||
    typeof record.current !== 'string' ||
    !['before', 'after', 'missing', 'diverged', 'unreadable'].includes(record.current) ||
    !(
      record.checkpointTimestamp === null ||
      (typeof record.checkpointTimestamp === 'number' &&
        Number.isSafeInteger(record.checkpointTimestamp) &&
        record.checkpointTimestamp >= 0)
    ) ||
    typeof record.createdFile !== 'boolean' ||
    typeof record.receiptPersisted !== 'boolean' ||
    !(record.detail === undefined || typeof record.detail === 'string')
  )
    throw new Error('写回回执字段无效，结果未知；已禁止自动重复写入');
  return record as WritebackReceipt;
}
