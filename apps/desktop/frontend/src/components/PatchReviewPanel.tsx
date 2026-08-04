import { useEffect, useMemo, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import type { AssistantFileSuggestion } from '../lib/assistant-suggestions';
import { buildPatchHunks, type PatchHunk } from '../lib/patch-hunks';
import { currentMonacoTheme } from '../lib/theme';
import { proseReadingTypography, STORYFORGE_EDITOR_UNICODE_HIGHLIGHT } from './editor/options';

type PatchReviewPanelProps = {
  suggestion: AssistantFileSuggestion;
  // 接受/拒绝这块 diff 是要逐字核对的决策界面：字号跟随编辑器设置、字体用 CJK 2:1 栈避免中英错位。
  editorFontSize: number;
  editorFontFamily: string;
  onAccept: () => void;
  onAcceptHunk: (hunk: PatchHunk) => void;
  onReject: (direction: string) => void;
  onSaveNote: () => void;
  onRetryWithoutKnowledge: (knowledgeId: string, relativePath: string) => void;
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
}: PatchReviewPanelProps) {
  const [expanded, setExpanded] = useState(false);
  // null = 没在否；'' = 展开了输入框但还没写字。
  const [rejectDraft, setRejectDraft] = useState<string | null>(null);
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
    if (rejectDraft === null) return;
    const direction = rejectDraft;
    setRejectDraft(null);
    onReject(direction);
  };

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
      className="border-t border-border bg-panel animate-slide-up-fade flex-shrink-0"
      data-testid="patch-review"
    >
      <div className="px-3 py-2 flex items-start justify-between gap-3">
        <div className="min-w-0" title={traceTitle} data-testid="patch-trace">
          <p className="text-xs font-semibold text-warning">{suggestion.title}</p>
          <p className="mt-1 text-xs text-muted">{suggestion.summary}</p>
          {suggestion.scopeWarning && (
            <p className="mt-1 text-xs text-warning" data-testid="patch-scope-warning">
              ⚠ {suggestion.scopeWarning}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2 text-2xs text-muted" data-testid="patch-meta">
            <span data-testid="patch-file">{suggestion.filePath}</span>
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
                      onClick={() => onRetryWithoutKnowledge(entry.knowledgeId, entry.relativePath)}
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
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setExpanded((value) => !value)}
            data-testid="patch-expand"
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-elevated transition-colors"
          >
            {expanded ? '收起' : '展开'}
          </button>
          <button
            onClick={onAccept}
            data-testid="suggestion-accept"
            className="text-xs px-2.5 py-1 rounded-md bg-accent text-accent-foreground hover:opacity-90 active:opacity-100 transition-opacity"
          >
            接受
          </button>
          <button
            onClick={onSaveNote}
            data-testid="suggestion-note"
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-elevated transition-colors"
          >
            保存旁注
          </button>
          <button
            onClick={() => setRejectDraft((value) => (value === null ? '' : null))}
            data-testid="suggestion-reject"
            className="text-xs px-2.5 py-1 rounded-md text-muted hover:text-foreground hover:bg-elevated transition-colors"
          >
            拒绝
          </button>
        </div>
      </div>
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
              if (event.key === 'Enter') {
                event.preventDefault();
                submitRejection();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setRejectDraft(null);
              }
            }}
            data-testid="patch-reject-input"
            // 问的是「该怎么改」而不是「为什么拒绝」：前者朝向下一版，后者只是归档。
            placeholder="说说该怎么改（回车发出，留空则只否掉这版）"
            className="min-w-0 flex-1 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-foreground transition-colors placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={submitRejection}
            data-testid="patch-reject-confirm"
            className="flex-shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-elevated"
          >
            {rejectDraft.trim() ? '否掉并重来' : '否掉'}
          </button>
        </div>
      )}
      {hunks.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-2xs text-muted">
          {hunks.map((hunk, index) => (
            <button
              key={hunk.id}
              type="button"
              onClick={() => onAcceptHunk(hunk)}
              data-testid="suggestion-accept-hunk"
              className="rounded-md border border-border px-2 py-1 text-foreground transition-colors hover:bg-elevated"
              title={`第 ${hunk.originalStartIndex + 1} 行附近，+${hunk.addedLines} / -${hunk.removedLines}`}
            >
              接受第 {index + 1} 处 · 第 {hunk.originalStartIndex + 1} 行
            </button>
          ))}
        </div>
      )}
      <div
        ref={containerRef}
        data-testid="patch-diff"
        className="border-t border-border w-full"
        style={{ height: expanded ? 420 : 200 }}
      />
    </div>
  );
}
