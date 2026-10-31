import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import { DiskDriftError } from '../../lib/host-file-errors';

// 补丁审阅面板用到的纯函数：动作名、失败提示、追溯标题、改动行数、圈号。
export type PatchAction = 'accept' | 'hunk' | 'reject' | 'note' | 'retry' | 'undo';

export const PATCH_ACTION_LABELS: Record<PatchAction, string> = {
  undo: '撤销写入',
  accept: '接受',
  hunk: '接受修改块',
  reject: '拒绝',
  note: '保存旁注',
  retry: '重试',
};

// 定位类拒写只取决于补丁和当前稿，再点多少次结果都一样。
const DETERMINISTIC_LOCATE_FAILURE = /无法安全定位|无法唯一确定|插入点前文已变/;

/**
 * P2-D：漂移拒写（DiskDriftError）与定位类拒写直接重试必再撞墙，不应误导作者「可重试」；
 * 定位类给出真能走通的路。普通错误（写盘失败、网络抖动等）才提示可重试。
 */
export function actionFailureText(error: string, cause: unknown): string {
  if (cause instanceof DiskDriftError) return `操作失败：${error}`;
  if (DETERMINISTIC_LOCATE_FAILURE.test(error)) {
    const way = error.startsWith('接受分块失败')
      ? '可以让 AI 重出一版。'
      : '可以让 AI 重出一版，或逐处接受。';
    return `操作失败：${error.replace(/。?$/, '。')}${way}`;
  }
  return `操作失败：${error}，可重试`;
}

type DiffStats = {
  addedLines: number;
  removedLines: number;
};

/** 工程追溯字段仅进 title/tooltip，主行不展示。 */
export function buildPatchReviewTraceTitle(suggestion: AssistantFileSuggestion): string {
  const parts = [`修订 ${suggestion.id}`];
  if (suggestion.assistantSessionId != null) {
    parts.push(`会话 ${suggestion.assistantSessionId}`);
  }
  if (suggestion.model) {
    parts.push(suggestion.model);
  }
  if (suggestion.issueIds?.length) {
    parts.push(suggestion.issueIds.join(', '));
  }
  return parts.join(' · ');
}

export function diffStats(before: string, after: string): DiffStats {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let commonPrefix = 0;
  while (
    commonPrefix < beforeLines.length &&
    commonPrefix < afterLines.length &&
    beforeLines[commonPrefix] === afterLines[commonPrefix]
  ) {
    commonPrefix += 1;
  }
  let commonSuffix = 0;
  while (
    commonSuffix + commonPrefix < beforeLines.length &&
    commonSuffix + commonPrefix < afterLines.length &&
    beforeLines[beforeLines.length - 1 - commonSuffix] ===
      afterLines[afterLines.length - 1 - commonSuffix]
  ) {
    commonSuffix += 1;
  }
  return {
    removedLines: Math.max(0, beforeLines.length - commonPrefix - commonSuffix),
    addedLines: Math.max(0, afterLines.length - commonPrefix - commonSuffix),
  };
}

export function circledNumber(value: number): string {
  return value <= 20 ? String.fromCharCode(0x2460 + value - 1) : `(${value})`;
}
