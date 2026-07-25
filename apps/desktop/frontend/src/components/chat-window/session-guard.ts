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
