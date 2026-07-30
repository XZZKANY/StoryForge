/**
 * 作品档案：`.storyforge/book.json`。
 *
 * 在这之前，一本书的身份就是它的目录名——没有书名（≠ 目录名）、没有简介、没有题材，
 * 也没有属于**这本书**的字数目标（`dailyWordGoal` 是全局用户设置，换本书也是同一个数）。
 * 作者立项时想写下的那几行，IDE 里从来没有地方放。
 *
 * 档案归作者所有，与 canon.json 同级同权：人可读、可手改、可进版本库的一份 JSON。
 * 派生数据（章数、总字数）一概不落盘——每次现算，避免多出一份会过期的假事实。
 *
 * title 允许为空串，空即回落到目录名显示。这样「没起过名」与「名字恰好等于目录名」
 * 可以区分：前者跟着目录改名走，后者是作者的显式选择。
 */

export type BookProfile = {
  version: 1;
  /** 空串 = 未显式起名，显示时回落到目录名。 */
  title: string;
  synopsis: string;
  tags: string[];
  /** 相对 `.storyforge/` 的封面文件名；null = 未设封面。 */
  cover: string | null;
  /** 全书字数目标；0 = 未设，UI 据此整段不渲染进度条。 */
  wordGoal: number;
};

export const BOOK_PROFILE_CHILD = 'book.json';

export function emptyBookProfile(): BookProfile {
  return { version: 1, title: '', synopsis: '', tags: [], cover: null, wordGoal: 0 };
}

export function bookProfilePath(projectPath: string): string {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  const root = projectPath.replace(/[\\/]+$/, '');
  return `${root}${separator}.storyforge${separator}${BOOK_PROFILE_CHILD}`;
}

/** 显示用书名：作者没显式起名就用目录名，不显示空白标题。 */
export function displayBookTitle(profile: BookProfile, projectPath: string): string {
  const explicit = profile.title.trim();
  if (explicit) return explicit;
  const segments = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/);
  return segments[segments.length - 1] ?? '';
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

/** 题材标签：去空白、去重、上限 8 个——左栏一行放不下更多，多了也不再是「题材」。 */
export function normalizeTags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const tag = value.trim().replace(/^#+/, '').trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 8) break;
  }
  return tags;
}

/**
 * 容错解析：手改坏了的 JSON、缺字段、类型不对，一律降级成默认值而不是抛错。
 * 档案是作者随手能编辑的文件，解析失败就把左栏打空等于惩罚作者手改。
 */
export function parseBookProfile(raw: string): BookProfile {
  const base = emptyBookProfile();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const source = value as Record<string, unknown>;
  const wordGoal = source.wordGoal;
  const cover = source.cover;
  return {
    version: 1,
    title: readString(source, 'title'),
    synopsis: readString(source, 'synopsis'),
    tags: normalizeTags(source.tags),
    cover: typeof cover === 'string' && cover.trim() ? cover.trim() : null,
    wordGoal:
      typeof wordGoal === 'number' && Number.isFinite(wordGoal) && wordGoal > 0
        ? Math.floor(wordGoal)
        : 0,
  };
}

/** 稳定字段序 + 末尾换行：作者把档案进版本库时 diff 才只反映真实改动。 */
export function serializeBookProfile(profile: BookProfile): string {
  return `${JSON.stringify(
    {
      version: 1,
      title: profile.title,
      synopsis: profile.synopsis,
      tags: profile.tags,
      cover: profile.cover,
      wordGoal: profile.wordGoal,
    },
    null,
    2,
  )}\n`;
}

/** 目标进度：未设目标（0）返回 null，UI 据此整段不渲染，而不是画一条永远 0% 的条。 */
export function bookGoalProgress(chars: number, goal: number): number | null {
  if (!goal || goal <= 0) return null;
  return Math.max(0, Math.min(1, chars / goal));
}

/** 万字口径：长篇的 12.4 万比 124,000 好读；不足一万仍报精确字数。 */
export function formatWordCount(chars: number): string {
  if (chars >= 10000) return `${(chars / 10000).toFixed(1)} 万字`;
  return `${chars.toLocaleString('zh-CN')} 字`;
}
