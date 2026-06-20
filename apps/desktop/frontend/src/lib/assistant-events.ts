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
    window.dispatchEvent(new CustomEvent<AssistantFileSuggestion>(APPLY_FILE_SUGGESTION_EVENT, {
      detail: suggestion,
    }));
  }
}

export function emitAcceptCurrentFileSuggestion(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT));
  }
}

export function emitFileSuggestionRequest(request: FileSuggestionRequest): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<FileSuggestionRequest>(REQUEST_FILE_SUGGESTION_EVENT, {
      detail: request,
    }));
  }
}

export function emitSuggestionResult(result: SuggestionResult): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SuggestionResult>(SUGGESTION_RESULT_EVENT, {
      detail: result,
    }));
  }
}

export function emitAuthorLoopResult(result: AuthorLoopResult): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<AuthorLoopResult>(AUTHOR_LOOP_RESULT_EVENT, {
      detail: result,
    }));
  }
}
