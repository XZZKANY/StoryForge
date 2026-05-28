import type { Diagnostic } from '../../../../../../packages/shared/src/diagnostic';

export type JudgeIssueDecoration = {
  readonly from: number;
  readonly to: number;
  readonly className: string;
  readonly diagnosticId: string;
};

export function createJudgeIssueDecorations(
  diagnostics: readonly Diagnostic[],
): JudgeIssueDecoration[] {
  return diagnostics.map((diagnostic) => ({
    from: diagnostic.range.start,
    to: diagnostic.range.end,
    className: `ide-diagnostic-${diagnostic.severity}`,
    diagnosticId: diagnostic.id,
  }));
}
