/**
 * F26 会话切换竞争的纯守卫：作者在一轮 run 进行中切到别的会话后，旧 run 的终态
 * （强切回旧会话 / 追加助手消息 / 发补丁建议）绝不能污染当前会话。
 *
 * 判据是「run 起跑时所属的会话是否仍是当前活动会话」。ChatWindow 未按会话 key 重挂，
 * 在飞的异步闭包会跨会话存活，故终态写回前必须显式比对会话身份。
 */
export function conversationKey(sessionId: number | null, draftNonce: string): string {
  return sessionId !== null ? `saved:${sessionId}` : `draft:${draftNonce}`;
}

export function isRunResultForActiveSession(
  activeConversationKey: string,
  runConversationKey: string,
): boolean {
  return activeConversationKey === runConversationKey;
}
