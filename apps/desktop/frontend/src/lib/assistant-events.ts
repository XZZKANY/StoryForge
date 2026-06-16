/**
 * 中间 AI 交互区的轻量事件桥
 * 命令面板等触发"审查当前文件"时，通过此事件通知 Composer 预填输入并发起。
 */

import type { AssistantFileSuggestion } from './assistant-suggestions';

export const REVIEW_CURRENT_EVENT = 'storyforge:review-current-file';
export const APPLY_FILE_SUGGESTION_EVENT = 'storyforge:apply-file-suggestion';
export const REQUEST_FILE_SUGGESTION_EVENT = 'storyforge:request-file-suggestion';
export const SUGGESTION_RESULT_EVENT = 'storyforge:suggestion-result';

export type FileSuggestionRequest = {
  filePath: string;
  userIntent: string;
};

export type SuggestionResult = {
  filePath: string;
  status: 'ready' | 'error';
  message: string;
};

export function emitReviewCurrentFile(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REVIEW_CURRENT_EVENT));
  }
}

export function emitFileSuggestion(suggestion: AssistantFileSuggestion): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<AssistantFileSuggestion>(APPLY_FILE_SUGGESTION_EVENT, {
      detail: suggestion,
    }));
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
