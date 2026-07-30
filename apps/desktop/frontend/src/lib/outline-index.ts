/**
 * 大纲目录：把「大纲」语义目录下各文件的标题层级摊平成一张可点的跳转表。
 *
 * 写到第 40 章时想确认这一章原本该发生什么，此前要先在文件树里找到大纲文件、打开、
 * 再在里面翻——三步都在离开正文。这张表把它压成一次点击。
 *
 * 纯解析：只认 ATX 标题（`## 第三幕`），围栏代码块内的 `#` 不算标题。
 */

export type OutlineHeading = {
  /** 0 基行号，跳转时直接喂给定位事件。 */
  line: number;
  /** 1–6 */
  level: number;
  text: string;
};

export type OutlineEntry = OutlineHeading & {
  path: string;
  relativePath: string;
};

/** 一次最多列这么多条：大纲可以有几百个节点，左栏不做无上限渲染。 */
export const OUTLINE_HEADING_LIMIT = 200;

export function parseHeadings(content: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const lines = content.split('\n');
  let inFence = false;
  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line];
    if (/^\s*(?:```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const text = match[2].trim();
    if (!text) continue;
    headings.push({ line, level: match[1].length, text });
  }
  return headings;
}

/**
 * 截断到上限，并把丢掉的条数如实报出（#235 的教训：整类被丢了而作者不知道）。
 */
export function limitOutlineEntries(entries: OutlineEntry[]): {
  shown: OutlineEntry[];
  dropped: number;
} {
  if (entries.length <= OUTLINE_HEADING_LIMIT) return { shown: entries, dropped: 0 };
  return {
    shown: entries.slice(0, OUTLINE_HEADING_LIMIT),
    dropped: entries.length - OUTLINE_HEADING_LIMIT,
  };
}
