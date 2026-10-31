import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import {
  associateIssuesToOps,
  summarizeIssueResolutions,
  type IssueResolution,
} from '../../lib/suggestion-ops';
import {
  createSuggestionChangeSet,
  type SuggestionChangeSet,
} from '../../lib/suggestion-change-set';
import type { PendingSuggestionDescriptor } from '../../lib/suggestion-recovery';

export type SuggestionOpState = {
  suggestionId: string;
  readonly changeSet: SuggestionChangeSet;
  appliedOpIds: Set<string>;
  /** 原 Native 撤销回执的派生引用，只区分后续作者重选；不是新的写入真值。 */
  lastUndoOperationId: string | null;
  opIssueIds: Map<string, string[]>;
  recovery: {
    projectPath: string;
    descriptor: PendingSuggestionDescriptor;
    ready: Promise<void>;
  } | null;
};

// 原始操作属于补丁对象而非编辑器 lifetime。缓冲/重新领取/重挂载都沿用同一份状态；
// WeakMap 按对象身份隔离同 id 的新提案，补丁释放后可回收，不新增全局强引用队列。
export const suggestionOperationStates = new WeakMap<AssistantFileSuggestion, SuggestionOpState>();

export function createOperationState(suggestion: AssistantFileSuggestion): SuggestionOpState {
  const changeSet = createSuggestionChangeSet(suggestion.before, suggestion.after);
  return {
    suggestionId: suggestion.id,
    changeSet,
    appliedOpIds: new Set<string>(),
    lastUndoOperationId: null,
    opIssueIds: associateIssuesToOps(changeSet.operations, suggestion.issueScopes ?? []),
    recovery: null,
  };
}

/** 面向作者的行范围覆盖读数，不把机械归属冒充语义复核。 */
export function issueResolutionNote(
  resolutions?: IssueResolution[],
  attributed = true,
  counts = resolutions ? summarizeIssueResolutions(resolutions) : undefined,
): string {
  if (!resolutions || resolutions.length === 0) return '';
  // 问题拿不到行范围时不能报 0/N——那会被读成「一个都没解决」，应显式说明无法归属。
  if (!attributed) return ' · 问题未归属（无行范围），本次不作解决计数';
  if (!counts) return '';
  return ` · 范围覆盖 ${counts.resolved}/${counts.observed}（作者确认 ${counts.authorConfirmed}；未作语义复核）`;
}

export function firstChangedLine(before: string, after: string): number | null {
  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1)
    if (left[index] !== right[index]) return index + 1;
  return null;
}
