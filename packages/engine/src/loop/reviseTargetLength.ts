import { countProseChars } from '@storyforge/project-core';

// issue #492：作者让修订改到某个字数，AI 交回的稿子差得很远，补丁上却看不出来。
// 作者 10-29 拍板：指令里写了明确字数时由程序算实际字数，落在目标外就在补丁上附一条提示；
// 只提示、不拦稿、不重写。解析不出、指的是某一段、几处说法对不上，都不提示。

export type TargetLength = {
  readonly min: number | null;
  readonly max: number | null;
  /** 作者只给了一个数（「4000 字左右」「改成 4000 字」），区间是按上下各一成推出来的。 */
  readonly approximate: boolean;
};

export type LengthHint = {
  message: string;
  target_min: number | null;
  target_max: number | null;
  actual_chars: number;
  direction: 'over' | 'under';
  off_by: number;
};

type Kind = 'approx' | 'upper' | 'lower' | 'range';
type Candidate = { kind: Kind; low: number; high: number; strong: boolean };
type NumberToken = { start: number; end: number; low: number; high: number };

/** 只给一个数时上下各留一成。 */
const SINGLE_TARGET_TOLERANCE = 0.1;

const CN_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CN_UNITS: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 };
const MULTIPLIERS: Readonly<Record<string, number>> = { k: 1000, 千: 1000, w: 10000, 万: 10000 };

const NUMBER = /(\d+(?:\.\d+)?)\s*([kKwW千万])?|([零〇一二两三四五六七八九十百千万]+)/gu;
const CN_RANGE = /^([一二两三四五六七八九])([二三四五六七八九])([十百千万])$/u;
const UNIT = /^\s*([多余来]\s*)?(?:个\s*)?字(?:符)?/u;
const RANGE_SEPARATOR = /^\s*(?:-|–|—|~|〜|∼|到|至)\s*/u;
const SENTENCE_BREAK = /[。!?;\n]/u;
const CLAUSE_BREAK = /[。!?;\n,、:]/u;
const WORD_COUNT_SUBJECT = /字数|篇幅/u;

// 指的是稿子的一部分（「开头那段压到 300 字」「每段不超过 200 字」）：整份稿子的字数对不上它。
const PART_OF_TEXT = new RegExp(
  '(?:[这那本该此每前后头末首尾一两几]|第[\\d一二两三四五六七八九十百]+|最后|开头|结尾)\\s*(?:一|几|个|两)?\\s*' +
    '(?:段|句|节(?!奏|点|日)|幕|场|行|部分)|段落|开头|开篇|结尾|结局|末尾|片段|对话|台词|这里|此处|' +
    '标题|题目|书名|章名|简介|梗概|文案|每一?章',
  'u',
);
// 同一小句里明说了整章 / 全文，前面提过的「开头」「某段」就不是这个数说的对象。
const WHOLE_TEXT =
  /整章|全章|本章|这章|这一章|该章|整篇|全篇|通篇|全文|整体|整份|全稿|总字数|总共|一共|总计|合计/u;

const APPROX_LEAD = /(?:大约|大概|大致|差不多|将近|接近|约莫|约)\s*$/u;
const FROM_LEAD = /[从由]\s*$/u;
const NOT_A_TARGET_LEAD = /(?:第|每|前|后|头|末|首|这|那|该|此)\s*$/u;
const UPPER_LEAD =
  /(?:(?:不|别|不要|不能|不可|不得|勿|莫)\s*(?:超过|超出|多于|高于|大于|超)|最多|至多|顶多|最长|上限(?:是|为)?|封顶)\s*$/u;
const LOWER_LEAD =
  /(?:(?:不|别|不要|不能|不可|不得)\s*(?:少于|低于|小于|短于)|至少|最少|起码|最低|下限(?:是|为)?)\s*$/u;
const TARGET_LEAD = /(?:到|至|成|为|(?:控制|保持|维持|压|定|落|收|限制|限)在)\s*$/u;
const NOT_A_VERB_LEAD =
  /(?:因为|作为|认为|以为|完成|形成|组成|构成|造成|不到|看到|读到|翻到|念到|提到|说到|谈到|想到|听到|见到|找到|遇到|感到|得到|收到)\s*$/u;
/** 没有「改成 / 压到」之类的动词时，只认紧跟在句首或「字数 / 全文 / 这章 / 目标是」后面的数。 */
const PLAIN_LEAD =
  /(?:^|字数|篇幅|全文|全章|整章|本章|这章|这一章|该章|正文|全篇|整篇|通篇|整体|总共|一共|共|总计|合计|总字数|章|篇|稿|是|\()\s*$/u;
const ALREADY = /已经|已/u;

const APPROX_SUFFIX = /^\s*(?:左右|上下|前后|出头|开外)/u;
const UPPER_SUFFIX = /^\s*(?:以内|之内|内(?!容)|以下|之下|封顶|为限)/u;
const LOWER_SUFFIX = /^\s*(?:以上|之上|起)/u;
/** 「写到 2000 字的时候」「在 3000 字处」「4000 字了」：说的是位置或现状，不是目标。 */
const NOT_A_TARGET_SUFFIX =
  /^\s*(?:的)?\s*(?:时候|时|处|地方|位置|附近|那里|那儿|之后|以后|后|之前|以前|前(?!后)|了)/u;

/** 全角数字、字母和标点转半角，方便统一匹配。 */
function halfWidth(text: string): string {
  return Array.from(text, (char) => {
    const code = char.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) return String.fromCodePoint(code - 0xfee0);
    return code === 0x3000 ? ' ' : char;
  }).join('');
}

/** 一万以内的中文数字；「四千五」「三百五」按口语读成 4500、350。 */
function chineseSection(run: string): number | null {
  let total = 0;
  let digit: number | null = null;
  let lastUnit = 0;
  let afterUnit = false;
  for (const char of run) {
    const unit = CN_UNITS[char];
    if (unit !== undefined) {
      if (lastUnit && unit >= lastUnit) return null;
      total += (digit ?? 1) * unit;
      digit = null;
      lastUnit = unit;
      afterUnit = true;
      continue;
    }
    const value = CN_DIGITS[char];
    if (value === 0) {
      if (digit !== null) return null;
      afterUnit = false;
      continue;
    }
    if (digit !== null) return null;
    digit = value;
  }
  if (digit !== null) total += afterUnit ? (digit * lastUnit) / 10 : digit;
  return total;
}

function chineseNumber(run: string): number | null {
  if (!/[一二两三四五六七八九]/u.test(run)) return null;
  const parts = run.split('万');
  if (parts.length > 2) return null;
  if (parts.length === 1) return chineseSection(run);
  const [high, low] = parts;
  const highValue = high ? chineseSection(high) : null;
  if (!highValue) return null;
  if (!low) return highValue * 10000;
  // 「一万二」：万后面单独一个数字是千位。
  const lowValue = low.length === 1 ? (CN_DIGITS[low] ?? 0) * 1000 : chineseSection(low);
  return lowValue === null || lowValue === 0 ? null : highValue * 10000 + lowValue;
}

function scanNumbers(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const start = match.index;
    const end = start + match[0].length;
    if (match[1] !== undefined) {
      const multiplier = match[2] ? MULTIPLIERS[match[2].toLowerCase()] : 1;
      const value = Number(match[1]) * multiplier;
      if (value > 0) tokens.push({ start, end, low: value, high: value });
      continue;
    }
    const run = match[3];
    const colloquial = CN_RANGE.exec(run);
    if (colloquial !== null && CN_DIGITS[colloquial[2]] === CN_DIGITS[colloquial[1]] + 1) {
      // 「三四千字」「一两万字」。
      const unit = colloquial[3] === '万' ? 10000 : CN_UNITS[colloquial[3]];
      tokens.push({
        start,
        end,
        low: CN_DIGITS[colloquial[1]] * unit,
        high: CN_DIGITS[colloquial[2]] * unit,
      });
      continue;
    }
    const value = chineseNumber(run);
    if (value) tokens.push({ start, end, low: value, high: value });
  }
  return tokens;
}

function lastBreak(text: string, before: number, pattern: RegExp): number {
  for (let index = before - 1; index >= 0; index -= 1)
    if (pattern.test(text[index])) return index + 1;
  return 0;
}

function nextBreak(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1)
    if (CLAUSE_BREAK.test(text[index])) return index;
  return text.length;
}

/** 这个数是不是在说「这一部分」而不是整份稿子。 */
function aboutPartOfText(text: string, start: number, end: number): boolean {
  const clauseStart = lastBreak(text, start, CLAUSE_BREAK);
  if (PART_OF_TEXT.test(text.slice(clauseStart, start))) return true;
  const sentenceBefore = text.slice(lastBreak(text, start, SENTENCE_BREAK), clauseStart);
  if (!PART_OF_TEXT.test(sentenceBefore)) return false;
  return !WHOLE_TEXT.test(text.slice(clauseStart, nextBreak(text, end)));
}

function candidateAt(
  text: string,
  tokens: readonly NumberToken[],
  index: number,
): { candidate: Candidate | null; consumed: number } {
  const first = tokens[index];
  let low = first.low;
  let high = first.high;
  let end = first.end;
  let consumed = 1;
  let unit = UNIT.exec(text.slice(end));
  let approx = Boolean(unit?.[1]);
  if (unit) end += unit[0].length;
  let range = first.low !== first.high;
  const separator = RANGE_SEPARATOR.exec(text.slice(end));
  const second = tokens[index + 1];
  if (separator && second && second.start === end + separator[0].length) {
    // 「三到四千字」「3-4k 字」：前一个数沿用后一个数的量级。
    const scale =
      first.high < 10 && second.low >= 100 ? 10 ** Math.floor(Math.log10(second.low)) : 1;
    low = first.low * scale;
    high = second.high;
    end = second.end;
    consumed = 2;
    range = true;
    const secondUnit = UNIT.exec(text.slice(end));
    if (secondUnit) {
      end += secondUnit[0].length;
      approx ||= Boolean(secondUnit[1]);
    }
    unit ??= secondUnit;
  }
  const clauseStart = lastBreak(text, first.start, CLAUSE_BREAK);
  let lead = text.slice(clauseStart, first.start);
  const suffix = text.slice(end);
  const skip = { candidate: null, consumed };
  if (!unit && !WORD_COUNT_SUBJECT.test(lead)) return skip;
  if (ALREADY.test(lead) || NOT_A_TARGET_SUFFIX.test(suffix)) return skip;
  if (APPROX_SUFFIX.test(suffix)) approx = true;
  if (aboutPartOfText(text, first.start, end)) return skip;
  if (APPROX_LEAD.test(lead)) {
    lead = lead.replace(APPROX_LEAD, '');
    approx = true;
  }
  if (FROM_LEAD.test(lead)) {
    // 「从 6000 到 4000 字」：说的是改到后一个数。
    if (consumed !== 2) return skip;
    return { candidate: { kind: 'approx', low: high, high, strong: true }, consumed };
  }
  if (NOT_A_TARGET_LEAD.test(lead)) return skip;
  const upper = UPPER_SUFFIX.test(suffix);
  const lower = LOWER_SUFFIX.test(suffix);
  const span = { low: Math.min(low, high), high: Math.max(low, high) };
  if (range) {
    if (isVerbLead(lead)) return { candidate: { kind: 'range', ...span, strong: true }, consumed };
    if (PLAIN_LEAD.test(lead))
      return { candidate: { kind: 'range', ...span, strong: false }, consumed };
    return skip;
  }
  if (UPPER_LEAD.test(lead))
    return { candidate: { kind: 'upper', ...span, strong: true }, consumed };
  if (LOWER_LEAD.test(lead))
    return { candidate: { kind: 'lower', ...span, strong: true }, consumed };
  const kind: Kind = upper ? 'upper' : lower ? 'lower' : 'approx';
  if (isVerbLead(lead)) return { candidate: { kind, ...span, strong: true }, consumed };
  if (PLAIN_LEAD.test(lead) && (approx || upper || lower))
    return { candidate: { kind, ...span, strong: false }, consumed };
  return skip;
}

function isVerbLead(lead: string): boolean {
  return (
    UPPER_LEAD.test(lead) ||
    LOWER_LEAD.test(lead) ||
    (TARGET_LEAD.test(lead) && !NOT_A_VERB_LEAD.test(lead))
  );
}

function bounds(candidate: Candidate): [number | null, number | null] {
  switch (candidate.kind) {
    case 'upper':
      return [null, candidate.low];
    case 'lower':
      return [candidate.low, null];
    case 'range':
      return [candidate.low, candidate.high];
    case 'approx':
      return [
        Math.round(candidate.low * (1 - SINGLE_TARGET_TOLERANCE)),
        Math.round(candidate.low * (1 + SINGLE_TARGET_TOLERANCE)),
      ];
  }
}

/**
 * 从一句修订指令里认出目标字数。有「改成 / 压到 / 不超过」这类说法的优先；
 * 几处说法取交集（「至少 3000 字，不超过 4000 字」），交集为空就当说不清、不给目标。
 */
export function parseTargetLength(instruction: string): TargetLength | null {
  const text = halfWidth(instruction);
  const tokens = scanNumbers(text);
  const found: Candidate[] = [];
  for (let index = 0; index < tokens.length; ) {
    const { candidate, consumed } = candidateAt(text, tokens, index);
    if (candidate !== null) found.push(candidate);
    index += consumed;
  }
  const strong = found.filter((candidate) => candidate.strong);
  const chosen = strong.length ? strong : found;
  if (!chosen.length) return null;
  let min: number | null = null;
  let max: number | null = null;
  for (const candidate of chosen) {
    const [low, high] = bounds(candidate);
    if (low !== null) min = min === null ? low : Math.max(min, low);
    if (high !== null) max = max === null ? high : Math.min(max, high);
  }
  if (min !== null) min = Math.round(min);
  if (max !== null) max = Math.round(max);
  if (min !== null && max !== null && min > max) return null;
  return { min, max, approximate: chosen.some((candidate) => candidate.kind === 'approx') };
}

/** 作者原话里认得出目标就用它；认不出再看交给修订的那句指令。 */
export function revisionTargetLength(
  sources: readonly (string | null | undefined)[],
): TargetLength | null {
  for (const source of sources) {
    const target = source ? parseTargetLength(source) : null;
    if (target !== null) return target;
  }
  return null;
}

/** 修订稿按正文字数口径（空白以外的每个字）落在目标外才给提示；区间内不提示。 */
export function targetLengthHint(target: TargetLength | null, after: string): LengthHint | null {
  if (target === null) return null;
  const actual = countProseChars(after);
  let direction: 'over' | 'under';
  let offBy: number;
  if (target.max !== null && actual > target.max) {
    direction = 'over';
    offBy = actual - target.max;
  } else if (target.min !== null && actual < target.min) {
    direction = 'under';
    offBy = target.min - actual;
  } else return null;
  const goal =
    target.min !== null && target.max !== null
      ? `${target.approximate ? '约' : ''} ${target.min}–${target.max} 字`
      : target.max !== null
        ? `不超过 ${target.max} 字`
        : `至少 ${target.min} 字`;
  return {
    message: `字数提示：目标${goal}，这版实际 ${actual} 字（偏${direction === 'over' ? '多' : '少'} ${offBy} 字）。`,
    target_min: target.min,
    target_max: target.max,
    actual_chars: actual,
    direction,
    off_by: offBy,
  };
}
