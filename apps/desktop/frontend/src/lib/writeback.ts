/**
 * 写回顺序契约的纯核心：把「取快照 → 写盘 → 记录闭环」的次序与守卫从 React hook 中抽出，
 * 便于行为测试直接证伪。F27：快照失败必须阻断写回，绝不在没有安全网时落盘。
 */

export type WritebackSnapshot = { timestamp: number };

export type GuardedWritebackEffects<TRecord> = {
  /** 内容有变时先取写前快照；抛出即向上传播、write/record 不再执行（F27）。 */
  snapshot: () => Promise<WritebackSnapshot | null>;
  /** 快照成功后推进分支头。 */
  advanceBranchHead: (timestamp: number) => Promise<void>;
  /** 落盘写入目标文件。 */
  write: () => Promise<void>;
  /** 写盘成功后记录 author-loop 闭环。 */
  record: () => Promise<TRecord>;
};

/**
 * 内容有变 → 先成功快照（并推进分支头）→ 写盘 → 记录闭环。
 * 快照 reject 直接向上抛出，write 与 record 都不执行——快照失败即阻断写回。
 */
export async function performGuardedWriteback<TRecord>(
  contentChanged: boolean,
  effects: GuardedWritebackEffects<TRecord>,
): Promise<TRecord> {
  if (contentChanged) {
    const snapshot = await effects.snapshot();
    if (snapshot) await effects.advanceBranchHead(snapshot.timestamp);
  }
  await effects.write();
  return effects.record();
}
