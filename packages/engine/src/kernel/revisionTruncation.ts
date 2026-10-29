import { canonicalPunctuation } from './punctuation';
import { pythonStrip } from './pythonText';

// 中转在长输出途中掐断、却照样回终止标记时（10-28 总纲：finish_reason=stop、没有 usage），
// 传输层认不出来，只能看成稿本身：原文末尾整段在新稿里找不到，新稿又停在半句。
const SENTENCE_CLOSERS = new Set(Array.from('。．.！!？?…；;」』”’"\'）)】]》〉〕｝}～~—|'));
const HEADING = /^(#{1,6})\s/u;
const LIST_ITEM = /^(?:[-*+]|\d+[.、．)）])/u;
const MARKUP = /[\s#>*_`\-=|~]+/gu;
const TRAILING_EMPHASIS = /[*_`\s]+$/u;
/** 末行有没有收句，参照它前面同类行的习惯：列表项本来就不带句号的稿子不算停在半句。 */
const PEER_WINDOW = 5;
const SHOWN_HEADINGS = 3;
const QUOTE_CHARS = 12;

export type TruncationWarning = {
  message: string;
  missing_line_count: number;
  missing_headings: string[];
  ends_mid_sentence: true;
};

type LineKind = 'heading' | 'list' | 'table' | 'quote' | 'plain';

const contentLines = (text: string) => text.split('\n').map(pythonStrip).filter(Boolean);
const codePoints = (text: string) => Array.from(text);
/** 去掉标记后不足 4 个字的行（分隔线、「略」之类）前后都可能出现，当不了定位锚。 */
const distinctive = (line: string) => codePoints(line.replace(MARKUP, '')).length >= 4;

function lineKind(line: string): LineKind {
  if (HEADING.test(line)) return 'heading';
  if (LIST_ITEM.test(line)) return 'list';
  if (line.startsWith('|')) return 'table';
  if (line.startsWith('>')) return 'quote';
  return 'plain';
}

function closesSentence(line: string): boolean {
  const chars = codePoints(line.replace(TRAILING_EMPHASIS, ''));
  return !chars.length || SENTENCE_CLOSERS.has(chars[chars.length - 1]);
}

function endsMidSentence(lines: readonly string[]): boolean {
  const last = lines[lines.length - 1];
  const kind = lineKind(last);
  // 停在一个空节的标题上，同样是没写完。
  if (kind === 'heading') return true;
  if (closesSentence(last)) return false;
  const peers = lines
    .slice(0, -1)
    .filter((line) => lineKind(line) === kind)
    .slice(-PEER_WINDOW);
  if (!peers.length) return true;
  return peers.filter(closesSentence).length * 2 > peers.length;
}

/** 原文最后一处还留在新稿里的行之后，那一整段原文在新稿里都找不到；找不到锚或停在原文行尾就不算。 */
function missingTail(before: readonly string[], after: readonly string[]): string[] | null {
  const afterKeys = new Set(after.map(canonicalPunctuation));
  const beforeKeys = before.map(canonicalPunctuation);
  let anchor = -1;
  before.forEach((line, index) => {
    if (distinctive(line) && afterKeys.has(beforeKeys[index])) anchor = index;
  });
  if (anchor < 0) return null;
  const tail = before.slice(anchor + 1).filter(distinctive);
  if (!tail.length) return null;
  const lastAfter = canonicalPunctuation(after[after.length - 1]);
  // 新稿最后一行就是原文某一整行：是作者让删到这里，不是半路断开。
  if (beforeKeys.includes(lastAfter)) return null;
  if (tail.length === 1) {
    // 只差一行时，只认「照抄最后一行抄到一半」；改写了末行不算。
    const only = canonicalPunctuation(tail[0]);
    if (!(only.startsWith(lastAfter) && only !== lastAfter)) return null;
  }
  return tail;
}

function headingTitles(tail: readonly string[]): { shown: string[]; more: boolean } {
  const headings = tail.flatMap((line) => {
    const match = HEADING.exec(line);
    return match
      ? [{ level: match[1].length, title: pythonStrip(line.slice(match[0].length)) }]
      : [];
  });
  if (!headings.length) return { shown: [], more: false };
  const top = Math.min(...headings.map((heading) => heading.level));
  const titles = headings
    .filter((heading) => heading.level === top)
    .map((heading) => heading.title);
  return { shown: titles.slice(-SHOWN_HEADINGS), more: titles.length > SHOWN_HEADINGS };
}

/**
 * 整文件修订的新稿「看起来没写完」：新稿停在半句，且原文末尾若干段在新稿里整段找不到。
 * 只做提示、不拦稿；不看长度比例——事故稿把中间一节扩写了，新稿反而比原文长。
 */
export function truncationWarning(before: string, after: string): TruncationWarning | null {
  const beforeLines = contentLines(before);
  const afterLines = contentLines(after);
  if (!beforeLines.length || !afterLines.length) return null;
  if (!endsMidSentence(afterLines)) return null;
  const tail = missingTail(beforeLines, afterLines);
  if (tail === null) return null;
  const { shown, more } = headingTitles(tail);
  const stopped = codePoints(afterLines[afterLines.length - 1])
    .slice(-QUOTE_CHARS)
    .join('');
  const lost = shown.length
    ? `原文最后的${shown.map((title) => `『${title}』`).join('')}${more ? '等' : ''}共 ${tail.length} 段`
    : `原文最后 ${tail.length} 段（从「${codePoints(tail[0]).slice(0, QUOTE_CHARS).join('')}」起）`;
  return {
    message:
      `AI 的输出可能没写完：${lost}在新稿里没有，且新稿停在半句（「…${stopped}」）。` +
      '整份接受会把这些内容一起删掉，请先在 diff 里核对，或让 AI 重做。',
    missing_line_count: tail.length,
    missing_headings: shown,
    ends_mid_sentence: true,
  };
}
