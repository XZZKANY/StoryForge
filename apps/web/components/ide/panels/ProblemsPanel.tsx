'use client';

import type { Diagnostic } from '../../../../../packages/shared/src/diagnostic';

export type ProblemsPanelProps = {
  readonly diagnostics: readonly Diagnostic[];
  readonly onSelectDiagnostic?: (diagnostic: Diagnostic) => void;
  readonly onQuickFix?: (diagnostic: Diagnostic) => void;
  readonly windowSize?: number;
};

export function ProblemsPanel({
  diagnostics,
  onSelectDiagnostic,
  onQuickFix,
  windowSize = 80,
}: ProblemsPanelProps) {
  if (diagnostics.length === 0) {
    return <p className="text-sm text-stone-300">当前没有诊断问题</p>;
  }
  const visibleDiagnostics = diagnostics.slice(0, Math.max(0, windowSize));
  return (
    <section
      aria-label="Problems Panel"
      data-total-diagnostics={diagnostics.length}
      data-rendered-diagnostics={visibleDiagnostics.length}
    >
      <h2 className="mb-2 font-semibold">Problems</h2>
      {visibleDiagnostics.length < diagnostics.length ? (
        <p className="mb-2 text-xs text-stone-400">
          仅渲染 {visibleDiagnostics.length} / {diagnostics.length} 条诊断
        </p>
      ) : null}
      <ul className="space-y-2">
        {visibleDiagnostics.map((diagnostic) => (
          <li
            key={diagnostic.id}
            className="rounded border border-stone-700 p-2"
            data-diagnostic-id={diagnostic.id}
            data-range-start={diagnostic.range.start}
            data-range-end={diagnostic.range.end}
          >
            <button
              type="button"
              onClick={() => onSelectDiagnostic?.(diagnostic)}
              className="block w-full text-left"
              data-diagnostic-id={diagnostic.id}
              data-range-start={diagnostic.range.start}
              data-range-end={diagnostic.range.end}
            >
              <span className="mr-2 rounded bg-stone-800 px-2 py-0.5 text-xs">
                {diagnostic.severity}
              </span>
              <span className="mr-2 font-mono text-xs">{diagnostic.code}</span>
              <span>{diagnostic.message}</span>
            </button>
            {diagnostic.quickFixes?.map((fix) => (
              <button
                key={fix.command_id}
                type="button"
                onClick={() => onQuickFix?.(diagnostic)}
                className="mt-2 rounded bg-sky-700 px-2 py-1 text-xs text-white"
                data-command-id={fix.command_id}
                data-command-args={JSON.stringify(fix.args)}
              >
                {fix.title}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
