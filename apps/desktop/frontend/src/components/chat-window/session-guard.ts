/**
 * F26 会话切换竞争的纯守卫：作者在一轮 run 进行中切到别的会话后，旧 run 的终态
 * （强切回旧会话 / 追加助手消息 / 发补丁建议）绝不能污染当前会话。
 *
 * 判据是「run 起跑时所属的会话是否仍是当前活动会话」。ChatWindow 未按会话 key 重挂，
 * 在飞的异步闭包会跨会话存活，故终态写回前必须显式比对会话身份。
 */
export function conversationKey(
  projectPath: string | null,
  sessionId: number | null,
  draftNonce: string,
): string {
  // 守卫身份必须含 project 维度：两个草稿态项目（assistantSessionId 均为 null）会共用同一
  // draft nonce，若 key 缺 project 则跨项目切换时 run 结果被误判为「同会话」而写错项目
  // （回复/补丁落进另一个项目，同 seed 模板下甚至污染同名手稿）。UF-04。
  const project = projectPath ?? '';
  return sessionId !== null
    ? `project:${project}|saved:${sessionId}`
    : `project:${project}|draft:${draftNonce}`;
}

export function isRunResultForActiveSession(
  activeConversationKey: string,
  runConversationKey: string,
): boolean {
  return activeConversationKey === runConversationKey;
}

export type RunDispatchIdentity = {
  assistantSessionId: number | null;
  runStartConversationKey: string;
  ownsRun: () => boolean;
  abandonIfTaskMoved: () => boolean;
};

/**
 * 提交入口一次冻结本轮归属：会话 id 定死在这里，payload 与 send 共用同一值，之后不再读实时 ref。
 * 准备期每个 await 后调用 abandonIfTaskMoved：切会话 / 切项目 / 卸载 / 同一 run 被接管都算撤权，
 * 不再发出本轮请求。active() 的 epoch 会把 A→B→A 当作新的 lifetime，不误判回同一任务。
 */
export function createRunDispatchIdentity(input: {
  runId: string;
  active: () => boolean;
  agentRunId: () => string | null;
  projectPath: () => string | null;
  assistantSessionId: () => number | null;
  draftNonce: () => string;
  isClaimedBy: (runId: string) => boolean;
  releaseClaim: (runId: string) => void;
  clearBusy: () => void;
}): RunDispatchIdentity {
  const assistantSessionId = input.assistantSessionId();
  const runStartConversationKey = conversationKey(
    input.projectPath(),
    assistantSessionId,
    input.draftNonce(),
  );
  const ownsRun = () =>
    input.active() &&
    input.agentRunId() === input.runId &&
    conversationKey(input.projectPath(), input.assistantSessionId(), input.draftNonce()) ===
      runStartConversationKey;
  const abandonIfTaskMoved = () => {
    if (ownsRun()) return false;
    // 撤权必须顺带归位 busy，否则切会话后新会话 composer 永远 busy、作者消息被静默排队。
    // 判据是 claim 是否仍属本 run（切会话前进 epoch 会让 active() 为 false，不能拿它当前提）；
    // claim 已被更新的 run 接管时什么都不做，绝不误清新 run 的 busy。
    if (input.isClaimedBy(input.runId)) {
      input.releaseClaim(input.runId);
      input.clearBusy();
    }
    return true;
  };
  return { assistantSessionId, runStartConversationKey, ownsRun, abandonIfTaskMoved };
}
