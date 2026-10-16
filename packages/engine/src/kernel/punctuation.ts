/** Dialogue forms shared by prose scans and polishing; use matchAll/replace, not exec state. */
export const DIALOGUE_PATTERN = /“[^“”]*”|「[^「」]*」|『[^『』]*』|"[^"\n]*"/gsu;

/**
 * 全角 / 半角的同一个标点也算「只是形态变了」（2026-10-14 起，只在 TS；Python 的折叠表没有这几对）：
 * 模型把整篇的 `，` 换成 `,` 时，没点名的行要还原，改动比例也不该被这种漂移撑大。
 * 不折 `。`：它和 `.` / `…` 混在一起会把刻意改成省略号的那一下也当成漂移。
 */
const WIDTH_FOLDS: Readonly<Record<string, string>> = {
  '，': ',',
  '：': ':',
  '；': ';',
  '？': '?',
  '！': '!',
  '（': '(',
  '）': ')',
};

const FOLDS: Readonly<Record<string, string>> = {
  ...WIDTH_FOLDS,
  '“': '"',
  '”': '"',
  '「': '"',
  '」': '"',
  '『': '"',
  '』': '"',
  '„': '"',
  '‟': '"',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '―': '-',
  '…': '.',
  '\u00a0': ' ',
  '\u3000': ' ',
  '\u2007': ' ',
  '\u202f': ' ',
};

/** Comparison only: never write this normalized text back to the manuscript. */
export function canonicalPunctuation(text: string): string {
  return Array.from(text, (character) => FOLDS[character] ?? character)
    .join('')
    .replace(/([.\- ])\1+/g, '$1');
}

// SequenceMatcher(None, before, after, autojunk=False): longest contiguous match,
// ties prefer earliest before position, then earliest after position. No junk pruning.
function matchingLines(
  before: readonly string[],
  after: readonly string[],
): [number, number, number][] {
  const positions = new Map<string, number[]>();
  after.forEach((line, index) => {
    const indices = positions.get(line) ?? [];
    indices.push(index);
    positions.set(line, indices);
  });
  const pending: [number, number, number, number][] = [[0, before.length, 0, after.length]];
  const matches: [number, number, number][] = [];
  while (pending.length > 0) {
    const [beforeStart, beforeEnd, afterStart, afterEnd] = pending.pop()!;
    let bestBefore = beforeStart;
    let bestAfter = afterStart;
    let bestSize = 0;
    let lengths = new Map<number, number>();
    for (let i = beforeStart; i < beforeEnd; i++) {
      const next = new Map<number, number>();
      for (const j of positions.get(before[i]) ?? []) {
        if (j < afterStart) continue;
        if (j >= afterEnd) break;
        const size = (lengths.get(j - 1) ?? 0) + 1;
        next.set(j, size);
        if (size > bestSize) {
          bestBefore = i - size + 1;
          bestAfter = j - size + 1;
          bestSize = size;
        }
      }
      lengths = next;
    }
    if (bestSize > 0) {
      matches.push([bestBefore, bestAfter, bestSize]);
      if (beforeStart < bestBefore && afterStart < bestAfter)
        pending.push([beforeStart, bestBefore, afterStart, bestAfter]);
      if (bestBefore + bestSize < beforeEnd && bestAfter + bestSize < afterEnd)
        pending.push([bestBefore + bestSize, beforeEnd, bestAfter + bestSize, afterEnd]);
    }
  }
  // Adjacent equal blocks need no coalescing when reconstructing lines, unlike opcodes.
  return matches.sort(([a, b], [c, d]) => a - c || b - d);
}

function punctuationUnits(text: string): [string, string][] {
  const units: [string, string][] = [];
  for (const character of text) {
    const canonical = FOLDS[character] ?? character;
    const last = units[units.length - 1];
    if ('.- '.includes(canonical) && last?.[0] === canonical) last[1] += character;
    else units.push([canonical, character]);
  }
  return units;
}

/** Restore only canonically equal lines; a wholly punctuation-only edit remains intentional. */
export function restoreIncidentalPunctuation(
  before: string,
  after: string,
  editPolicy: { readonly allowed_punctuation_forms: ReadonlySet<string> } | null = null,
): string {
  if (before === after) return after;
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const original = beforeLines.map(canonicalPunctuation);
  const candidate = afterLines.map(canonicalPunctuation);
  if (original.length === candidate.length && original.every((line, i) => line === candidate[i]))
    return after;
  const restored: string[] = [];
  let position = 0;
  for (const [i, j, size] of matchingLines(original, candidate)) {
    for (; position < j; position++) restored.push(afterLines[position]);
    for (let offset = 0; offset < size; offset++) {
      const old = beforeLines[i + offset];
      const next = afterLines[j + offset];
      if (!editPolicy?.allowed_punctuation_forms.has('quotes')) restored.push(old);
      else {
        const newUnits = punctuationUnits(next);
        restored.push(
          punctuationUnits(old)
            .map(([canonical, raw], index) =>
              canonical === '"' || canonical === "'" ? newUnits[index][1] : raw,
            )
            .join(''),
        );
      }
    }
    position = j + size;
  }
  for (; position < afterLines.length; position++) restored.push(afterLines[position]);
  return restored.join('\n');
}

// 起草统一成全角（2026-10-15 作者拍板）：模型偶尔整章写成半角逗号与直引号，只看相邻字符判断是不是中文语境，
// 两侧都不是中文（数字、英文、网址、Markdown 语法）就不动（fullwidth_cjk_punctuation）。
const HAN_RANGES: readonly (readonly [number, number])[] = [
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0x20000, 0x3134f],
];
const CJK_MARKS = '“”‘’…—';
const CONTEXT_FULLWIDTH: Readonly<Record<string, string>> = {
  ',': '，',
  '?': '？',
  '!': '！',
  ';': '；',
};
// 转成这些全角标点后，紧跟的一个半角空格是半角排版的残留。
const SPACE_EATERS = new Set(['，', '。', '？', '！', '；', '：']);

const han = (char: string | null): boolean => {
  if (char === null) return false;
  const code = char.codePointAt(0) as number;
  return HAN_RANGES.some(([low, high]) => low <= code && code <= high);
};

const cjk = (char: string | null): boolean => {
  if (char === null) return false;
  const code = char.codePointAt(0) as number;
  return (
    han(char) ||
    (0x3000 <= code && code <= 0x303f) ||
    (0xff00 <= code && code <= 0xffef) ||
    CJK_MARKS.includes(char)
  );
};

const asciiAlnum = (char: string): boolean => /^[A-Za-z0-9]$/.test(char);

/**
 * 中文语境里的半角标点统一成全角，返回新文本与改动处数（一串省略号或破折号算一处）。
 * 引号与括号按行成对处理：一行里直引号个数为奇数、括号配不上对、括号里没有汉字时都不动，留给作者看。
 */
export function fullwidthCjkPunctuation(text: string): [string, number] {
  let total = 0;
  const lines = text.split('\n').map((line) => {
    const [converted, count] = fullwidthLine(Array.from(line));
    total += count;
    return converted;
  });
  return [lines.join('\n'), total];
}

function pairedMarks(chars: string[]): Map<number, string> {
  const pairs = new Map<number, string>();
  if (!chars.some(han)) return pairs;
  const doubles = chars.flatMap((char, index) => (char === '"' ? [index] : []));
  // 两侧都是英文字母或数字的单引号是撇号（don't、90's），不算引号。
  const singles = chars.flatMap((char, index) =>
    char === "'" &&
    !(
      0 < index &&
      index < chars.length - 1 &&
      asciiAlnum(chars[index - 1]) &&
      asciiAlnum(chars[index + 1])
    )
      ? [index]
      : [],
  );
  for (const [positions, left, right] of [
    [doubles, '“', '”'],
    [singles, '‘', '’'],
  ] as const) {
    if (positions.length % 2 === 0)
      positions.forEach((index, order) => pairs.set(index, order % 2 === 0 ? left : right));
  }
  const opened: number[] = [];
  chars.forEach((char, index) => {
    if (char === '(') opened.push(index);
    else if (char === ')' && opened.length) {
      const start = opened.pop() as number;
      // `](` 是 Markdown 链接。
      if (!(start > 0 && chars[start - 1] === ']') && chars.slice(start + 1, index).some(han)) {
        pairs.set(start, '（');
        pairs.set(index, '）');
      }
    }
  });
  return pairs;
}

function fullwidthLine(chars: string[]): [string, number] {
  const pairs = pairedMarks(chars);
  const out: string[] = [];
  let count = 0;
  let index = 0;
  while (index < chars.length) {
    const char = chars[index];
    let end = index + 1;
    let piece: string | null;
    if (pairs.has(index)) piece = pairs.get(index) as string;
    else {
      while ('.-…—'.includes(char) && end < chars.length && chars[end] === char) end += 1;
      const tail = out.length ? Array.from(out[out.length - 1]) : [];
      const last = tail.length ? tail[tail.length - 1] : null;
      const after = end < chars.length ? chars[end] : null;
      piece = fullwidthPiece(char, end - index, last, after);
    }
    if (piece === null) out.push(chars.slice(index, end).join(''));
    else {
      out.push(piece);
      count += 1;
      if (
        SPACE_EATERS.has(piece) &&
        end + 1 < chars.length &&
        chars[end] === ' ' &&
        (cjk(chars[end + 1]) || '"\''.includes(chars[end + 1]))
      )
        end += 1;
    }
    index = end;
  }
  return [out.join(''), count];
}

function fullwidthPiece(
  char: string,
  run: number,
  last: string | null,
  after: string | null,
): string | null {
  const context = cjk(last) || cjk(after);
  if (char === '.') {
    if (run >= 3) return context ? '……' : null;
    if (run === 1 && cjk(last) && (after === null || ' \t\r"\''.includes(after) || cjk(after)))
      return '。';
    return null;
  }
  if (char === '-') return run >= 2 && context ? '——' : null;
  if (char === '…' || char === '—') return run === 1 && context ? char.repeat(2) : null;
  if (char === ':') return cjk(last) ? '：' : null;
  if (char === '!' && after === '[') return null; // Markdown 图片
  if (char in CONTEXT_FULLWIDTH && context) return CONTEXT_FULLWIDTH[char];
  return null;
}
