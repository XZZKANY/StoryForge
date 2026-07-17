/**
 * 中间 AI 交互区的轻量事件桥
 * 中间 AI 交互区的轻量事件桥。
 */

import type { AssistantFileSuggestion } from './assistant-suggestions';

export const EXPORT_CURRENT_FILE_EVENT = 'storyforge:export-current-file';
export const APPLY_FILE_SUGGESTION_EVENT = 'storyforge:apply-file-suggestion';
export const ACCEPT_CURRENT_FILE_SUGGESTION_EVENT = 'storyforge:accept-current-file-suggestion';
export const SUGGESTION_RESULT_EVENT = 'storyforge:suggestion-result';
export const AUTHOR_LOOP_RESULT_EVENT = 'storyforge:author-loop-result';
export const REQUEST_SAVE_ACTIVE_FILE_EVENT = 'storyforge:request-save-active-file';
export const SAVE_ACTIVE_FILE_DONE_EVENT = 'storyforge:save-active-file-done';
export const REVIEW_ISSUES_EVENT = 'storyforge:review-issues';
// Q3a：编辑区工具行收进 EditorTabs「…」菜单后，历史/分支视图这类编辑器内部态用命令事件驱动
// （保存走 REQUEST_SAVE、导出走 EXPORT_CURRENT_FILE，无需新事件）。
export const REQUEST_EDITOR_COMMAND_EVENT = 'storyforge:request-editor-command';

export type EditorCommand = 'toggle-history' | 'toggle-branch-view';

export function emitEditorCommand(command: EditorCommand): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<{ command: EditorCommand }>(REQUEST_EDITOR_COMMAND_EVENT, {
        detail: { command },
      }),
    );
  }
}

// 观测镜实体联动：编辑器光标行变化（去抖）广播行文本，观测侧按实体表面形匹配亮卡。
export const EDITOR_CURSOR_LINE_EVENT = 'storyforge:editor-cursor-line';

export type EditorCursorLineDetail = {
  filePath: string | null;
  lineText: string;
};

export function emitEditorCursorLine(detail: EditorCursorLineDetail): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<EditorCursorLineDetail>(EDITOR_CURSOR_LINE_EVENT, { detail }),
    );
  }
}

// 状态栏字数：编辑器内容 / 选区变化去抖广播非空白字符数（网文计字口径）。
export const EDITOR_TEXT_METRICS_EVENT = 'storyforge:editor-text-metrics';

export type EditorTextMetricsDetail = {
  filePath: string | null;
  charCount: number;
  selectionCharCount: number;
};

export function emitEditorTextMetrics(detail: EditorTextMetricsDetail): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<EditorTextMetricsDetail>(EDITOR_TEXT_METRICS_EVENT, { detail }),
    );
  }
}

// 观测面板点行定位原文：App 打开目标文件后广播，Editor 等模型加载完成再消费（行号 / snippet 锚）。
export const LOCATE_IN_EDITOR_EVENT = 'storyforge:locate-in-editor';

export type LocateInEditorDetail = {
  filePath: string;
  line?: number;
  snippet?: string;
};

export function emitLocateInEditor(detail: LocateInEditorDetail): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<LocateInEditorDetail>(LOCATE_IN_EDITOR_EVENT, { detail }));
  }
}

export type SaveActiveFileStatus = 'saved' | 'skipped' | 'error';

export type SaveActiveFileDoneDetail = {
  filePath: string | null;
  status: SaveActiveFileStatus;
  message?: string;
};

export type ActiveEditorFlushFailureReason = 'timeout' | 'error';

export class ActiveEditorFlushError extends Error {
  constructor(
    readonly reason: ActiveEditorFlushFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'ActiveEditorFlushError';
  }
}

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

export function emitExportCurrentFile(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EXPORT_CURRENT_FILE_EVENT));
  }
}

/**
 * 最近一条未被编辑器消费的补丁建议。
 * Agent 补丁可能指向未打开（甚至尚不存在）的文件：事件发出时目标编辑器还没就绪，
 * 先缓冲在这里，等 App 自动打开目标文件、编辑器加载完成后再领取。
 */
let pendingFileSuggestion: AssistantFileSuggestion | null = null;

export function emitFileSuggestion(suggestion: AssistantFileSuggestion): void {
  pendingFileSuggestion = suggestion;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<AssistantFileSuggestion>(APPLY_FILE_SUGGESTION_EVENT, {
        detail: suggestion,
      }),
    );
  }
}

/** 编辑器就绪后领取指向该文件的待处理补丁建议（一次性，领取即清空）。 */
export function takePendingFileSuggestion(filePath: string | null): AssistantFileSuggestion | null {
  if (!filePath || !pendingFileSuggestion || pendingFileSuggestion.filePath !== filePath) {
    return null;
  }
  const suggestion = pendingFileSuggestion;
  pendingFileSuggestion = null;
  return suggestion;
}

export function emitAcceptCurrentFileSuggestion(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT));
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

/**
 * 审稿/修订读盘前调用：请活动编辑器把未保存改动落盘，确保后端读到的是用户当前看到的内容。
 * 超时或保存失败会 reject，调用方必须停止读盘，避免 Agent 基于旧稿继续工作。
 */
export function flushActiveEditorToDisk(filePath: string, timeoutMs = 2000): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener(SAVE_ACTIVE_FILE_DONE_EVENT, onDone);
      callback();
    };
    const onDone = (event: Event) => {
      const detail = (event as CustomEvent<SaveActiveFileDoneDetail>).detail;
      if (detail && detail.filePath && detail.filePath !== filePath) return;
      if (detail?.status === 'error') {
        finish(() =>
          reject(
            new ActiveEditorFlushError(
              'error',
              detail.message || '活动编辑器保存失败，已停止发送给 Agent。',
            ),
          ),
        );
        return;
      }
      finish(resolve);
    };
    const timer = window.setTimeout(
      () =>
        finish(() =>
          reject(
            new ActiveEditorFlushError(
              'timeout',
              `活动编辑器在 ${timeoutMs}ms 内没有确认保存，已停止发送给 Agent。`,
            ),
          ),
        ),
      timeoutMs,
    );
    window.addEventListener(SAVE_ACTIVE_FILE_DONE_EVENT, onDone);
    window.dispatchEvent(
      new CustomEvent<{ filePath: string }>(REQUEST_SAVE_ACTIVE_FILE_EVENT, {
        detail: { filePath },
      }),
    );
  });
}
