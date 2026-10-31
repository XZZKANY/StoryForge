import { codePoints, PYTHON_WHITESPACE, pythonStrip } from '../kernel/pythonText';
import {
  insensitive,
  REDACTED,
  redactSensitiveText,
  type SecretContext,
} from '../kernel/redaction';

const THINK = insensitive('think');
const THINK_BLOCK = new RegExp(`<${THINK}>[\\s\\S]*?</${THINK}>`, 'gu');
const THINK_OPEN = new RegExp(`<${THINK}>`, 'gu');
const THINK_CLOSE = new RegExp(`</${THINK}>`, 'gu');
const LEADING_SPACE = new RegExp(`^${PYTHON_WHITESPACE}+`, 'u');
const lstrip = (text: string) => text.replace(LEADING_SPACE, '');

function lastCloseEnd(text: string): number | null {
  let end: number | null = null;
  for (const match of text.matchAll(THINK_CLOSE)) end = match.index! + match[0].length;
  return end;
}

/** 去掉 OpenAI 兼容模型漏出来的思维链标签（整段版）。 */
export function stripReasoningLeak(content: string): string {
  let cleaned = content.replace(THINK_BLOCK, '');
  // 最后一个闭合标签之前全丢：大小写变体也认，否则会静默砍掉正文开头。
  const end = lastCloseEnd(cleaned);
  if (end !== null) cleaned = cleaned.slice(end);
  return pythonStrip(cleaned.replace(THINK_OPEN, ''));
}

const OPEN_TEXT = '<think>';

/**
 * 流式版的思维链剥离：只覆盖真实泄漏形状——正文前先吐 `<think>…</think>`。
 * 能判定开头不是 think 块之前一律缓冲；见到闭合标签丢弃其前全部；流末残留再跑整段版兜底。
 */
export class StreamingReasoningFilter {
  private buffer = '';
  private passthrough = false;
  stripped = false;

  feed(chunk: string): string {
    if (!chunk) return '';
    if (this.passthrough) return chunk;
    this.buffer += chunk;
    const end = lastCloseEnd(this.buffer);
    if (end !== null) {
      const remainder = this.buffer.slice(end);
      this.buffer = '';
      this.passthrough = true;
      this.stripped = true;
      return lstrip(remainder);
    }
    const leading = lstrip(this.buffer).toLowerCase();
    if (leading.startsWith(OPEN_TEXT) || OPEN_TEXT.startsWith(leading)) return '';
    const emitted = this.buffer;
    this.buffer = '';
    this.passthrough = true;
    return emitted;
  }

  flush(): string {
    if (!this.buffer) return '';
    const remaining = this.buffer;
    this.buffer = '';
    const cleaned = stripReasoningLeak(remaining);
    if (cleaned !== remaining) this.stripped = true;
    return cleaned;
  }
}

// 未写完的密钥形词与赋值（含被拆在两次读之间的标记）先扣住不发布。
const MARKERS = [
  'sk-',
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'ghr_',
  'xoxb-',
  'xoxp-',
  'xoxa-',
  'xoxr-',
  'xoxs-',
  'aiza',
  'api-key',
  'api_key',
  'api key',
  'apikey',
  'authorization',
  'bearer',
  'token',
  'password',
  'secret',
  'credential',
];
// Python 的 (?i)：ASCII 字母类还接受土耳其 i 的两个变体、长 s 与开尔文符号。
const TOKEN_CLASS = '[A-Za-z\\u0130\\u0131\\u017F\\u212A0-9._:/+=@\\-]';
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}_])';
const END = '(?=\\n?$)';
const CANDIDATE = new RegExp(
  `${NOT_WORD_BEFORE}(?:${insensitive('sk')}-|${insensitive('gh')}[pPoOuUsS\\u017FrR]_|` +
    `${insensitive('xox')}[bBaApPrRsS\\u017F]-|${insensitive('aiza')})${TOKEN_CLASS}*${END}` +
    `|${NOT_WORD_BEFORE}(?:${insensitive('api')}[-_ ]?${insensitive('key')}|` +
    ['authorization', 'bearer', 'token', 'password', 'secret', 'credential']
      .map(insensitive)
      .join('|') +
    `)(?:${PYTHON_WHITESPACE}*[:=\\-]${PYTHON_WHITESPACE}*|${PYTHON_WHITESPACE}+)?${TOKEN_CLASS}*${END}`,
  'u',
);
const TOKEN_CHAR = /^[A-Za-z0-9._:/+=@-]$/;

/** 任意位置剥 think 块，并把不完整的密钥扣到能判定为止再发布。 */
export class VisibleTextFilter {
  private readonly secrets: readonly string[];
  private tagBuffer = '';
  private thinking = false;
  private pending = '';
  private dropping = false;
  stripped = false;

  /** `context` 是配置 owner 交来的完整有序密钥快照。 */
  constructor(private readonly context: SecretContext) {
    this.secrets = context.values;
  }

  feed(text: string): string {
    this.tagBuffer += text;
    const visible: string[] = [];
    while (this.tagBuffer) {
      const lower = this.tagBuffer.toLowerCase();
      const tag = this.thinking ? '</think>' : '<think>';
      const index = lower.indexOf(tag);
      if (index >= 0) {
        if (!this.thinking) visible.push(this.tagBuffer.slice(0, index));
        this.tagBuffer = this.tagBuffer.slice(index + tag.length);
        this.thinking = !this.thinking;
        this.stripped = true;
        continue;
      }
      let keep = 0;
      for (let size = 1; size < tag.length; size++)
        if (lower.endsWith(tag.slice(0, size))) keep = size;
      const end = this.tagBuffer.length - keep;
      if (!this.thinking) visible.push(this.tagBuffer.slice(0, end));
      this.tagBuffer = this.tagBuffer.slice(end);
      break;
    }
    return this.redact(visible.join(''));
  }

  private redact(input: string, final = false): string {
    let text = input;
    if (this.dropping) {
      let offset = 0;
      let found = false;
      for (const char of text) {
        if (!TOKEN_CHAR.test(char)) {
          found = true;
          break;
        }
        offset += char.length;
      }
      if (!found) return '';
      text = text.slice(offset);
      this.dropping = false;
    }
    this.pending += text;
    if (final) {
      const result = redactSensitiveText(this.pending, this.context);
      this.pending = '';
      return result;
    }
    let cut = this.pending.length;
    const candidate = CANDIDATE.exec(this.pending);
    if (candidate) cut = candidate.index;
    for (const marker of [...MARKERS, ...this.secrets]) {
      const haystack = this.secrets.includes(marker) ? this.pending : this.pending.toLowerCase();
      const chars = codePoints(marker);
      for (let size = Math.min(chars.length, codePoints(haystack).length); size > 0; size--) {
        const prefix = chars.slice(0, size).join('');
        if (haystack.endsWith(prefix)) {
          cut = Math.min(cut, haystack.length - prefix.length);
          break;
        }
      }
    }
    // 已知密钥内部出现的通用标记，不能把密钥前半截放出去。
    let previous = -1;
    while (previous !== cut) {
      previous = cut;
      for (const secret of this.secrets) {
        let start = this.pending.indexOf(secret);
        while (start >= 0) {
          if (start < cut && cut < start + secret.length) cut = start;
          start = this.pending.indexOf(secret, start + 1);
        }
      }
    }
    const ready = this.pending.slice(0, cut);
    this.pending = this.pending.slice(cut);
    let result = redactSensitiveText(ready, this.context);
    if (codePoints(this.pending).length > 4096) {
      // 不为了释放内存而发布一段无界的可疑 ASCII 串。
      this.pending = '';
      this.dropping = true;
      result += REDACTED;
    }
    return result;
  }

  /** 流末：未闭合的 think 标签 / 块不可发布。 */
  finish(): string {
    this.tagBuffer = '';
    return this.redact('', true);
  }
}
