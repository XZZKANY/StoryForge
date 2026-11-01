import { splitlinesKeepends } from './polishing';
import { codePoints, pythonSplitlines } from './pythonText';

export type QuoteLocation = {
  char_start: number;
  char_end: number;
  line_start: number;
  line_end: number;
};

// 模型引用原文时常把全角标点写成半角（稿子出稿后统一成全角，模型照旧写直引号），行号也常数错。
// 引文按「同一个标点的全角 / 半角算同一个字、空白不计」在全文里找，所报行号只在多处命中时挑最近的一处；
// 原文里没有这句就是找不到——要的是原文真有，不是模型数对了行。
const QUOTE_FOLD = new Map([
  ['“', '"'],
  ['”', '"'],
  ['＂', '"'],
  ['‘', "'"],
  ['’', "'"],
  ['＇', "'"],
  ['，', ','],
  ['：', ':'],
  ['；', ';'],
  ['？', '?'],
  ['！', '!'],
  ['（', '('],
  ['）', ')'],
]);
export const QUOTE_WHITESPACE: ReadonlySet<string> = new Set(
  [0x20, 0x09, 0x0a, 0x0d, 0x0c, 0x0b, 0x3000, 0xa0].map((code) => String.fromCodePoint(code)),
);

/** 折叠后的码点序列，及每个码点在原文里的下标。 */
function foldForQuote(chars: readonly string[]): { folded: string[]; positions: number[] } {
  const folded: string[] = [];
  const positions: number[] = [];
  chars.forEach((char, index) => {
    if (QUOTE_WHITESPACE.has(char)) return;
    folded.push(QUOTE_FOLD.get(char) ?? char);
    positions.push(index);
  });
  return { folded, positions };
}

/** 引文在正文里的位置（码点下标，行号按实际所在行）；找不到返回 null。 */
export function locateQuote(
  content: string,
  quote: string,
  line: number | null = null,
): QuoteLocation | null {
  const chars = codePoints(content);
  const { folded, positions } = foldForQuote(chars);
  const needle = foldForQuote(codePoints(quote)).folded;
  const starts: number[] = [];
  if (needle.length > 0)
    for (let index = 0; index + needle.length <= folded.length; index++)
      if (needle.every((char, i) => folded[index + i] === char)) starts.push(index);
  if (starts.length === 0) return null;
  const lineOffsets = [0];
  for (const text of splitlinesKeepends(content))
    lineOffsets.push(lineOffsets[lineOffsets.length - 1] + codePoints(text).length);
  const lineOf = (offset: number) => lineOffsets.filter((start) => start <= offset).length;
  let best = starts[0];
  if (line !== null) {
    const distance = (start: number) => Math.abs(lineOf(positions[start]) - line);
    for (const start of starts) if (distance(start) < distance(best)) best = start;
  }
  const offset = positions[best];
  const end = positions[best + needle.length - 1] + 1;
  const lineStart = lineOf(offset);
  return {
    char_start: offset,
    char_end: end,
    line_start: lineStart,
    line_end: lineStart + pythonSplitlines(chars.slice(offset, end).join('')).length - 1,
  };
}
