'use client';

import { useCallback, useMemo, useState } from 'react';

export type JudgeIssueDecision = 'accepted' | 'rejected' | 'pending';

export type JudgeIssue = {
  id: string;
  severity: '高' | '中' | '低';
  location: string;
  message: string;
  detail?: string;
};

export type JudgeIssueListProps = {
  issues: JudgeIssue[];
  onDecisionsChange?: (decisions: Record<string, JudgeIssueDecision>) => void;
  onNotesChange?: (notes: Record<string, string>) => void;
};

const severityClassName: Record<JudgeIssue['severity'], string> = {
  高: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100',
  中: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  低: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100',
};

const decisionLabel: Record<JudgeIssueDecision, string> = {
  accepted: '已接受',
  rejected: '已拒绝',
  pending: '未决',
};

export function JudgeIssueList({ issues, onDecisionsChange, onNotesChange }: JudgeIssueListProps) {
  const [decisions, setDecisions] = useState<Record<string, JudgeIssueDecision>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const applyDecisions = useCallback(
    (next: Record<string, JudgeIssueDecision>) => {
      setDecisions(next);
      onDecisionsChange?.(next);
    },
    [onDecisionsChange],
  );

  const applyNotes = useCallback(
    (next: Record<string, string>) => {
      setNotes(next);
      onNotesChange?.(next);
    },
    [onNotesChange],
  );

  const toggleSelected = useCallback((issueId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((issueId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }, []);

  const handleBulkDecision = useCallback(
    (decision: JudgeIssueDecision) => {
      if (selected.size === 0) {
        return;
      }
      const next = { ...decisions };
      for (const issueId of selected) {
        next[issueId] = decision;
      }
      applyDecisions(next);
    },
    [applyDecisions, decisions, selected],
  );

  const handleSingleDecision = useCallback(
    (issueId: string, decision: JudgeIssueDecision) => {
      applyDecisions({ ...decisions, [issueId]: decision });
    },
    [applyDecisions, decisions],
  );

  const handleNoteChange = useCallback(
    (issueId: string, note: string) => {
      applyNotes({ ...notes, [issueId]: note });
    },
    [applyNotes, notes],
  );

  const allSelected = useMemo(
    () => issues.length > 0 && issues.every((issue) => selected.has(issue.id)),
    [issues, selected],
  );

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(issues.map((issue) => issue.id)));
    }
  }, [allSelected, issues]);

  if (issues.length === 0) {
    return <p>暂无评审问题。</p>;
  }

  return (
    <section aria-labelledby="judge-issue-title" data-testid="judge-issue-list">
      <h2 id="judge-issue-title">评审问题</h2>
      <div
        className="mb-3 flex flex-wrap items-center gap-2"
        role="toolbar"
        aria-label="批量评审操作"
      >
        <button
          type="button"
          onClick={handleSelectAll}
          className="rounded border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          {allSelected ? '取消全选' : '全选'}
        </button>
        <span className="text-sm text-stone-600 dark:text-stone-400">
          已选 {selected.size} / {issues.length}
        </span>
        <button
          type="button"
          onClick={() => handleBulkDecision('accepted')}
          disabled={selected.size === 0}
          className="rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:enabled:bg-emerald-700 disabled:opacity-50"
        >
          批量接受
        </button>
        <button
          type="button"
          onClick={() => handleBulkDecision('rejected')}
          disabled={selected.size === 0}
          className="rounded bg-rose-600 px-3 py-1 text-sm font-semibold text-white hover:enabled:bg-rose-700 disabled:opacity-50"
        >
          批量拒绝
        </button>
      </div>
      <ul>
        {issues.map((issue) => {
          const isExpanded = expanded.has(issue.id);
          const isSelected = selected.has(issue.id);
          const decision = decisions[issue.id] ?? 'pending';
          return (
            <li
              key={issue.id}
              data-testid={`judge-issue-${issue.id}`}
              className="mb-2 rounded border border-stone-200 p-3 dark:border-stone-700"
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelected(issue.id)}
                  aria-label={`选择问题 ${issue.id}`}
                />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${severityClassName[issue.severity]}`}
                    >
                      严重级别：{issue.severity}
                    </span>
                    <span className="text-sm text-stone-600 dark:text-stone-400">
                      位置：{issue.location}
                    </span>
                    <span
                      className="text-sm font-semibold"
                      data-testid={`judge-issue-decision-${issue.id}`}
                    >
                      {decisionLabel[decision]}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(issue.id)}
                      className="ml-auto text-sm underline"
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? '收起' : '展开详情'}
                    </button>
                  </div>
                  <p className="mt-1">{issue.message}</p>
                  {isExpanded ? (
                    <div className="mt-2 space-y-2">
                      {issue.detail ? (
                        <p className="text-sm text-stone-700 dark:text-stone-300">{issue.detail}</p>
                      ) : null}
                      <label className="block text-sm">
                        批注
                        <textarea
                          value={notes[issue.id] ?? ''}
                          onChange={(event) => handleNoteChange(issue.id, event.target.value)}
                          rows={2}
                          className="mt-1 block w-full rounded border border-stone-300 p-1 text-sm dark:border-stone-700 dark:bg-stone-900"
                          aria-label={`问题 ${issue.id} 的批注`}
                        />
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleSingleDecision(issue.id, 'accepted')}
                          className="rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-700"
                        >
                          接受
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSingleDecision(issue.id, 'rejected')}
                          className="rounded bg-rose-600 px-3 py-1 text-sm font-semibold text-white hover:bg-rose-700"
                        >
                          拒绝
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSingleDecision(issue.id, 'pending')}
                          className="rounded border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                        >
                          复位为未决
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
