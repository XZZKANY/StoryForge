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
  /** 给作者看的文字；界面判断一律看 detailKind。 */
  detail?: string;
  detailKind?: WritebackDetailKind;
};

/**
 * 回执 detail 的类别（宿主 `fs_writeback_receipts.rs` 的 `DetailKind`），其余失败没有：
 * canon-cache-stale 是正文已写入、canon 派生缓存没清掉；drift 是登记写入后撞上磁盘漂移、没写进去。
 */
export type WritebackDetailKind = 'canon-cache-stale' | 'drift';
const DETAIL_KINDS: readonly unknown[] = ['canon-cache-stale', 'drift'];

// 加 detailKind 之前写下的回执只有 detail 文字，读回执时按当时的前缀认一次；别处一律只看 detailKind。
function legacyDetailKind(detail: string): WritebackDetailKind | undefined {
  if (detail.startsWith('canon 派生缓存未失效: ')) return 'canon-cache-stale';
  if (detail.startsWith('磁盘内容已变化，已拒绝覆盖')) return 'drift';
  return undefined;
}

/** Decode the native IPC boundary; a new/invalid state must never mean applied. */
export function decodeWritebackReceipt(value: unknown): WritebackReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('写入回执格式无效，结果未知；请核对文件与版本');
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
    !(record.detail === undefined || typeof record.detail === 'string') ||
    !(record.detailKind === undefined || DETAIL_KINDS.includes(record.detailKind))
  )
    throw new Error('写入回执字段无效，结果未知；已禁止自动重复写入');
  const receipt = record as WritebackReceipt;
  if (receipt.detailKind !== undefined || receipt.detail === undefined) return receipt;
  const detailKind = legacyDetailKind(receipt.detail);
  return detailKind === undefined ? receipt : { ...receipt, detailKind };
}

/** Read-only Native description, not approval, admission, or proof of writeback. */
export type WritebackIdentity = {
  relativePath: string;
  operationId: string;
  fingerprint: string;
};

export function decodeWritebackIdentity(value: unknown): WritebackIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('写入操作身份格式无效');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.relativePath !== 'string' ||
    /[\\:]/.test(record.relativePath) ||
    record.relativePath.includes('\0') ||
    record.relativePath.split('/').some((part) => ['', '.', '..'].includes(part)) ||
    typeof record.operationId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.operationId) ||
    typeof record.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.fingerprint) ||
    Object.keys(record).some((key) => !['relativePath', 'operationId', 'fingerprint'].includes(key))
  ) {
    throw new Error('写入操作身份字段无效');
  }
  return {
    relativePath: record.relativePath,
    operationId: record.operationId,
    fingerprint: record.fingerprint,
  };
}
