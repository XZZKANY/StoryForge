import { codePoints } from './pythonText';
import { parseOrdinal } from './reviseScope';

/** 本章之后再带几章的节点：只看本章，模型不知道这一章要给后面铺什么。 */
export const OUTLINE_FOCUS_AHEAD = 2;
/** 本章节点或所在卷整段放不下时，剩下的额度够这么多字才截一段进去，不然只留标题。 */
const PARTIAL_MIN_CHARS = 80;
const ELLIPSIS = '……';

const NUMBER = '(\\p{Nd}+|[一二两三四五六七八九十]+)';
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/u;
const FENCE = /^ {0,3}(```|~~~)/u;
const CHAPTER = new RegExp(
  `第\\s*${NUMBER}\\s*(?:[—–\\-~～至到]+\\s*第?\\s*${NUMBER}\\s*)?章`,
  'u',
);
const CHAPTER_RANGE = new RegExp(
  `第\\s*${NUMBER}\\s*[—–\\-~～至到]+\\s*第?\\s*${NUMBER}\\s*章`,
  'u',
);
const VOLUME = new RegExp(`第\\s*${NUMBER}\\s*卷|卷\\s*${NUMBER}`, 'u');
/** 卷的章号范围只认标题或卷首这么多字里写明的「第a—b章」。 */
const VOLUME_RANGE_LOOKAHEAD = 200;

type Range = readonly [number, number];

type Chunk = {
  /** 标题行原文；文件开头第一个标题之前的文字为 null。 */
  readonly heading: string | null;
  readonly level: number;
  readonly body: string;
  /** 章节节点覆盖的章号（「第五章」「第11—20章」）；不是章节节点为 null。 */
  readonly node: Range | null;
  readonly volume: boolean;
  readonly volumeRange: Range | null;
};

function ordinalOf(raw: string): number | null {
  const value = parseOrdinal(raw);
  return value === null || value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

function rangeOf(match: RegExpExecArray | null): Range | null {
  if (match === null) return null;
  const start = ordinalOf(match[1]);
  const end = match[2] === undefined ? start : ordinalOf(match[2]);
  if (start === null || end === null || end < start) return null;
  return [start, end];
}

function chunk(heading: string | null, title: string, level: number, lines: string[]): Chunk {
  const body = lines.join('\n').replace(/^\n+|\n+$/gu, '');
  const volume = heading !== null && VOLUME.test(title);
  return {
    heading,
    level,
    body,
    node: heading === null || volume ? null : rangeOf(CHAPTER.exec(title)),
    volume,
    volumeRange: volume
      ? (rangeOf(CHAPTER_RANGE.exec(title)) ??
        rangeOf(CHAPTER_RANGE.exec(codePoints(body).slice(0, VOLUME_RANGE_LOOKAHEAD).join(''))))
      : null,
  };
}

/** 按 Markdown 标题切成小节；代码块里的 # 不算标题。 */
function parseChunks(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let heading: string | null = null;
  let title = '';
  let level = 0;
  let lines: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    const match = fenced ? null : HEADING.exec(line);
    if (match === null || !match[2]) {
      lines.push(line);
      continue;
    }
    if (heading !== null || lines.some((item) => item.trim())) {
      chunks.push(chunk(heading, title, level, lines));
    }
    heading = line.trim();
    title = match[2];
    level = match[1].length;
    lines = [];
  }
  chunks.push(chunk(heading, title, level, lines));
  return chunks;
}

/** 卷标题下（到下一个同级或更高级标题为止）的小节下标。 */
function volumeMembers(chunks: readonly Chunk[], index: number): number[] {
  const members = [index];
  for (let next = index + 1; next < chunks.length; next += 1) {
    if (chunks[next].heading !== null && chunks[next].level <= chunks[index].level) break;
    members.push(next);
  }
  return members;
}

const overlaps = (range: Range, start: number, end: number) => range[0] <= end && range[1] >= start;

/** 越小越先放：[层, 层内次序]。 */
function priorities(chunks: readonly Chunk[], ordinal: number | null): [number, number][] {
  if (ordinal === null) return chunks.map((_, index) => [2, index]);
  const ahead = ordinal + OUTLINE_FOCUS_AHEAD;
  const focus = new Set(
    chunks.flatMap((item, index) =>
      item.node !== null && overlaps(item.node, ordinal, ahead) ? [index] : [],
    ),
  );
  const volumes = chunks.flatMap((item, index) => (item.volume ? [index] : []));
  // 卷写明了章号范围就按范围认；都没写时，本章节点挂在哪一卷下面就是哪一卷。
  const ranged = volumes.filter((index) => {
    const range = chunks[index].volumeRange;
    return range !== null && overlaps(range, ordinal, ordinal);
  });
  const current = ranged.length
    ? ranged
    : volumes.filter((index) => volumeMembers(chunks, index).some((member) => focus.has(member)));
  const inCurrent = new Set(current.flatMap((index) => volumeMembers(chunks, index)));
  return chunks.map((item, index): [number, number] => {
    if (focus.has(index)) return [0, item.node![0]];
    if (item.node !== null && item.node[1] < ordinal) return [3, ordinal - item.node[1]];
    if (item.node !== null) return [4, item.node[0]];
    return inCurrent.has(index) ? [1, index] : [2, index];
  });
}

/**
 * 放不下整份的大纲：标题全留，正文按本章取。
 *
 * 次序是本章及其后两章的节点 → 本章所在卷 → 其余小节按原顺序 → 已写过的章的节点（近的先）→ 更远的节点，
 * 放到额度用完为止；放不进的小节只留标题，模型看得出全书骨架、知道哪里略去了。
 * 只按开头截时，「第五章」节点刚好落在截断处之后，写到第五章就再也看不到总纲往下怎么走。
 * 没有 Markdown 标题、或光标题就超额时返回 null，由调用方照旧取开头。
 */
export function focusOutline(text: string, ordinal: number | null, room: number): string | null {
  const chunks = parseChunks(text);
  if (!chunks.some((item) => item.heading !== null)) return null;
  const separator = 2;
  let used = chunks.reduce(
    (total, item) =>
      total + (item.heading === null ? 0 : codePoints(item.heading).length + separator),
    0,
  );
  if (used > room) return null;
  const bodies: (string | null)[] = chunks.map(() => null);
  const order = priorities(chunks, ordinal)
    .map((priority, index) => ({ priority, index }))
    .sort(
      (a, b) => a.priority[0] - b.priority[0] || a.priority[1] - b.priority[1] || a.index - b.index,
    );
  for (const { priority, index } of order) {
    const body = chunks[index].body;
    if (!body) continue;
    const cost = codePoints(body).length + separator;
    if (used + cost <= room) {
      bodies[index] = body;
      used += cost;
      continue;
    }
    const left = room - used - separator - ELLIPSIS.length;
    if (priority[0] <= 1 && left >= PARTIAL_MIN_CHARS) {
      bodies[index] = codePoints(body).slice(0, left).join('') + ELLIPSIS;
      used = room;
    }
  }
  const parts: string[] = [];
  chunks.forEach((item, index) => {
    const body = bodies[index];
    if (item.heading === null) {
      if (body) parts.push(body);
    } else parts.push(body ? `${item.heading}\n${body}` : item.heading);
  });
  return parts.join('\n\n');
}

/** 放进起草或章纲时注在挑过的大纲前面，说明怎么挑的、只有标题的小节是什么意思。 */
export function outlineFocusNote(totalChars: number, ordinal: number | null): string {
  const how =
    ordinal === null
      ? '小节按原顺序放到额度用完'
      : `按第 ${ordinal} 章挑：本章及其后 ${OUTLINE_FOCUS_AHEAD} 章的节点、本章所在的卷先放，其余小节按原顺序放到额度用完`;
  return `（这份共 ${totalChars} 字，放不下全文，${how}；只有标题的小节是略去了正文，不是没写。）`;
}
