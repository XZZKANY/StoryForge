export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';
export type DiagnosticSource = 'judge' | 'memory' | 'context' | 'manual';

export type Diagnostic = {
  readonly id: string;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly source: DiagnosticSource;
  readonly evidence?: readonly { readonly source_ref: string; readonly quote: string }[];
  readonly quickFixes?: readonly {
    readonly command_id: string;
    readonly title: string;
    readonly args: unknown;
  }[];
};

export type JudgeIssueDiagnosticInput = {
  readonly id: number | string;
  readonly scene_id?: number | string;
  readonly category?: string;
  readonly issue_type?: string;
  readonly severity: string;
  readonly span_start?: number;
  readonly span_end?: number;
  readonly summary?: string;
  readonly description?: string;
  readonly evidence_links?: readonly { readonly source_ref?: string; readonly quote?: string }[];
};

export function diagnosticSeverityFromJudge(severity: string): DiagnosticSeverity {
  const normalized = severity.toLowerCase();
  if (normalized === 'blocking' || normalized === 'high') return 'error';
  if (normalized === 'medium') return 'warning';
  if (normalized === 'low') return 'info';
  return 'hint';
}

export function judgeIssueToDiagnostic(issue: JudgeIssueDiagnosticInput): Diagnostic {
  const issueId = typeof issue.id === 'number' ? issue.id : Number(issue.id);
  const sceneId = issue.scene_id === undefined ? undefined : Number(issue.scene_id);
  const code = issue.category ?? issue.issue_type ?? 'judge_issue';
  return {
    id: `judge:${issue.id}`,
    severity: diagnosticSeverityFromJudge(issue.severity),
    code,
    message: issue.summary ?? issue.description ?? code,
    range: { start: issue.span_start ?? 0, end: issue.span_end ?? 0 },
    source: 'judge',
    evidence: (issue.evidence_links ?? []).map((item) => ({
      source_ref: item.source_ref ?? '',
      quote: item.quote ?? '',
    })),
    quickFixes: [
      {
        command_id: 'judge.repair',
        title: '生成定向修复',
        args: { issue_id: Number.isNaN(issueId) ? issue.id : issueId, scene_id: sceneId },
      },
    ],
  };
}
