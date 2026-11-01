import { dumpJson } from './json';
import { countOf, PYTHON_WHITESPACE } from './pythonText';
import { sha256Hex } from './sha256';

/**
 * 显式、绑定原文的编辑授权，writer 与后处理共用。自由文本要求仍交给 writer；
 * 只有被识别的显式控制才变成确定性权限，引号里的材料不会被当成命令。
 *
 * 下标一律是 UTF-16 码元（与 Python 的码点下标不同单位，但内部自洽）。被涂白的材料里，
 * 增补平面字符用「空格 + 填充符」占两个码元，判定时把填充符当空白、计长度时不计。
 */
export const POLICY_VERSION = 'author-edit-v1';

const FILLER = String.fromCharCode(0xffff);
// Python 的 \s；填充符只出现在 Python 那边是一个空格的位置，所以同样算空白。
const WS = `[${PYTHON_WHITESPACE.slice(1, -1)}${FILLER}]`;
const QUOTE_END: Readonly<Record<string, string>> = {
  '“': '”',
  '「': '」',
  '『': '』',
  '‘': '’',
  '"': '"',
  "'": "'",
};
const ANCHOR = /<<<(?:ANCHOR|FILE|CONTEXT)(?![\p{L}\p{N}_])[\s\S]*?(?:ANCHOR|FILE|CONTEXT)>>>/gu;
const CHANGE = /统一|替换|换成|换为|改成|改为|转换|调整|改用|修改|更改|改/gu;
const NEGATION =
  /(?:不要|不用|不必|别|禁止|不得|不准|不许|请勿|勿|不允许|不可以|不可|不|避免)[一-鿿]{0,6}$/u;
const KEEP_PREFIX = new RegExp(`(?:(?:逐字|原样)${WS}*)?(?:保留|保持)${WS}*$`, 'u');
const KEEP_SUFFIX_AT_START = new RegExp(
  `^${WS}*(?:逐字(?:不变|保留|不动)|原样(?:不变|保留)?|不动)`,
  'u',
);
const KEEP_SUFFIX_ANYWHERE = new RegExp(
  `${WS}*(?:逐字(?:不变|保留|不动)|原样(?:不变|保留)?|不动)`,
  'u',
);
// 两个引用之间只能经过未引用文本；不枚举自然语言连接词。
const NEXT_KEEP = new RegExp(`^[^“”「」『』‘’"'\`~]*?(?:保留|保持)${WS}*(?=[“「『‘"'])`, 'u');
const ADOPT_PREFIX = new RegExp(
  `^${WS}*(?:请|本次(?:请|要求)|我的要求是|作者要求是)?(?:执行|遵循|采用|应用|按照|按)${WS}*(?:(?:下面|以下|这条|这个|此)(?:的)?)?` +
    `${WS}*(?:(?:作者)?(?:要求|指令|规则|约定|命令))?${WS}*(?:执行|处理|修改|修订)?${WS}*[:：]?${WS}*$`,
  'u',
);
const ADOPT_SUFFIX = new RegExp(
  `^${WS}*[,，:：]?${WS}*(?:(?:这|此)(?:条|句)?(?:才)?是(?:我|作者)的(?:明确|实际|真实)?(?:要求|指令)` +
    `|请(?:照做|执行|遵循|采用)|(?:当作|作为)(?:我的|作者的)(?:要求|指令)执行)${WS}*(?:[。；;\\n]|$)`,
  'u',
);
const KEEP_REQUIREMENT = new RegExp(
  `(?:(?:逐字|原样)${WS}*)?(?:保留|保持)${WS}*(?=[“「『‘"'])`,
  'gu',
);
const NEGATION_NOISE = new RegExp(`${WS}|[“”「」『』‘’"']`, 'gu');
const RSTRIP = new RegExp(`${WS}+$`, 'u');
const CONTROL_OPERANDS = new Set([
  '第一人称',
  '第二人称',
  '第三人称',
  '引号',
  '直引号',
  '中文引号',
  '重复问号',
  '重复感叹号',
]);

const asciiAlnum = (char: string | undefined) => char !== undefined && /^[A-Za-z0-9]$/.test(char);
const codePointLength = (text: string) => Array.from(text.split(FILLER).join('')).length;

/** 作者控制识别失败：例如逐字保留的片段找不到、引号边界无法确定。 */
export class AuthorEditPolicyError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorEditPolicyError';
  }
}

function controlIsNegated(text: string, offset: number): boolean {
  return NEGATION.test(text.slice(0, offset).replace(NEGATION_NOISE, ''));
}

/** 成对的数据 / 范围定界符，保留同种嵌套。 */
function pairedQuoteEnd(
  text: string,
  start: number,
  opening: string,
  closing: string,
): number | null {
  let depth = 1;
  for (let index = start + 1; index < text.length; index++) {
    const current = text[index];
    if (current === opening) depth += 1;
    else if (current === closing) {
      if (
        current === '’' &&
        index + 1 < text.length &&
        asciiAlnum(text[index - 1]) &&
        asciiAlnum(text[index + 1])
      )
        continue;
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

/** 显式逐字保留的字面量是数据：ASCII 标点与反斜杠都不是语法。 */
function literalQuoteEnd(
  text: string,
  start: number,
  source: string,
  enclosingCloser: string | null = null,
): number | null {
  const opening = text[start];
  const closing = Object.prototype.hasOwnProperty.call(QUOTE_END, opening)
    ? QUOTE_END[opening]
    : undefined;
  if (closing === undefined || !KEEP_PREFIX.test(text.slice(0, start))) return null;
  if (opening !== closing) return pairedQuoteEnd(text, start, opening, closing);
  // 对称定界符也可能是原文数据（英寸记号）：由显式保留后缀认出收尾。
  let limit = text.length;
  if (enclosingCloser) {
    const enclosingOpener = Object.keys(QUOTE_END).find(
      (key) => QUOTE_END[key] === enclosingCloser,
    )!;
    if (enclosingOpener !== enclosingCloser) {
      const boundary = pairedQuoteEnd(text, start, enclosingOpener, enclosingCloser);
      if (boundary !== null) limit = boundary - 1;
    } else {
      const boundary = text.indexOf(enclosingCloser, start + 1);
      if (boundary >= 0) limit = boundary;
    }
  }
  let directiveEnd: number | null = null;
  for (let index = start + 1; index < limit; index++) {
    if (text[index] !== closing) continue;
    const suffix = text.slice(index + 1, limit);
    if (KEEP_SUFFIX_AT_START.test(suffix)) {
      // 完整后缀引用若逐字命中原文，内部「并保留」等只是正文数据。
      if (directiveEnd === null || source.includes(text.slice(start + 1, index))) return index + 1;
      return directiveEnd;
    }
    if (directiveEnd === null && NEXT_KEEP.test(suffix)) directiveEnd = index + 1;
  }
  return directiveEnd;
}

type Material = { start: number; end: number; marker: string; closing: string; closed: boolean };

/** 顶层引用 / 代码区域；未闭合的区域吞掉余下全文。 */
function quotedMaterial(text: string, source: string): Material[] {
  const regions: Material[] = [];
  let index = 0;
  while (index < text.length) {
    const start = index;
    const char = text[index];
    if (char === '`' || text.startsWith('~~~', index)) {
      let end = index + 1;
      while (end < text.length && text[end] === char) end += 1;
      const marker = text.slice(index, end);
      const close = new RegExp(`(?<!${char})${marker}(?!${char})`).exec(text.slice(end));
      index = close ? end + close.index + close[0].length : text.length;
      regions.push({ start, end: index, marker, closing: marker, closed: close !== null });
      continue;
    }
    if (
      !Object.prototype.hasOwnProperty.call(QUOTE_END, char) ||
      (char === "'" && index > 0 && asciiAlnum(text[index - 1]))
    ) {
      index += 1;
      continue;
    }
    const closing = QUOTE_END[char];
    const literalEnd = literalQuoteEnd(text, start, source);
    if (literalEnd !== null) {
      index = literalEnd;
      regions.push({ start, end: index, marker: char, closing, closed: true });
      continue;
    }
    const stack = [closing];
    index += 1;
    while (index < text.length && stack.length) {
      const current = text[index];
      const nested = literalQuoteEnd(text, index, source, stack[stack.length - 1]);
      if (nested !== null) {
        index = nested;
        continue;
      }
      // 英文单词里的撇号不关闭外层示例引号（I'm / Don’t）。
      if (
        (current === "'" || current === '’') &&
        index + 1 < text.length &&
        asciiAlnum(text[index - 1]) &&
        asciiAlnum(text[index + 1])
      ) {
        index += 1;
        continue;
      }
      if (current === '\\' && index + 1 < text.length) {
        index += 2;
        continue;
      }
      if (current === stack[stack.length - 1]) stack.pop();
      else if (
        Object.prototype.hasOwnProperty.call(QUOTE_END, current) &&
        !(current === "'" && asciiAlnum(text[index - 1]))
      )
        stack.push(QUOTE_END[current]);
      index += 1;
    }
    regions.push({ start, end: index, marker: char, closing, closed: !stack.length });
  }
  return regions;
}

function hasLiteralKeepRequirement(text: string): boolean {
  for (const keep of text.matchAll(KEEP_REQUIREMENT)) {
    if (
      !controlIsNegated(text, keep.index!) &&
      (keep[0].startsWith('逐字') ||
        keep[0].startsWith('原样') ||
        KEEP_SUFFIX_ANYWHERE.test(text.slice(keep.index! + keep[0].length)))
    )
      return true;
  }
  return false;
}

/** 涂白引号材料：换行保留，其余每个码点变一个空格（增补平面字符补一个填充符保持码元长度）。 */
function blank(raw: string): string {
  let output = '';
  for (const char of raw) output += char === '\n' ? '\n' : char.length === 2 ? ' ' + FILLER : ' ';
  return output;
}

/**
 * 原样保留作者指令给 writer，同时只在引号材料之外抽取控制。被明确采纳的引号规则与
 * 引号里的控制对象名仍然有效；逐字保护消耗掉的引号内容只当数据。
 */
function authorControlProjection(text: string, source: string, depth = 0): [string, string[]] {
  if (depth >= 16) {
    if (hasLiteralKeepRequirement(text))
      throw new AuthorEditPolicyError('逐字保留要求嵌套过深，请直接指定需要保护的原文片段。');
    return [' '.repeat(text.length), []];
  }
  const projected = text.split('');
  const literals: string[] = [];
  for (const { start, end, marker, closing, closed } of quotedMaterial(text, source)) {
    const raw = text.slice(start, end);
    const body = closed
      ? raw.slice(marker.length, raw.length - closing.length)
      : raw.slice(marker.length);
    const prefix = projected.slice(0, start).join('');
    const suffix = text.slice(end);
    const keep = KEEP_PREFIX.exec(prefix);
    const segments = prefix.replace(RSTRIP, '').split(/[。；;\n]/u);
    const adoption = ADOPT_PREFIX.test(segments[segments.length - 1]);
    const keepHead = keep !== null && (keep[0].startsWith('逐字') || keep[0].startsWith('原样'));
    if (!closed) {
      const directKeep =
        keep !== null &&
        !controlIsNegated(prefix, keep.index) &&
        (keepHead || KEEP_SUFFIX_ANYWHERE.test(body));
      // 被明确采纳的正文用同一套材料边界检查；未采纳示例里的保留字样保持惰性。
      const nestedKeep = adoption ? authorControlProjection(body, source, depth + 1)[1] : [];
      if (directKeep || nestedKeep.length)
        throw new AuthorEditPolicyError(
          '无法确定逐字保留片段的引号边界，请使用完整配对引号重新指定。',
        );
    }
    const literalKeep =
      closed &&
      Boolean(body) &&
      keep !== null &&
      !controlIsNegated(prefix, keep.index) &&
      (keepHead || KEEP_SUFFIX_AT_START.test(suffix));
    if (literalKeep) literals.push(body);
    const adopted = closed && !literalKeep && (adoption || ADOPT_SUFFIX.test(suffix));
    let replacement: string;
    if (adopted || (closed && CONTROL_OPERANDS.has(body) && !literalKeep)) {
      const [inner, nested] = authorControlProjection(body, source, depth + 1);
      replacement = ' '.repeat(marker.length) + inner + ' '.repeat(closing.length);
      literals.push(...nested);
    } else {
      replacement = blank(raw);
    }
    projected.splice(start, end - start, ...replacement.split(''));
  }
  return [projected.join(''), literals];
}

function quoteChangeControl(clause: string): boolean | null {
  const quotes = [...clause.matchAll(/引号/gu)];
  for (const change of clause.matchAll(CHANGE)) {
    const changeEnd = change.index! + change[0].length;
    for (const quote of quotes) {
      const [left, right] =
        change.index! < quote.index!
          ? [changeEnd, quote.index!]
          : [quote.index! + quote[0].length, change.index!];
      const bridge = clause.slice(left, right);
      if (codePointLength(bridge) <= 12 && !/并|但|同时|再|而|错字|人称|句子|段落/u.test(bridge))
        return !controlIsNegated(clause, change.index!);
    }
  }
  return null;
}

export type ProtectedSpan = { start: number; end: number };

export type AuthorEditPolicy = {
  source_sha256: string;
  author_requirements: string[];
  instruction: string;
  baseline: string;
  allowed_punctuation_forms: Set<string>;
  preserve_repeated_marks: boolean;
  allow_person_change: boolean;
  protected_spans: ProtectedSpan[];
  version: string;
};

export function authorEditPolicySummary(policy: AuthorEditPolicy) {
  return {
    version: policy.version,
    source_sha256: policy.source_sha256,
    author_requirement_count: policy.author_requirements.length,
    baseline_present: Boolean(policy.baseline),
    allowed_punctuation_forms: [...policy.allowed_punctuation_forms].sort(),
    preserve_repeated_marks: policy.preserve_repeated_marks,
    allow_person_change: policy.allow_person_change,
    protected_span_count: policy.protected_spans.length,
  };
}

/** 作者原话：去掉锚点 / 文件 / 上下文块与后接的约束、审稿附件。 */
export function authorCommandText(instruction: string): string {
  const text = instruction.replace(ANCHOR, '');
  const markers = [
    '<<<ANCHOR',
    '<<<FILE',
    '<<<CONTEXT',
    '\n\n最小改动约束',
    '\n\n上一轮多视角审稿报告',
  ]
    .map((marker) => text.indexOf(marker))
    .filter((index) => index >= 0);
  return markers.length ? text.slice(0, Math.min(...markers)) : text;
}

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (
    let index = haystack.indexOf(needle);
    index >= 0;
    index = haystack.indexOf(needle, index + needle.length)
  )
    found.push(index);
  return found;
}

const isStripped = (text: string) => new RegExp(`^${WS}*$`, 'u').test(text);

export function buildAuthorEditPolicy(
  original: string,
  options: {
    instruction?: string;
    authorRequirements?: readonly unknown[];
    baseline?: string;
    protectedSpans?: readonly ProtectedSpan[];
  } = {},
): AuthorEditPolicy {
  const requirements = [
    ...new Set(
      (options.authorRequirements ?? []).filter(
        (text): text is string => typeof text === 'string' && !isStripped(text),
      ),
    ),
  ];
  const command = authorCommandText(options.instruction ?? '');
  const allowed = new Set<string>();
  let preserveRepeated = false;
  let personChange = false;
  const spans: ProtectedSpan[] = [...(options.protectedSpans ?? [])];
  for (const text of [...requirements, command]) {
    const [authorised, literals] = authorControlProjection(authorCommandText(text), original);
    for (const literal of literals) {
      const found = occurrences(original, literal);
      if (!found.length)
        throw new AuthorEditPolicyError('明确要求逐字保留的片段不在当前正文中，请重新指定。');
      spans.push(...found.map((start) => ({ start, end: start + literal.length })));
    }
    for (const clause of authorised.split(/[。；;，,\n]/u)) {
      if (clause.includes('引号')) {
        const control = quoteChangeControl(clause);
        if (control === true) allowed.add('quotes');
        else if (control === false || /保留|保持|不改|不要改|别改|不调整|不要调整/u.test(clause))
          allowed.delete('quotes');
      }
      const repeated =
        /(?:保留|保持)[^\n]*(?:重复|连续)[^\n]*(?:问号|感叹号)|(?:不折|不要折|不合并)[^\n]*(?:问号|感叹号)/u.exec(
          clause,
        );
      // 后出现的明确否定也撤回较早的文件控制。
      if (repeated) preserveRepeated = !controlIsNegated(clause, repeated.index);
      if (
        /(?:重复|连续)[^\n]*(?:问号|感叹号)[^\n]*(?:折成一个|合并成一个)/u.test(clause) &&
        !clause.includes('不要')
      )
        preserveRepeated = false;
      const person = /(?:改为|改成|换成|转换为|改用)[^\n]*(?:第一|第二|第三)人称/u.exec(clause);
      if (person) personChange = !controlIsNegated(clause, person.index);
      if (clause.includes('人称') && /不改|不要改|别改|保留|保持/u.test(clause))
        personChange = false;
    }
  }
  const unique = [
    ...new Map(spans.map((span) => [`${span.start}:${span.end}`, span])).values(),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  if (unique.length > 64) throw new AuthorEditPolicyError('明确保护片段超过预算，请分批指定。');
  let previous = 0;
  for (const span of unique) {
    if (
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      !(span.start >= 0 && span.start < span.end && span.end <= original.length) ||
      span.start < previous
    )
      throw new AuthorEditPolicyError('明确保护片段范围无效或重叠。');
    previous = span.end;
  }
  return {
    source_sha256: sha256Hex(original),
    author_requirements: requirements,
    instruction: command,
    baseline: options.baseline ?? '',
    allowed_punctuation_forms: allowed,
    preserve_repeated_marks: preserveRepeated,
    allow_person_change: personChange,
    protected_spans: unique,
    version: POLICY_VERSION,
  };
}

export function authorEditPolicyPrompt(policy: AuthorEditPolicy): string {
  const lines = [
    '本次编辑政策（writer、后处理与本地候选共用）：',
    dumpJson(authorEditPolicySummary(policy), { ensureAscii: false }),
  ];
  if (policy.baseline) lines.push('历史声音统计仅作参考，不能覆盖作者声明：', policy.baseline);
  if (policy.author_requirements.length)
    lines.push('作者声明的声音与保留要求：', ...policy.author_requirements);
  lines.push('当前真实作者要求：', policy.instruction || '没有额外编辑授权。');
  if (policy.allowed_punctuation_forms.has('quotes'))
    lines.push('本次明确允许修改正文引号形态；这不授权改受保护结构或其他未点名内容。');
  if (policy.preserve_repeated_marks) lines.push('重复问号和感叹号必须原样保留，不能折成单个。');
  return lines.join('\n');
}

const REPEATED_MARKS = /[？?！!]{2,}/gu;

export function authorEditPolicyFailures(
  original: string,
  candidate: string,
  policy: AuthorEditPolicy,
): string[] {
  if (
    policy.version !== POLICY_VERSION ||
    [...policy.allowed_punctuation_forms].some((form) => form !== 'quotes')
  )
    return ['edit_policy_invalid'];
  if (policy.source_sha256 !== sha256Hex(original)) return ['edit_policy_source_mismatch'];
  if (policy.protected_spans.length > 64) return ['edit_policy_invalid'];
  let previous = 0;
  for (const span of policy.protected_spans) {
    if (
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      !(span.start >= 0 && span.start < span.end && span.end <= original.length) ||
      span.start < previous
    )
      return ['edit_policy_invalid'];
    previous = span.end;
  }
  let end = 0;
  for (const span of policy.protected_spans) {
    const literal = original.slice(span.start, span.end);
    const offset = candidate.indexOf(literal, end);
    if (offset < 0 || countOf(candidate, literal) !== countOf(original, literal))
      return ['protected_span_changed'];
    end = offset + literal.length;
  }
  if (policy.preserve_repeated_marks) {
    const before = original.match(REPEATED_MARKS) ?? [];
    const after = candidate.match(REPEATED_MARKS) ?? [];
    if (before.length !== after.length || before.some((mark, i) => mark !== after[i]))
      return ['protected_emphasis_changed'];
  }
  return [];
}
