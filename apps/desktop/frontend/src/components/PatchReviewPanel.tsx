import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import type { AssistantFileSuggestion } from '../lib/assistant-suggestions';
import { isEditableTarget } from '../lib/browser-guards';
import { buildPatchHunks, type PatchHunk } from '../lib/patch-hunks';
import { currentMonacoTheme } from '../lib/theme';
import { proseReadingTypography, STORYFORGE_EDITOR_UNICODE_HIGHLIGHT } from './editor/options';

type PatchReviewPanelProps = {
  suggestion: AssistantFileSuggestion;
  // 接受/拒绝这块 diff 是要逐字核对的决策界面：字号跟随编辑器设置、字体用 CJK 2:1 栈避免中英错位。
  editorFontSize: number;
  editorFontFamily: string;
  actionKind?: PatchAction | null;
  error?: string | null;
  onAccept: () => void | Promise<void>;
  onAcceptHunk: (hunk: PatchHunk) => void | Promise<void>;
  onReject: (direction: string) => void | Promise<void>;
  onSaveNote: () => void | Promise<void>;
  onRetryWithoutKnowledge: (knowledgeId: string, relativePath: string) => void | Promise<void>;
};

type PatchAction = 'accept' | 'hunk' | 'reject' | 'note' | 'retry';

const PATCH_ACTION_LABELS: Record<PatchAction, string> = {
  accept: '接受',
  hunk: '接受修改块',
  reject: '拒绝',
  note: '保存旁注',
  retry: '重试',
};

type DiffStats = {
  addedLines: number;
  removedLines: number;
};

/** 工程追溯字段仅进 title/tooltip，主行不展示。 */
export function buildPatchReviewTraceTitle(suggestion: AssistantFileSuggestion): string {
  const parts = [`补丁 ${suggestion.id}`];
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

function diffStats(before: string, after: string): DiffStats {
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

export function PatchReviewPanel({
  suggestion,
  editorFontSize,
  editorFontFamily,
  onAccept,
  onAcceptHunk,
  onReject,
  onSaveNote,
  onRetryWithoutKnowledge,
  actionKind = null,
  error = null,
}: PatchReviewPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [rejection, setRejection] = useState<{
    suggestion: AssistantFileSuggestion;
    draft: string | null;
  } | null>(null);
  const rejectDraft = rejection?.suggestion === suggestion ? rejection.draft : null;
  const setRejectDraft = (value: string | null | ((previous: string | null) => string | null)) => {
    setRejection({ suggestion, draft: typeof value === 'function' ? value(rejectDraft) : value });
  };
  const [localAction, setLocalAction] = useState<{
    suggestion: AssistantFileSuggestion;
    kind: PatchAction;
  } | null>(null);
  const [localError, setLocalError] = useState<{
    suggestion: AssistantFileSuggestion;
    message: string;
  } | null>(null);
  const actionState =
    actionKind ?? (localAction?.suggestion === suggestion ? localAction.kind : null);
  const actionError = error ?? (localError?.suggestion === suggestion ? localError.message : null);
  const actionInFlightRef = useRef<{ kind: PatchAction; token: symbol } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const actionBusy = actionState !== null;

  useLayoutEffect(
    () => () => {
      actionInFlightRef.current = null;
    },
    [suggestion],
  );

  const runAction = useCallback(
    (kind: PatchAction, action: () => void | Promise<void>) => {
      if (actionKind || actionInFlightRef.current) return;
      const token = Symbol(kind);
      actionInFlightRef.current = { kind, token };
      setLocalError(null);
      setLocalAction({ suggestion, kind });
      const finish = () => {
        if (actionInFlightRef.current?.token !== token) return;
        actionInFlightRef.current = null;
        setLocalAction(null);
      };
      const fail = (error: unknown) => {
        if (actionInFlightRef.current?.token !== token) return;
        setLocalError({
          suggestion,
          message: error instanceof Error ? error.message : String(error),
        });
      };
      try {
        const result = action();
        if (result && typeof result.then === 'function') {
          void result.catch(fail).finally(finish);
        } else {
          finish();
        }
      } catch (error) {
        fail(error);
        finish();
      }
    },
    [actionKind, suggestion],
  );

  const stats = useMemo(
    () => diffStats(suggestion.before, suggestion.after),
    [suggestion.before, suggestion.after],
  );
  const hunks = useMemo(
    () => buildPatchHunks(suggestion.before, suggestion.after),
    [suggestion.before, suggestion.after],
  );
  const traceTitle = useMemo(() => buildPatchReviewTraceTitle(suggestion), [suggestion]);

  // 发出即收起：面板通常随补丁一起消失，但同一实例换下一个补丁时不该还留着上一条草稿。
  const submitRejection = () => {
    if (rejectDraft === null || actionBusy || actionInFlightRef.current) return;
    const direction = rejectDraft;
    const clearSubmittedDraft = () =>
      setRejection((current) =>
        current?.suggestion === suggestion && current.draft === direction ? null : current,
      );
    runAction('reject', () => {
      const result = onReject(direction);
      if (result && typeof result.then === 'function') return result.then(clearSubmittedDraft);
      clearSubmittedDraft();
    });
  };

  // 快捷键：只在当前可见补丁的操作区接管；编辑器、Composer、设置等文本目标不抢键。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.defaultPrevented
      )
        return;
      if (actionBusy) return;
      if (event.isComposing || isEditableTarget(event.target)) return;
      const panel = panelRef.current;
      const target = event.target;
      if (
        !panel ||
        !(target instanceof Element) ||
        !panel.contains(target) ||
        panel.closest('[hidden], .hidden, [inert], [aria-hidden="true"]') ||
        !target.closest(
          '[role="group"][aria-label="补丁操作"], [role="group"][aria-label="补丁分块操作"]',
        )
      ) {
        return;
      }
      switch (event.key.toLowerCase()) {
        case 'y':
          event.preventDefault();
          runAction('accept', onAccept);
          break;
        case 'n':
          event.preventDefault();
          setRejection((previous) => ({
            suggestion,
            draft: previous?.suggestion === suggestion && previous.draft !== null ? null : '',
          }));
          break;
        case 'e':
          event.preventDefault();
          setExpanded((value) => !value);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actionBusy, onAccept, runAction, suggestion]);

  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);

  // 挂载期创建只读内联 diff 编辑器；suggestion 变化时只更新 model 内容，不销毁重建（保留滚动位置）。
  useEffect(() => {
    if (!containerRef.current) return;
    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      readOnly: true,
      renderSideBySide: false,
      automaticLayout: true,
      theme: currentMonacoTheme(),
      minimap: { enabled: false },
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      lineNumbers: 'off',
      folding: false,
      ...proseReadingTypography(editorFontSize, editorFontFamily),
      unicodeHighlight: STORYFORGE_EDITOR_UNICODE_HIGHLIGHT,
    });
    const original = monaco.editor.createModel(suggestion.before, 'markdown');
    const modified = monaco.editor.createModel(suggestion.after, 'markdown');
    diffEditor.setModel({ original, modified });
    diffEditorRef.current = diffEditor;
    originalModelRef.current = original;
    modifiedModelRef.current = modified;
    return () => {
      diffEditor.dispose();
      original.dispose();
      modified.dispose();
      diffEditorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载期一次性创建 diff 编辑器；before/after 后续变化由下方 effect 同步到 model，避免销毁重建
  }, []);

  // 同一面板实例上换了新补丁时，只刷新两个 model 的内容。
  useEffect(() => {
    if (originalModelRef.current && originalModelRef.current.getValue() !== suggestion.before) {
      originalModelRef.current.setValue(suggestion.before);
    }
    if (modifiedModelRef.current && modifiedModelRef.current.getValue() !== suggestion.after) {
      modifiedModelRef.current.setValue(suggestion.after);
    }
  }, [suggestion.before, suggestion.after]);

  // 展开/收起改变容器高度后，立即让 Monaco 重新布局。
  useEffect(() => {
    diffEditorRef.current?.layout();
  }, [expanded]);

  // diff 编辑器挂载期一次性创建（保留滚动位置），字号/字体设置变化时 updateOptions 追平。
  useEffect(() => {
    diffEditorRef.current?.updateOptions(proseReadingTypography(editorFontSize, editorFontFamily));
  }, [editorFontSize, editorFontFamily]);

  return (
    <div
      ref={panelRef}
      className={
        expanded
          ? 'absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden bg-panel'
          : 'flex max-h-[70%] min-h-0 flex-shrink-0 flex-col overflow-hidden border-t border-border bg-panel animate-slide-up-fade'
      }
      data-review-expanded={expanded}
      onKeyDown={(event) => {
        if (
          expanded &&
          event.key === 'Escape' &&
          !event.nativeEvent.isComposing &&
          !isEditableTarget(event.target)
        ) {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
          panelRef.current
            ?.querySelector<HTMLButtonElement>('[data-testid="patch-expand"]')
            ?.focus();
        }
      }}
      data-testid="patch-review"
    >
      <div className="min-h-0 shrink overflow-y-auto" data-testid="patch-controls">
        <div className="px-3 py-2 flex flex-wrap items-start justify-between gap-3">
          <div
            className="min-w-0 flex-1 basis-64 break-words"
            title={traceTitle}
            data-testid="patch-trace"
          >
            <p className="text-xs font-semibold text-warning">{suggestion.title}</p>
            <p className="mt-1 text-xs text-muted">{suggestion.summary}</p>
            {suggestion.scopeWarning && (
              <p className="mt-1 text-xs text-warning" data-testid="patch-scope-warning">
                ⚠ {suggestion.scopeWarning}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-2 text-2xs text-muted" data-testid="patch-meta">
              <span className="break-all" data-testid="patch-file">
                {suggestion.filePath}
              </span>
              <span data-testid="patch-stats">
                +{stats.addedLines} / -{stats.removedLines}
              </span>
            </div>
            {suggestion.knowledgeEntries && suggestion.knowledgeEntries.length > 0 && (
              <div className="mt-2" data-testid="patch-knowledge-context">
                <p className="text-2xs text-muted">本轮实际使用知识</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {suggestion.knowledgeEntries.map((entry) => (
                    <span
                      key={entry.knowledgeId}
                      className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border px-1.5 py-1 text-2xs text-foreground"
                    >
                      <span
                        className="truncate"
                        title={`${entry.relativePath} · ${entry.knowledgeId}`}
                      >
                        {entry.relativePath}
                      </span>
                      <span className="text-muted">
                        {entry.selectionSource === 'author_pinned' ? '已固定' : '相关检索'}
                        {entry.evidenceState === 'stale' ? ' · 来源待复核' : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          runAction('retry', () =>
                            onRetryWithoutKnowledge(entry.knowledgeId, entry.relativePath),
                          )
                        }
                        disabled={actionBusy}
                        className="text-accent hover:underline"
                        data-testid="patch-knowledge-retry"
                      >
                        移除并重试
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div
            className="ml-auto flex max-w-full flex-wrap items-center gap-2"
            role="group"
            aria-label="补丁操作"
          >
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              data-testid="patch-expand"
              aria-expanded={expanded}
              title={`${expanded ? '退出审阅 · Esc' : '专注审阅'} · Ctrl E`}
              className="h-7 rounded-md border border-border px-2.5 text-xs hover:bg-elevated transition-colors"
            >
              {expanded ? '退出审阅' : '专注审阅'}
            </button>
            <button
              type="button"
              onClick={() => runAction('accept', onAccept)}
              data-testid="suggestion-accept"
              title="接受 · Ctrl Y"
              disabled={actionBusy}
              className="h-7 rounded-md bg-accent px-2.5 text-xs text-accent-foreground hover:opacity-90 active:opacity-100 transition-opacity"
            >
              接受
            </button>
            <button
              type="button"
              onClick={() => runAction('note', onSaveNote)}
              data-testid="suggestion-note"
              disabled={actionBusy}
              className="h-7 rounded-md border border-border px-2.5 text-xs hover:bg-elevated transition-colors"
            >
              保存旁注
            </button>
            <button
              type="button"
              onClick={() => setRejectDraft((value) => (value === null ? '' : null))}
              data-testid="suggestion-reject"
              aria-expanded={rejectDraft !== null}
              title="拒绝 · Ctrl N"
              disabled={actionBusy}
              className="h-7 rounded-md px-2.5 text-xs text-muted hover:text-foreground hover:bg-elevated transition-colors"
            >
              拒绝
            </button>
          </div>
        </div>
        {(actionState || actionError) && (
          <div
            className={`border-t border-border px-3 py-1.5 text-2xs ${actionError ? 'text-error' : 'text-accent'}`}
            role="status"
            aria-live="polite"
            data-testid="patch-action-status"
          >
            {actionError
              ? `操作失败：${actionError}，可重试`
              : `处理中：${PATCH_ACTION_LABELS[actionState!]}`}
          </div>
        )}
        {rejectDraft !== null && (
          <div
            className="flex items-center gap-2 border-t border-border px-3 py-2"
            data-testid="patch-reject-form"
          >
            <input
              autoFocus
              value={rejectDraft}
              onChange={(event) => setRejectDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitRejection();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setRejectDraft(null);
                }
              }}
              data-testid="patch-reject-input"
              aria-label="修改方向（可选）"
              // 问的是「该怎么改」而不是「为什么拒绝」：前者朝向下一版，后者只是归档。
              placeholder="说说该怎么改（回车发出，留空则只否掉这版）"
              className="min-w-0 flex-1 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-foreground transition-colors placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={submitRejection}
              disabled={actionBusy}
              data-testid="patch-reject-confirm"
              className="flex-shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-elevated"
            >
              {rejectDraft.trim() ? '否掉并重来' : '否掉'}
            </button>
          </div>
        )}
        {hunks.length > 1 && (
          <div
            className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-2xs text-muted"
            role="group"
            aria-label="补丁分块操作"
          >
            {hunks.map((hunk, index) => (
              <button
                key={hunk.id}
                type="button"
                onClick={() => runAction('hunk', () => onAcceptHunk(hunk))}
                data-testid="suggestion-accept-hunk"
                disabled={actionBusy}
                className="rounded-md border border-border px-2 py-1 text-foreground transition-colors hover:bg-elevated"
                title={`第 ${hunk.originalStartIndex + 1} 行附近，+${hunk.addedLines} / -${hunk.removedLines}`}
              >
                接受第 {index + 1} 处 · 第 {hunk.originalStartIndex + 1} 行
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        ref={containerRef}
        data-testid="patch-diff"
        className="min-h-[160px] flex-1 border-t border-border w-full"
        style={{ flexBasis: expanded ? 320 : 200 }}
      />
    </div>
  );
}
