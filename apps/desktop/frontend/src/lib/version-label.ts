/**
 * 版本记录里每条版本的一行说明。AI 写回时摘要存的是当时那条回复的 Markdown 原文
 * （「**第4章已起草，请确认写盘。** --- ### …」），列表里要压成一行纯文本；
 * 来源与筛选按钮同一套叫法（手动 / AI），补丁、会话这些内部编号只留在悬停说明里。
 */

const SOURCE_LABELS: Record<string, string> = { Editor: '手动', Agent: 'AI' };

export function versionSourceLabel(source: string | undefined): string | null {
  if (!source) return null;
  return SOURCE_LABELS[source] ?? source;
}

export function versionSummaryText(summary: string | undefined): string | null {
  if (!summary) return null;
  const text = summary
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, '')
        .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, ''),
    )
    .join(' ')
    .replace(/(^|\s)(?:-{3,}|#{1,6})(?=\s|$)/g, ' ')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

export function versionLabel(version: {
  source?: string;
  summary?: string;
  file?: string;
}): string {
  const source = versionSourceLabel(version.source);
  const summary = versionSummaryText(version.summary) ?? version.file ?? '版本快照';
  return source ? `${source} · ${summary}` : summary;
}
