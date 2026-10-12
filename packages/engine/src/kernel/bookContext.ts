import { pythonFixed } from './math';

export type ChapterEntry = { ordinal: number; relative_path: string; size_bytes: number };
export type SkeletonFile = { relative_path: string; estimated_chars: number; source_type: string };
export type RosterEntity = {
  canonical_name: string;
  aliases: readonly string[];
  first_chapter: number | null;
  last_chapter: number | null;
  missing: boolean;
};
export type BookContext = {
  chapters: readonly ChapterEntry[];
  current_relative_path: string | null;
  current_ordinal: number | null;
  skeleton: readonly SkeletonFile[];
  skeleton_total: number;
  roster: readonly RosterEntity[];
  roster_declared_total: number;
  dossier_relative_path: string | null;
  previous_chapter: readonly [string, string] | null;
};

function formatChars(count: number): string {
  if (count >= 10_000) return `约 ${pythonFixed(count / 10_000, 1)} 万字`;
  if (count >= 1_000) return `约 ${pythonFixed(count / 1_000, 1)} 千字`;
  return `约 ${count} 字`;
}

function scaleLine(context: BookContext): string {
  const total = context.chapters.length;
  const chars = Math.floor(
    context.chapters.reduce((sum, chapter) => sum + chapter.size_bytes, 0) / 3,
  );
  const parts = [`全书 ${total} 章正文 · ${formatChars(chars)}`];
  if (total) parts.push(`平均每章 ${formatChars(Math.floor(chars / total))}`);
  if (context.current_ordinal !== null) {
    parts.push(
      `当前打开的是第 ${context.current_ordinal} 章（${context.current_relative_path ?? 'None'}）`,
    );
  } else if (context.current_relative_path) {
    parts.push(`当前打开的 ${context.current_relative_path} 不计入阅读序（非正文目录）`);
  } else {
    parts.push('当前没有打开正文');
  }
  return `· ${parts.join('；')}。`;
}

function rosterDisplay(entity: RosterEntity): string {
  let display = entity.canonical_name;
  if (entity.aliases.length) display += `（又称 ${entity.aliases.slice(0, 3).join(' / ')}）`;
  if (entity.missing) display += ' · 正文中尚未登场';
  else if (entity.first_chapter !== null && entity.last_chapter !== null) {
    display +=
      entity.first_chapter === entity.last_chapter
        ? ` · 仅第 ${entity.first_chapter} 章在场`
        : ` · 第 ${entity.first_chapter}–${entity.last_chapter} 章在场`;
  }
  return display;
}

export function renderBookContextBlock(context: BookContext): string | null {
  const sections = ['[作品底座 · 确定性]\n' + scaleLine(context)];
  if (context.skeleton.length) {
    const lines = context.skeleton.map(
      (entry) =>
        `· ${entry.relative_path}（${entry.source_type} · ${formatChars(entry.estimated_chars)}）`,
    );
    if (context.skeleton_total > 12) {
      lines.push(`· …另有 ${context.skeleton_total - 12} 份，用 project_knowledge list 看全。`);
    }
    sections.push(
      '[Project Knowledge 索引 · 需要时用 project_knowledge read 展开]\n' + lines.join('\n'),
    );
  }
  const roster = context.roster.map((entity) => '· ' + rosterDisplay(entity));
  if (roster.length && context.roster_declared_total > 20) {
    roster.push(`· …另有 ${context.roster_declared_total - 20} 位，见 canon.json。`);
  }
  if (roster.length) sections.push('[已声明的人物 / 实体台账]\n' + roster.join('\n'));
  if (context.previous_chapter !== null) {
    const [relative, tail] = context.previous_chapter;
    sections.push(`[上一章结尾 · ${relative}]\n${tail}`);
  }
  if (sections.length === 1 && !context.chapters.length) return null;
  return sections.join('\n\n');
}

/** Same value the Desktop sees after Python's JSON response is parsed in the browser. */
export function toBookContextPayload(context: BookContext) {
  return {
    total_chapters: context.chapters.length,
    total_estimated_chars: Math.floor(
      context.chapters.reduce((sum, chapter) => sum + chapter.size_bytes, 0) / 3,
    ),
    current_relative_path: context.current_relative_path,
    current_ordinal: context.current_ordinal,
    chapters: context.chapters.map((chapter) => ({
      ordinal: chapter.ordinal,
      relative_path: chapter.relative_path,
      estimated_chars: Math.floor(chapter.size_bytes / 3),
    })),
    skeleton: context.skeleton.map((entry) => ({ ...entry })),
    skeleton_total: context.skeleton_total,
    skeleton_limit: 12,
    roster: context.roster.map((entity) => ({ ...entity, aliases: [...entity.aliases] })),
    roster_declared_total: context.roster_declared_total,
    roster_limit: 20,
    dossier_relative_path: context.dossier_relative_path,
    previous_chapter:
      context.previous_chapter === null
        ? null
        : { relative_path: context.previous_chapter[0], tail: context.previous_chapter[1] },
    prompt_block: renderBookContextBlock(context),
  };
}
