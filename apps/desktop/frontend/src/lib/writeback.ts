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

/**
 * 写回落盘后往哪结算。
 * - 补丁目标文件的缓冲永远同步（切回来看到的就是已写回的内容，不会以旧 originalContent 误判脏）；
 * - 活动编辑器的 UI 态只在「目标仍是当前前台 model」时才动。
 *
 * WHY：写回是异步的，await 期间作者可能切走页签。按活动 model 无条件结算，
 * 会把 A 文件的内容灌进 B 文件缓冲，随后 autosave 把它落盘——保存红线被一次性击穿。
 */
export function shouldSettleActiveEditor(
  targetPath: string,
  targetModel: object | null,
  activePath: string | null,
  activeModel: object | null,
): boolean {
  return !!targetModel && targetPath === activePath && targetModel === activeModel;
}

/**
 * 落盘任务串行队列：同一编辑器上的保存必须按调用顺序依次完成。
 *
 * WHY：autosave（防抖 900ms）与 Ctrl+S 可各自触发一次保存；两次写盘并发时完成次序不可控，
 * 先取到的旧内容可能在新内容之后落盘，造成静默回退。model 身份守卫只保护 UI 结算，不防写盘乱序。
 * 前一个任务无论成败都放行下一个，否则一次保存失败会永久堵死保存链。
 */
export function createWritebackQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}
