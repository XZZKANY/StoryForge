'use client';

import type { Diagnostic } from '../../../../../packages/shared/src/diagnostic';

export type ProblemsPanelProps = {
  readonly diagnostics: readonly Diagnostic[];
  readonly onSelectDiagnostic?: (diagnostic: Diagnostic) => void;
  readonly onQuickFix?: (diagnostic: Diagnostic) => void;
};

export function ProblemsPanel({ diagnostics, onSelectDiagnostic, onQuickFix }: ProblemsPanelProps) {
  if (diagnostics.length === 0) {
    return <p className="text-sm text-stone-300">当前没有诊断问题</p>;
  }
  return (
    <section aria-label="Problems Panel">
      <h2 className="mb-2 font-semibold">Problems</h2>
      <ul className="space-y-2">
        {diagnostics.map((diagnostic) => (
          <li key={diagnostic.id} className="rounded border border-stone-700 p-2">
            <button
              type="button"
              onClick={() => onSelectDiagnostic?.(diagnostic)}
              className="block w-full text-left"
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
