import * as monaco from 'monaco-editor';

import type { ReviewIssueMarker } from '../../lib/assistant-events';

// overviewRuler 需要一个具体色值：与 index.css 同取 --issue-* 单一事实源（getComputedStyle 读当前主题的
// 三元 RGB），失活时回退到与深色 token 一致的字面量。这样 css 下划线/圆点与 Monaco 标尺不再各写一份。
const ISSUE_SEVERITY_FALLBACK: Record<'high' | 'medium' | 'low', string> = {
  high: 'rgb(229 91 91)',
  medium: 'rgb(235 201 126)',
  low: 'rgb(146 153 234)',
};

function issueSeverityColor(severity: 'high' | 'medium' | 'low'): string {
  if (typeof document === 'undefined') return ISSUE_SEVERITY_FALLBACK[severity];
  const triple = getComputedStyle(document.documentElement)
    .getPropertyValue(`--issue-${severity}`)
    .trim();
  return triple ? `rgb(${triple})` : ISSUE_SEVERITY_FALLBACK[severity];
}

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

const SEVERITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };

export function issueDecorationOptions(
  issue: ReviewIssueMarker,
): monaco.editor.IModelDecorationOptions {
  const severity = normalizeIssueSeverity(issue.severity);
  const hover = {
    value: `**[${issue.id}] ${SEVERITY_LABEL[severity] ?? issue.severity}** ${issue.message}\n\n建议：${issue.suggestedAction}`,
  };
  return {
    className: `sf-issue-underline sf-issue-${severity}`,
    glyphMarginClassName: `sf-issue-glyph sf-issue-glyph-${severity}`,
    glyphMarginHoverMessage: hover,
    hoverMessage: hover,
    overviewRuler: {
      color: issueSeverityColor(severity),
      position: monaco.editor.OverviewRulerLane.Right,
    },
  };
}
