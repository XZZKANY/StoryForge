import { useEffect, useMemo, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import type { AssistantFileSuggestion } from '../lib/assistant-suggestions';
import { buildPatchHunks, type PatchHunk } from '../lib/patch-hunks';

type PatchReviewPanelProps = {
  suggestion: AssistantFileSuggestion;
  onAccept: () => void;
  onAcceptHunk: (hunk: PatchHunk) => void;
  onReject: () => void;
  onSaveNote: () => void;
};

type DiffStats = {
  addedLines: number;
  removedLines: number;
};

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
  onAccept,
  onAcceptHunk,
  onReject,
  onSaveNote,
}: PatchReviewPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const stats = useMemo(
    () => diffStats(suggestion.before, suggestion.after),
    [suggestion.before, suggestion.after],
  );
  const hunks = useMemo(
    () => buildPatchHunks(suggestion.before, suggestion.after),
    [suggestion.before, suggestion.after],
  );

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
      theme: 'vs-dark',
      minimap: { enabled: false },
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      lineNumbers: 'off',
      folding: false,
      fontSize: 12,
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

  return (
    <div
      className="border-b border-border bg-surface animate-slide-up-fade flex-shrink-0"
      data-testid="patch-review"
    >
      <div className="px-3 py-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-warning">{suggestion.title}</p>
          <p className="mt-1 text-xs text-muted">{suggestion.summary}</p>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted">
            <span data-testid="patch-id">Patch {suggestion.id}</span>
            <span>{suggestion.filePath}</span>
            <span>
              +{stats.addedLines} / -{stats.removedLines}
            </span>
            {suggestion.model && <span>{suggestion.model}</span>}
            {suggestion.assistantSessionId && <span>Session {suggestion.assistantSessionId}</span>}
            {suggestion.issueIds?.length ? <span>{suggestion.issueIds.join(', ')}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setExpanded((value) => !value)}
            data-testid="patch-expand"
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-foreground/10 transition-colors"
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
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-foreground/10 transition-colors"
          >
            保存旁注
          </button>
          <button
            onClick={onReject}
            data-testid="suggestion-reject"
            className="text-xs px-2.5 py-1 rounded-md text-muted hover:text-foreground hover:bg-foreground/10 transition-colors"
          >
            拒绝
          </button>
        </div>
      </div>
      {hunks.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted">
          {hunks.map((hunk, index) => (
            <button
              key={hunk.id}
              type="button"
              onClick={() => onAcceptHunk(hunk)}
              data-testid="suggestion-accept-hunk"
              className="rounded-md border border-border px-2 py-1 text-foreground transition-colors hover:bg-foreground/10"
              title={`第 ${hunk.originalStartIndex + 1} 行附近，+${hunk.addedLines} / -${hunk.removedLines}`}
            >
              接受块 {index + 1}
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
