import type { AgentRun, ChapterBrief } from './types';

export function shouldResetRunPanels(
  nextSessionId: number | null,
  selfPersistedSessionId: number | null,
): boolean {
  return selfPersistedSessionId === null || nextSessionId !== selfPersistedSessionId;
}

/** 切会话/新建会撤掉对话区的待确认入口：补丁待确认（waiting）与章纲待确认。 */
export type PendingDecisionKind = 'patch' | 'brief' | 'both';

export function pendingDecisionOnLeave(
  agentRun: Pick<AgentRun, 'status'> | null,
  chapterBrief: ChapterBrief | null,
): PendingDecisionKind | null {
  const waitingPatch = agentRun?.status === 'waiting';
  const waitingBrief = chapterBrief !== null;
  if (waitingPatch && waitingBrief) return 'both';
  if (waitingPatch) return 'patch';
  if (waitingBrief) return 'brief';
  return null;
}

const PENDING_LABEL: Record<PendingDecisionKind, string> = {
  patch: '修订',
  brief: '章纲',
  both: '修订/章纲',
};

export function leaveSessionConfirmText(
  kind: PendingDecisionKind,
  action: 'switch' | 'new',
): string {
  const actionText = action === 'new' ? '新建会话' : '切换会话';
  return `本轮有未处理的${PENDING_LABEL[kind]}，${actionText}后需在编辑器 diff 里处理。仍要${actionText}吗？`;
}
