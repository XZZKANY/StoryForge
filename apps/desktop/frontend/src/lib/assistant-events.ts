/**
 * 中间 AI 交互区的轻量事件桥
 * 命令面板等触发"审查当前文件"时，通过此事件通知 Composer 预填输入并发起。
 */

import type { AssistantFileSuggestion } from './assistant-suggestions';

export const REVIEW_CURRENT_EVENT = 'storyforge:review-current-file';
export const EXPORT_CURRENT_FILE_EVENT = 'storyforge:export-current-file';
export const APPLY_FILE_SUGGESTION_EVENT = 'storyforge:apply-file-suggestion';
export const ACCEPT_CURRENT_FILE_SUGGESTION_EVENT = 'storyforge:accept-current-file-suggestion';
export const REQUEST_FILE_SUGGESTION_EVENT = 'storyforge:request-file-suggestion';
export const SUGGESTION_RESULT_EVENT = 'storyforge:suggestion-result';
export const AUTHOR_LOOP_RESULT_EVENT = 'storyforge:author-loop-result';
export const REQUEST_SAVE_ACTIVE_FILE_EVENT = 'storyforge:request-save-active-file';
export const SAVE_ACTIVE_FILE_DONE_EVENT = 'storyforge:save-active-file-done';
export const REVIEW_ISSUES_EVENT = 'storyforge:review-issues';
export const REVISE_ISSUE_EVENT = 'storyforge:revise-issue';

export type FileSuggestionRequest = {
  filePath: string;
  userIntent: string;
};

export type SuggestionResult = {
  filePath: string;
  status: 'ready' | 'error';
  message: string;
  assistantSessionId?: number | null;
};

export type AuthorLoopResult = {
  filePath: string;
  status: 'completed' | 'error';
  action: 'revision_accepted' | 'exported';
  message: string;
  artifactPath?: string;
  recordPath?: string;
};

export function emitReviewCurrentFile(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REVIEW_CURRENT_EVENT));
  }
}

export function emitExportCurrentFile(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EXPORT_CURRENT_FILE_EVENT));
  }
}

export function emitFileSuggestion(suggestion: AssistantFileSuggestion): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<AssistantFileSuggestion>(APPLY_FILE_SUGGESTION_EVENT, {
        detail: suggestion,
      }),
    );
  }
}

export function emitAcceptCurrentFileSuggestion(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT));
  }
}

export function emitFileSuggestionRequest(request: FileSuggestionRequest): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<FileSuggestionRequest>(REQUEST_FILE_SUGGESTION_EVENT, {
        detail: request,
      }),
    );
  }
}

export function emitSuggestionResult(result: SuggestionResult): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<SuggestionResult>(SUGGESTION_RESULT_EVENT, {
        detail: result,
      }),
    );
  }
}

export function emitAuthorLoopResult(result: AuthorLoopResult): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<AuthorLoopResult>(AUTHOR_LOOP_RESULT_EVENT, {
        detail: result,
      }),
    );
  }
}

/** 审稿 issue 在编辑器内打标记所需的最小字段。 */
export type ReviewIssueMarker = {
  id: string;
  category: string;
  severity: string;
  message: string;
  evidence: string;
  suggestedAction: string;
};

/** 审稿完成后把 issues 推给编辑器渲染内联标记（filePath 用于只标当前文件）。 */
export function emitReviewIssues(filePath: string, issues: ReviewIssueMarker[]): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<{ filePath: string; issues: ReviewIssueMarker[] }>(REVIEW_ISSUES_EVENT, {
        detail: { filePath, issues },
      }),
    );
  }
}

/** 点击编辑器内某个 issue 标记时，请会话面板对该 issue 发起定向修订。 */
export function emitReviseIssue(issueId: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<{ issueId: string }>(REVISE_ISSUE_EVENT, { detail: { issueId } }),
    );
  }
}

/**
 * 审稿/修订读盘前调用：请活动编辑器把未保存改动落盘，确保后端读到的是用户当前看到的内容。
 * 无编辑器响应或超时则放行（读磁盘现状），不阻塞主流程。
 */
export function flushActiveEditorToDisk(filePath: string, timeoutMs = 2000): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener(SAVE_ACTIVE_FILE_DONE_EVENT, onDone);
      resolve();
    };
    const onDone = (event: Event) => {
      const detail = (event as CustomEvent<{ filePath: string | null }>).detail;
      if (detail && detail.filePath && detail.filePath !== filePath) return;
      finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    window.addEventListener(SAVE_ACTIVE_FILE_DONE_EVENT, onDone);
    window.dispatchEvent(
      new CustomEvent<{ filePath: string }>(REQUEST_SAVE_ACTIVE_FILE_EVENT, {
        detail: { filePath },
      }),
    );
  });
}
