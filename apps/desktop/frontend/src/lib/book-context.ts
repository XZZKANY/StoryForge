/**
 * 作品底座 payload → 左栏手稿视图的映射层（纯函数，可单测）。
 *
 * 数据来自后端 `book.context` IDE 命令。**这里刻意不做任何推算**：章序、字数、截断条数
 * 全部照抄后端投影。前端自己另算一遍就会出现「面板说第 12 章、模型以为第 13 章」，
 * 那比不显示更糟——同一份事实必须只有一个算法（见 `apps/api/app/domains/agent_runs/book_context.py`）。
 *
 * payload 形状不对时返回 null（由调用方显示错误），不伪造空对象：一个空手稿会让作者
 * 以为「书里什么都没有」。
 */

/** 字数口径镜像后端 `_format_chars`。两侧各有测试钉住；改一侧必须同步改另一侧。 */
export function formatEstimatedChars(count: number): string {
  if (count >= 10000) return `约 ${(count / 10000).toFixed(1)} 万字`;
  if (count >= 1000) return `约 ${(count / 1000).toFixed(1)} 千字`;
  return `约 ${count} 字`;
}

export type ManuscriptChapter = {
  ordinal: number;
  relativePath: string;
  /** 文件名（去掉目录），列表里显示这个 */
  name: string;
  estimatedChars: number;
};

export type SkeletonEntry = {
  relativePath: string;
  estimatedChars: number;
};

export type RosterEntry = {
  canonicalName: string;
  aliases: string[];
  firstChapter: number | null;
  lastChapter: number | null;
  missing: boolean;
};

export type BookContextSnapshot = {
  totalChapters: number;
  totalEstimatedChars: number;
  currentRelativePath: string | null;
  currentOrdinal: number | null;
  chapters: ManuscriptChapter[];
  skeleton: SkeletonEntry[];
  skeletonTotal: number;
  skeletonLimit: number;
  roster: RosterEntry[];
  rosterDeclaredTotal: number;
  rosterLimit: number;
  dossierRelativePath: string | null;
  previousChapter: { relativePath: string; tail: string } | null;
  /** 模型这轮真正收到的那段 system 文本，原样交付供作者核对 */
  promptBlock: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function asOptionalInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function basename(relativePath: string): string {
  const cut = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'));
  return cut >= 0 ? relativePath.slice(cut + 1) : relativePath;
}

export function mapBookContextPayload(payload: unknown): BookContextSnapshot | null {
  const root = asRecord(payload);
  if (!root) return null;
  // 章节数组是这份 payload 的骨干；连它都不是数组说明后端换了形状，不该硬撑。
  if (!Array.isArray(root.chapters)) return null;

  const chapters: ManuscriptChapter[] = [];
  for (const raw of root.chapters) {
    const item = asRecord(raw);
    const relativePath = item ? asText(item.relative_path) : null;
    const ordinal = item ? asOptionalInt(item.ordinal) : null;
    if (!relativePath || ordinal === null) continue;
    chapters.push({
      ordinal,
      relativePath,
      name: basename(relativePath),
      estimatedChars: asInt(item?.estimated_chars, 0),
    });
  }

  const skeleton: SkeletonEntry[] = [];
  for (const raw of Array.isArray(root.skeleton) ? root.skeleton : []) {
    const item = asRecord(raw);
    const relativePath = item ? asText(item.relative_path) : null;
    if (!relativePath) continue;
    skeleton.push({ relativePath, estimatedChars: asInt(item?.estimated_chars, 0) });
  }

  const roster: RosterEntry[] = [];
  for (const raw of Array.isArray(root.roster) ? root.roster : []) {
    const item = asRecord(raw);
    const canonicalName = item ? asText(item.canonical_name) : null;
    if (!canonicalName) continue;
    roster.push({
      canonicalName,
      aliases: Array.isArray(item?.aliases)
        ? item.aliases.filter((alias): alias is string => typeof alias === 'string')
        : [],
      firstChapter: asOptionalInt(item?.first_chapter),
      lastChapter: asOptionalInt(item?.last_chapter),
      missing: item?.missing === true,
    });
  }

  const previous = asRecord(root.previous_chapter);
  const previousRelative = previous ? asText(previous.relative_path) : null;

  return {
    totalChapters: asInt(root.total_chapters, chapters.length),
    totalEstimatedChars: asInt(root.total_estimated_chars, 0),
    currentRelativePath: asText(root.current_relative_path),
    currentOrdinal: asOptionalInt(root.current_ordinal),
    chapters,
    skeleton,
    skeletonTotal: asInt(root.skeleton_total, skeleton.length),
    skeletonLimit: asInt(root.skeleton_limit, skeleton.length),
    roster,
    rosterDeclaredTotal: asInt(root.roster_declared_total, roster.length),
    rosterLimit: asInt(root.roster_limit, roster.length),
    dossierRelativePath: asText(root.dossier_relative_path),
    previousChapter: previousRelative
      ? { relativePath: previousRelative, tail: asText(previous?.tail) ?? '' }
      : null,
    promptBlock: asText(root.prompt_block),
  };
}

/** 骨架 / 名单被截掉的条数。返回 0 表示模型拿到了全部——这个数字必须显式给作者看。 */
export function droppedCount(total: number, shown: number): number {
  return Math.max(0, total - shown);
}
