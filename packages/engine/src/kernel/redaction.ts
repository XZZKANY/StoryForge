import { PYTHON_WHITESPACE } from './pythonText';

export const REDACTED = '[REDACTED]';
/** Complete, ordered configured_secret_values snapshot supplied by the configuration owner.
 * This pure module never reads environment, settings, storage or provider credentials.
 */
export type SecretContext = { readonly values: readonly string[] };
/** 浏览器 JSON 值：命令参数与载荷。字符串须是合法 Unicode（由调用方在入口校验）。 */
export type PlainJson =
  | null
  | boolean
  | number
  | string
  | PlainJson[]
  | { [key: string]: PlainJson };

const exact = new Set([
  'apikey',
  'authorization',
  'authtoken',
  'bearer',
  'credential',
  'credentials',
  'password',
  'passwd',
  'secret',
  'token',
]);
const sensitiveTokens = new Set([
  'authorization',
  'bearer',
  'credential',
  'credentials',
  'password',
  'passwd',
  'secret',
]);
const diagnostics = new Set([
  'available',
  'configured',
  'enabled',
  'present',
  'required',
  'status',
]);
const pairs = new Set([
  'api key',
  'api token',
  'access token',
  'refresh token',
  'auth token',
  'bearer token',
]);

export function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  const tokens = key
    .split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (
    tokens.length >= 2 &&
    (tokens[0] === 'has' || tokens[0] === 'is' || diagnostics.has(tokens[tokens.length - 1]))
  )
    return false;
  const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  if (
    exact.has(normalized) ||
    normalized.includes('apikey') ||
    tokens.some((token) => sensitiveTokens.has(token))
  )
    return true;
  if (tokens.some((token, i) => i > 0 && pairs.has(tokens[i - 1] + ' ' + token))) return true;
  return tokens.length === 1 && (tokens[0] === 'auth' || tokens[0] === 'token');
}

// Python IGNORECASE with ASCII letters also accepts İ/ı, ſ and K.
export function insensitive(word: string): string {
  return Array.from(word, (char) =>
    char === 'i'
      ? '[iIİı]'
      : char === 's'
        ? '[sSſ]'
        : char === 'k'
          ? '[kKK]'
          : `[${char}${char.toUpperCase()}]`,
  ).join('');
}
type Pattern = { matcher: RegExp; full: RegExp; endBoundary: boolean; capture: boolean };
function pattern(source: string, endBoundary = false, capture = false): Pattern {
  return {
    matcher: new RegExp(source, 'g'),
    full: new RegExp(`^(?:${source})$`),
    endBoundary,
    capture,
  };
}
const credentialWords = [
  'authorization',
  'bearer',
  'token',
  'password',
  'secret',
  'credential',
].map(insensitive);
const apiKey = `${insensitive('api')}[-_ ]?${insensitive('key')}`;
const value = '[A-Za-zİıſK0-9._:/+=@\\-]{6,}';
const patterns: readonly Pattern[] = [
  pattern(
    `(${[apiKey, ...credentialWords].join('|')})${PYTHON_WHITESPACE}*[:=]${PYTHON_WHITESPACE}*(${value})`,
    false,
    true,
  ),
  pattern(`${insensitive('bearer')}${PYTHON_WHITESPACE}+(${value})`, false, true),
  pattern('sk-[A-Za-z0-9][A-Za-z0-9._\\-]{6,}', true),
  pattern(
    `(?:${['secret', 'credential', 'password', 'token'].map(insensitive).join('|')}|${insensitive('api')}[-_]?${insensitive('key')})-[A-Za-zİıſK0-9._\\-]{4,}`,
    true,
  ),
  pattern('gh[pousr]_[A-Za-z0-9_]{20,}', true),
  pattern('xox[baprs]-[A-Za-z0-9-]{10,}', true),
  pattern('AIza[A-Za-z0-9_\\-]{20,}', true),
];

// Python 的 \w 即字母、数字与下划线；以宿主 Unicode 为准（迁移计划 §4.3.1）。
const WORD = /[\p{L}\p{N}_]/u;
function wordBefore(text: string, index: number): boolean {
  if (index <= 0) return false;
  const low = text.charCodeAt(index - 1);
  const start = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  return WORD.test(String.fromCodePoint(text.codePointAt(start)!));
}
function wordAt(text: string, index: number): boolean {
  return index < text.length && WORD.test(String.fromCodePoint(text.codePointAt(index)!));
}
const boundary = (text: string, index: number) => wordBefore(text, index) !== wordAt(text, index);

function applyPattern(text: string, spec: Pattern): string {
  let output = '';
  let copied = 0;
  spec.matcher.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = spec.matcher.exec(text)) !== null) {
    const start = match.index;
    if (!boundary(text, start)) {
      spec.matcher.lastIndex = start + 1;
      continue;
    }
    let end = spec.matcher.lastIndex;
    if (spec.endBoundary) {
      // A Python trailing \b backtracks through a greedy token tail (e.g. sk-abcdefg---).
      while (end > start && !(boundary(text, end) && spec.full.test(text.slice(start, end))))
        end -= 1;
      if (end === start) {
        spec.matcher.lastIndex = start + 1;
        continue;
      }
    }
    output += text.slice(copied, start);
    if (spec.capture) {
      const capture = match[match.length - 1];
      output += match[0].split(capture).join(REDACTED);
    } else output += REDACTED;
    copied = end;
    spec.matcher.lastIndex = end;
  }
  return output + text.slice(copied);
}

export function redactSensitiveText(text: string, context: SecretContext): string {
  let redacted = text;
  for (const secret of context.values) {
    if (!secret) throw new TypeError('SecretContext must contain qualified nonempty secrets');
    // Python str.replace：从左到右、不重叠。
    redacted = redacted.split(secret).join(REDACTED);
  }
  for (const spec of patterns) redacted = applyPattern(redacted, spec);
  return redacted;
}

export function redactSensitive(value: PlainJson, context: SecretContext): PlainJson {
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, context));
  if (value !== null && typeof value === 'object') {
    const output: { [key: string]: PlainJson } = Object.create(null);
    for (const [key, item] of Object.entries(value))
      output[key] = isSensitiveKey(key) ? REDACTED : redactSensitive(item, context);
    return output;
  }
  if (typeof value === 'string') return redactSensitiveText(value, context);
  return value;
}
