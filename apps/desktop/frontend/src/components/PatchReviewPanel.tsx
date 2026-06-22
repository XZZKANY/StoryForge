import { useMemo, useState } from 'react';
import type { AssistantFileSuggestion } from '../lib/assistant-suggestions';

type PatchReviewPanelProps = {
  suggestion: AssistantFileSuggestion;
  onAccept: () => void;
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
    commonPrefix < beforeLines.length
    && commonPrefix < afterLines.length
    && beforeLines[commonPrefix] === afterLines[commonPrefix]
  ) {
    commonPrefix += 1;
  }
  let commonSuffix = 0;
  while (
    commonSuffix + commonPrefix < beforeLines.length
    && commonSuffix + commonPrefix < afterLines.length
    && beforeLines[beforeLines.length - 1 - commonSuffix] === afterLines[afterLines.length - 1 - commonSuffix]
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
  onReject,
  onSaveNote,
}: PatchReviewPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const stats = useMemo(() => diffStats(suggestion.before, suggestion.after), [suggestion.before, suggestion.after]);
  return (
    <div className="border-b border-border bg-surface animate-slide-up-fade flex-shrink-0" data-testid="patch-review">
      <div className="px-3 py-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-warning">{suggestion.title}</p>
          <p className="mt-1 text-xs text-muted">{suggestion.summary}</p>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted">
            <span data-testid="patch-id">Patch {suggestion.id}</span>
            <span>{suggestion.filePath}</span>
            <span>+{stats.addedLines} / -{stats.removedLines}</span>
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
            {expanded ? '收起' : '展开全文'}
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
      <div className="grid grid-cols-2 border-t border-border text-xs">
        <DiffColumn title="当前内容" content={suggestion.before} tone="before" expanded={expanded} />
        <DiffColumn title="建议后" content={suggestion.after} tone="after" expanded={expanded} />
      </div>
    </div>
  );
}

function DiffColumn({
  title,
  content,
  tone,
  expanded,
}: {
  title: string;
  content: string;
  tone: 'before' | 'after';
  expanded: boolean;
}) {
  const visibleContent = expanded ? content : content.slice(0, 2400);
  return (
    <div className={`min-w-0 border-r last:border-r-0 border-border ${tone === 'after' ? 'bg-success/[0.06]' : 'bg-error/[0.05]'}`}>
      <div className={`px-3 py-1.5 font-semibold ${tone === 'after' ? 'text-success' : 'text-muted'}`}>
        {title}
      </div>
      <pre className={`${expanded ? 'max-h-96' : 'max-h-40'} overflow-auto whitespace-pre-wrap px-3 pb-3 text-[11px] leading-5 text-foreground`}>
        {visibleContent}
        {!expanded && content.length > 2400 ? '\n...' : ''}
      </pre>
    </div>
  );
}
