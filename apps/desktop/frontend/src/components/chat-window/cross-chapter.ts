import type { CrossChapterFinding } from '../../lib/api/types';
import type { SemanticFile } from '../../lib/project/types';

export type ChapterRef = { name: string; path: string };

/**
 * 从用户消息里识别 ≥2 个章节引用(「第N章」/「@N」),映射到项目里的 draft 章节文件。
 * 返回去重、保序的章节文件列表;不足两个时由调用方决定是否走跨章流程。
 */
export function resolveChapterRefs(text: string, files: SemanticFile[]): ChapterRef[] {
  const numbers: number[] = [];
  const pattern = /第\s*(\d+)\s*章|@\s*(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value) && !numbers.includes(value)) {
      numbers.push(value);
    }
  }

  const drafts = files.filter((file) => file.kind === 'draft');
  const refs: ChapterRef[] = [];
  const seen = new Set<string>();
  for (const value of numbers) {
    const file = drafts.find((candidate) => chapterFileMatchesNumber(candidate.name, value));
    if (file && !seen.has(file.path)) {
      seen.add(file.path);
      refs.push({ name: chapterDisplayName(file), path: file.path });
    }
  }
  return refs;
}

function chapterFileMatchesNumber(fileName: string, value: number): boolean {
  const digits = fileName.match(/\d+/g) ?? [];
  return digits.some((group) => Number.parseInt(group, 10) === value);
}

function chapterDisplayName(file: SemanticFile): string {
  return file.name.replace(/\.(md|txt|markdown)$/i, '');
}

/** 把跨章冲突格式化成对话里可读的多行文本。 */
export function formatCrossChapterFindings(
  findings: CrossChapterFinding[],
  chapterNames: string[],
  model: string | null,
): string {
  const scope = chapterNames.join(' / ');
  const suffix = model ? ` · ${model}` : '';
  if (findings.length === 0) {
    return `跨章一致性检查(${scope})${suffix}\n未发现跨章硬冲突。`;
  }
  const lines = findings.map((finding) => {
    const chapters = (finding.chapters ?? []).join('↔') || '?';
    return `• [${finding.type}·${finding.severity}] ${chapters}：${finding.finding}\n  证据：${finding.evidence}`;
  });
  return `跨章一致性检查(${scope})${suffix} · 发现 ${findings.length} 条：\n${lines.join('\n')}`;
}
