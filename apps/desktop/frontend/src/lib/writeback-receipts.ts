import { DiskDriftError } from './host-file-errors';
import { decodeWritebackReceipt, type WritebackReceipt } from './writeback-receipt-types';
import { performGuardedWriteback, type WritebackSnapshot } from './writeback';

export type ReceiptedWritebackEffects<T> = {
  inspect: () => Promise<WritebackReceipt | null>;
  repairCaches?: () => Promise<WritebackReceipt>;
  validate: () => void;
  snapshot: () => Promise<WritebackSnapshot | null>;
  advanceBranchHead: (timestamp: number) => Promise<void>;
  write: (checkpointTimestamp: number | null) => Promise<WritebackReceipt>;
  settle: (restored: boolean) => void;
  record: (receipt: WritebackReceipt) => Promise<T>;
};
export type ReceiptedWritebackResult<T> = {
  receipt: WritebackReceipt;
  recovered: boolean;
  record: T | null;
  auditError: string | null;
};

function requireApplied(value: WritebackReceipt): WritebackReceipt {
  const receipt = decodeWritebackReceipt(value);
  if (receipt.state === 'outcome_unknown') {
    throw new Error('上次写入结果未知，已禁止重复写入；请核对本地文件与写前版本后重新生成修订');
  }
  if (receipt.state === 'not_written') {
    const message = `上次写入被拒绝，文件没有改动；请重新读取并生成修订。${receipt.detail ?? ''}`;
    // 回执里的漂移拒写与宿主当场报的是同一种错，下游只按 DiskDriftError 判断。
    throw receipt.detailKind === 'drift' ? new DiskDriftError(message) : new Error(message);
  }
  return receipt;
}

/** A persistent native claim, not an in-memory set, owns permission to mutate once. */
export async function performReceiptedWriteback<T>(
  contentChanged: boolean,
  effects: ReceiptedWritebackEffects<T>,
): Promise<ReceiptedWritebackResult<T>> {
  let receipt = await effects.inspect();
  const restored = receipt !== null;
  let recovered = restored;
  if (receipt === null) {
    effects.validate();
    let checkpointTimestamp: number | null = null;
    receipt = await performGuardedWriteback(contentChanged, {
      snapshot: async () => {
        const snapshot = await effects.snapshot();
        checkpointTimestamp = snapshot?.timestamp ?? null;
        return snapshot;
      },
      advanceBranchHead: effects.advanceBranchHead,
      write: async () => {
        try {
          receipt = await effects.write(checkpointTimestamp);
        } catch (error) {
          // The invoke response may be lost after commit. Query, never repeat the write.
          try {
            receipt = await effects.inspect();
          } catch {
            throw new Error(
              '写入请求结果无法核对，正文可能已写入；已禁止自动重复写入，请核对文件与版本',
            );
          }
          if (!receipt) throw error;
          recovered = true;
        }
      },
      record: async () => {
        if (!receipt) throw new Error('写入没有返回可核对的回执');
        return receipt;
      },
    });
  }
  receipt = requireApplied(receipt);
  if (restored && receipt.detailKind === 'canon-cache-stale' && effects.repairCaches) {
    try {
      const repaired = requireApplied(await effects.repairCaches());
      if (repaired.operationId !== receipt.operationId) throw new Error('缓存修复回执身份不匹配');
      receipt = repaired;
    } catch {
      // 缓存修复失败不改变已写入事实，也绝不回退到正文 write。
    }
  }
  if (receipt.current === 'after') effects.settle(restored);
  try {
    return { receipt, recovered, record: await effects.record(receipt), auditError: null };
  } catch (error) {
    // Audit is after mutation: callers must not offer another apply or report "not written".
    return {
      receipt,
      recovered,
      record: null,
      auditError: error instanceof Error ? error.message : String(error),
    };
  }
}
