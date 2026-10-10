/**
 * 「接着写」交接：作者打开作品或新开会话时，告诉他上一章停在哪、哪条线还没收、下一章是第几章。
 *
 * 纯函数，事实全部照抄后端投影：章序与字数来自 `book.context`，上一章结尾来自同一命令的
 * `previous_chapter`，伏笔来自观测镜台账。这里只做挑选与措辞，不另算章序——同一份事实
 * 只能有一个算法（见 `lib/book-context.ts` 头注释）。作品总览与对话开场共用这一份结果，
 * 两处说的必须是同一件事。
 */

import { nextChapterWriteRequest, type ChapterWriteRequest } from './assistant-events';
import type { ObservatoryPromises } from './observations';

/** 摘录上限：总览与对话气泡里各占三四行，再长就成了读正文。 */
export const HANDOFF_EXCERPT_MAX_CHARS = 140;
/** 最后一段太短（一句对白、一个拟声词）时向前补段，直到够这个长度。 */
const HANDOFF_EXCERPT_MIN_CHARS = 40;
/** 埋下或上次推进后隔了这么多章还没碰，才值得在开场提一句。 */
export const HANDOFF_STALE_PROMISE_CHAPTERS = 3;
const HANDOFF_PROMISE_LIMIT = 2;

const SENTENCE_END = /[。！？!?…」”』]/u;
/** 没有句号可截时退到分句：宁可从逗号后起，也不从一个词中间起。 */
const CLAUSE_END = /[，；,;]/u;

export type HandoffChapter = {
  ordinal: number;
  relativePath: string;
};

export type HandoffPromise = {
  title: string;
  plantedChapter: number | null;
  /** 当前章减去最后推进（无推进记录时用埋下章）；不知道就是 null。 */
  idleChapters: number | null;
  dueChapter: number | null;
  /** 按计划本章或更早就该回收。 */
  due: boolean;
};

export type ChapterHandoff = {
  /** 阅读序最后一章；空手稿为 null。 */
  lastChapter: HandoffChapter | null;
  /** 下一章的起草请求，与「AI 起草下一章」按钮同一推导。 */
  next: ChapterWriteRequest & { chapterOrdinal: number };
  /** 上一章结尾摘录，按段落；拿不到就是 null，不编。 */
  excerpt: string[] | null;
  /** 摘录被截掉了开头。 */
  excerptClipped: boolean;
  /** 摘录来源的相对路径，用于「依据」脚注。 */
  excerptSource: string | null;
  stalePromises: HandoffPromise[];
};

export type ChapterHandoffInput = {
  chapters: ReadonlyArray<HandoffChapter>;
  previousChapter: { relativePath: string; tail: string } | null;
  promises: ObservatoryPromises | null;
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/** 从段尾往前取，截断点落在句子开头，不从半句话起。 */
function clipFromSentenceStart(text: string, limit: number): { text: string; clipped: boolean } {
  if (text.length <= limit) return { text, clipped: false };
  const start = text.length - limit;
  for (const boundary of [SENTENCE_END, CLAUSE_END]) {
    for (let index = start; index < text.length; index += 1) {
      if (boundary.test(text[index - 1] ?? '')) {
        const rest = text.slice(index).replace(/^[」”』\s]+/u, '');
        if (rest.length > 0) return { text: rest, clipped: true };
      }
    }
  }
  return { text: text.slice(start), clipped: true };
}

export function excerptChapterTail(
  tail: string,
): { paragraphs: string[]; clipped: boolean } | null {
  const paragraphs = tail
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (paragraphs.length === 0) return null;
  const picked: string[] = [];
  let total = 0;
  let clipped = false;
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index];
    const budget = HANDOFF_EXCERPT_MAX_CHARS - total;
    if (paragraph.length > budget) {
      // 放不下整段：只在还不够长时截它的后半句补上，否则宁可短一点。
      if (picked.length === 0 || total < HANDOFF_EXCERPT_MIN_CHARS) {
        const part = clipFromSentenceStart(paragraph, budget);
        picked.unshift(part.text);
        clipped = part.clipped;
      } else {
        clipped = true;
      }
      break;
    }
    picked.unshift(paragraph);
    total += paragraph.length;
    if (total >= HANDOFF_EXCERPT_MIN_CHARS) {
      clipped = index > 0;
      break;
    }
  }
  return { paragraphs: picked, clipped };
}

function stalePromises(promises: ObservatoryPromises | null, fallbackCurrent: number | null) {
  if (!promises) return [];
  const current = promises.currentChapter ?? fallbackCurrent;
  const nextOrdinal = (current ?? 0) + 1;
  const open = promises.ledger.filter(
    (entry) => entry.resolvedChapter === null && entry.status !== 'resolved',
  );
  const scored: HandoffPromise[] = open.map((entry) => {
    const lastMove = entry.lastTouchChapter ?? entry.plantedChapter;
    const idle = current !== null && lastMove !== null ? Math.max(current - lastMove, 0) : null;
    return {
      title: entry.title,
      plantedChapter: entry.plantedChapter,
      idleChapters: idle,
      dueChapter: entry.dueChapter,
      due: entry.dueChapter !== null && entry.dueChapter <= nextOrdinal,
    };
  });
  return scored
    .filter(
      (entry) =>
        entry.due ||
        (entry.idleChapters !== null && entry.idleChapters >= HANDOFF_STALE_PROMISE_CHAPTERS),
    )
    .sort(
      (left, right) =>
        Number(right.due) - Number(left.due) ||
        (right.idleChapters ?? 0) - (left.idleChapters ?? 0),
    )
    .slice(0, HANDOFF_PROMISE_LIMIT);
}

export function buildChapterHandoff(input: ChapterHandoffInput): ChapterHandoff {
  const lastChapter = input.chapters.reduce<HandoffChapter | null>(
    (latest, chapter) => (latest === null || chapter.ordinal > latest.ordinal ? chapter : latest),
    null,
  );
  const request = nextChapterWriteRequest(input.chapters);
  const next = { ...request, chapterOrdinal: request.chapterOrdinal ?? 1 };
  // 上一章摘录只认阅读序最后一章：后端按「下一章」推的上一章若不是它，说明正文刚变过，宁可不说。
  const previous =
    input.previousChapter &&
    lastChapter &&
    normalizePath(input.previousChapter.relativePath) === normalizePath(lastChapter.relativePath)
      ? input.previousChapter
      : null;
  const excerpt = previous ? excerptChapterTail(previous.tail) : null;
  return {
    lastChapter,
    next,
    excerpt: excerpt?.paragraphs ?? null,
    excerptClipped: excerpt?.clipped ?? false,
    excerptSource: excerpt ? (previous?.relativePath ?? null) : null,
    stalePromises: stalePromises(input.promises, lastChapter?.ordinal ?? null),
  };
}

/** 「第 1 章埋下，之后 4 章没再碰」；不含标题，展示与提示词各自拼。 */
export function stalePromiseDetail(promise: HandoffPromise): string {
  const parts: string[] = [];
  if (promise.plantedChapter !== null) parts.push(`第 ${promise.plantedChapter} 章埋下`);
  if (promise.due && promise.dueChapter !== null) {
    parts.push(`计划第 ${promise.dueChapter} 章回收`);
  } else if (promise.idleChapters !== null && promise.idleChapters > 0) {
    parts.push(`之后 ${promise.idleChapters} 章没再碰`);
  }
  return parts.join('，');
}

/** 「先聊聊下一章」：只要方向不要正文，作者看完再决定起草哪一个。 */
export function discussNextChapterPrompt(handoff: ChapterHandoff): string {
  const n = handoff.next.chapterOrdinal;
  if (!handoff.lastChapter) {
    return '这本书还没开写。先别写正文：问我三五个关键问题，帮我把第 1 章想清楚。';
  }
  return (
    `第 ${n} 章还没动笔。先别写正文：结合第 ${handoff.lastChapter.ordinal} 章的结尾和还没回收的伏笔，` +
    `给我三个第 ${n} 章可以走的方向，每个两三句话，说清楚各自接哪条线。`
  );
}

export function pickUpPromisePrompt(handoff: ChapterHandoff, promise: HandoffPromise): string {
  const detail = stalePromiseDetail(promise);
  return (
    `第 ${handoff.next.chapterOrdinal} 章想接上「${promise.title}」${detail ? `（${detail}）` : ''}。` +
    '先别写正文，给我三种接法，每种两三句话。'
  );
}
