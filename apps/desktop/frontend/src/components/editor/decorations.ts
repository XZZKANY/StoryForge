import * as monaco from 'monaco-editor';

import type { ReviewIssueMarker } from '../../lib/assistant-events';

const ISSUE_SEVERITY_COLOR: Record<'high' | 'medium' | 'low', string> = {
  high: '#f87171',
  medium: '#fbbf24',
  low: '#60a5fa',
};

function normalizeIssueSeverity(severity: string): 'high' | 'medium' | 'low' {
  return severity === 'high' || severity === 'low' ? severity : 'medium';
}

// 审稿 issue 只带 evidence 文本、无字符范围；按 evidence 在正文里就近定位一个范围用于打标记。
export function locateEvidence(
  model: monaco.editor.ITextModel,
  evidence: string,
): monaco.IRange | null {
  const cleaned = evidence
    .replace(/\.{3,}$/, '')
    .replace(/^[\s"'「『（(]+|[\s"'」』）)]+$/g, '')
    .trim();
  const candidates = [cleaned, cleaned.slice(0, 40), cleaned.slice(0, 20)];
  for (const candidate of candidates) {
    if (candidate.length < 4) continue;
    const matches = model.findMatches(candidate, false, false, false, null, false, 1);
    if (matches.length > 0) return matches[0].range;
  }
  return null;
}

export function issueDecorationOptions(
  issue: ReviewIssueMarker,
): monaco.editor.IModelDecorationOptions {
  const severity = normalizeIssueSeverity(issue.severity);
  const hover = {
    value: `**[${issue.id}] ${issue.severity}** ${issue.message}\n\n建议：${issue.suggestedAction}`,
  };
  return {
    className: `sf-issue-underline sf-issue-${severity}`,
    glyphMarginClassName: `sf-issue-glyph sf-issue-glyph-${severity}`,
    glyphMarginHoverMessage: hover,
    hoverMessage: hover,
    overviewRuler: {
      color: ISSUE_SEVERITY_COLOR[severity],
      position: monaco.editor.OverviewRulerLane.Right,
    },
  };
}
