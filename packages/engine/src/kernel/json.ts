/**
 * 内核读取 JSON 文件的唯一入口：标准 JSON，范围外直接报错，不复刻 Python json 的宽松行为。
 * 范围见 docs/architecture/ts-engine-migration-plan.md §4.3.1。
 */

/** 应用写出的文件最深 6 层；64 与目录遍历的深度上限一致。 */
export const MAX_JSON_DEPTH = 64;

/** 输入超出约定范围。消息面向作者：写明来源、位置与期望。 */
export class InputDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputDomainError';
  }
}

/** 带小数点或指数的字面量（含 3.0、1e3）单独成型，整数字段据此拒收。 */
export class JsonFloat {
  constructor(readonly value: number) {}
}

export type JsonValue = null | boolean | number | string | JsonFloat | JsonValue[] | JsonObject;
/** 无原型对象：`__proto__`、`constructor` 只是普通键。键的先后顺序不属于契约。 */
export type JsonObject = { [key: string]: JsonValue };

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export function isWellFormedText(text: string): boolean {
  return !LONE_SURROGATE.test(text);
}

const ESCAPES = new Map([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
]);
const LITERALS = [
  ['true', true],
  ['false', false],
  ['null', null],
] as const;

/** 解析 JSON 文本；`source` 只用于报错，例如 `.storyforge/canon/canon.json`。 */
export function parseJson(
  text: string,
  source: string,
  options: { uniqueKeys?: boolean } = {},
): JsonValue {
  const number = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
  let index = 0;

  const fail = (problem: string): never => {
    const consumed = text.slice(0, index);
    const line = consumed.split('\n').length;
    const column = index - consumed.lastIndexOf('\n');
    throw new InputDomainError(`${source} 第 ${line} 行第 ${column} 列：${problem}`);
  };
  const skipSpace = () => {
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return;
      index += 1;
    }
  };

  const readString = (): string => {
    index += 1;
    let output = '';
    let start = index;
    for (;;) {
      if (index >= text.length) return fail('字符串缺少结束引号');
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        output += text.slice(start, index);
        index += 1;
        break;
      }
      if (code === 0x5c) {
        output += text.slice(start, index);
        const escape = text[index + 1];
        if (escape === 'u') {
          const hex = text.slice(index + 2, index + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail('\\u 后面要跟 4 位十六进制数');
          output += String.fromCharCode(parseInt(hex, 16));
          index += 6;
        } else {
          const mapped = escape === undefined ? undefined : ESCAPES.get(escape);
          if (mapped === undefined) return fail('非法的转义序列');
          output += mapped;
          index += 2;
        }
        start = index;
        continue;
      }
      if (code < 0x20) return fail('字符串里有未转义的控制字符');
      index += 1;
    }
    if (!isWellFormedText(output)) return fail('字符串里有孤立的代理码点');
    return output;
  };

  const readNumber = (): number | JsonFloat => {
    number.lastIndex = index;
    const match = number.exec(text);
    if (match === null) return fail('数字格式不对');
    index = number.lastIndex;
    const literal = match[0];
    const parsed = Number(literal);
    if (match[1] === undefined && match[2] === undefined) {
      if (!Number.isSafeInteger(parsed)) return fail(`整数 ${literal} 超出安全范围`);
      return parsed === 0 ? 0 : parsed;
    }
    if (!Number.isFinite(parsed)) return fail(`数值 ${literal} 超出范围`);
    return new JsonFloat(parsed);
  };

  const readObject = (depth: number): JsonObject => {
    const output: JsonObject = Object.create(null);
    skipSpace();
    if (text[index] === '}') {
      index += 1;
      return output;
    }
    for (;;) {
      skipSpace();
      if (text[index] !== '"') return fail('对象的键必须是带引号的字符串');
      const key = readString();
      // 需要时拒绝重复键（Python 用 object_pairs_hook 拒绝的那类输入）；缺省仍是后者覆盖前者。
      if (options.uniqueKeys && key in output) return fail(`对象里有重复的键 ${key}`);
      skipSpace();
      if (text[index] !== ':') return fail('键后面缺少冒号');
      index += 1;
      output[key] = readValue(depth);
      skipSpace();
      if (text[index] === ',') {
        index += 1;
        continue;
      }
      if (text[index] === '}') {
        index += 1;
        return output;
      }
      return fail('缺少逗号或右花括号');
    }
  };

  const readArray = (depth: number): JsonValue[] => {
    const output: JsonValue[] = [];
    skipSpace();
    if (text[index] === ']') {
      index += 1;
      return output;
    }
    for (;;) {
      output.push(readValue(depth));
      skipSpace();
      if (text[index] === ',') {
        index += 1;
        continue;
      }
      if (text[index] === ']') {
        index += 1;
        return output;
      }
      return fail('缺少逗号或右方括号');
    }
  };

  const readValue = (depth: number): JsonValue => {
    skipSpace();
    const head = text[index];
    if (head === '{' || head === '[') {
      if (depth >= MAX_JSON_DEPTH) return fail(`嵌套超过 ${MAX_JSON_DEPTH} 层`);
      index += 1;
      return head === '{' ? readObject(depth + 1) : readArray(depth + 1);
    }
    if (head === '"') return readString();
    if (head === '-' || (head !== undefined && head >= '0' && head <= '9')) return readNumber();
    for (const [word, literal] of LITERALS) {
      if (text.startsWith(word, index)) {
        index += word.length;
        return literal;
      }
    }
    if (head === undefined) return fail('内容意外结束');
    return fail(`这里不能出现「${String.fromCodePoint(text.codePointAt(index)!)}」`);
  };

  const result = readValue(0);
  skipSpace();
  if (index !== text.length) fail('JSON 之后还有多余内容');
  return result;
}

const skipBlank = (text: string, from: number) => {
  let index = from;
  while (index < text.length && ' \t\r\n'.includes(text[index])) index += 1;
  return index;
};

/** 引号后面（跳过空白）是 } ]、文本结尾，或者是 , : 且再往后是一个合法的键或值开头，才算字符串结束。 */
function closesString(text: string, from: number): boolean {
  const next = skipBlank(text, from);
  if (next >= text.length) return true;
  const char = text[next];
  if (char === '}' || char === ']') return true;
  if (char !== ',' && char !== ':') return false;
  const after = skipBlank(text, next + 1);
  return after < text.length && '"{[-0123456789tfn'.includes(text[after]);
}

/**
 * 模型回的 JSON 里，字符串内容夹了没转义的直引号（引对白、抄计划原文时常见）：把这些引号转义。
 * 只在正常解析失败后用；修过的文本照样走解析与校验，猜错只会解析失败。
 */
export function escapeStrayQuotes(text: string): string {
  let out = '';
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString && char === '\\') {
      out += text.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (char === '"' && inString) {
      if (!closesString(text, index + 1)) {
        out += '\\"';
        continue;
      }
      inString = false;
    } else if (char === '"') inString = true;
    out += char;
  }
  return out;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** 文件字节：只收不带 BOM 的合法 UTF-8。 */
export function parseJsonBytes(raw: Uint8Array, source: string): JsonValue {
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
    throw new InputDomainError(`${source}：文件以 BOM 开头，请另存为不带 BOM 的 UTF-8`);
  let text: string;
  try {
    text = UTF8.decode(raw);
  } catch {
    throw new InputDomainError(`${source}：不是合法的 UTF-8 文本`);
  }
  return parseJson(text, source);
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonFloat)
  );
}

export type Obj = { [key: string]: unknown };
/** 任意值是不是普通对象：只排除 null 与数组，不像 isJsonObject 那样排除 JsonFloat。 */
export const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function kindOf(value: JsonValue | undefined): string {
  if (value === undefined) return '缺省';
  if (value === null) return 'null';
  if (typeof value === 'string') return '字符串';
  if (typeof value === 'number') return '整数';
  if (typeof value === 'boolean') return '布尔值';
  if (value instanceof JsonFloat) return '小数';
  return Array.isArray(value) ? '数组' : '对象';
}

/** 按字段读值并校验类型；报错时带上字段路径，例如 `entities[2].aliases[0]`。 */
export class JsonFields {
  constructor(readonly source: string) {}

  fail(path: string, expected: string, actual: JsonValue | undefined): never {
    throw new InputDomainError(
      `${this.source} 的 ${path} 应为${expected}，实际是${kindOf(actual)}`,
    );
  }
  member(object: JsonObject, key: string): JsonValue | undefined {
    return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
  }
  object(value: JsonValue | undefined, path: string): JsonObject {
    return isJsonObject(value) ? value : this.fail(path, '对象', value);
  }
  /** 缺省与 null 视为空对象。 */
  optionalObject(value: JsonValue | undefined, path: string): JsonObject {
    return value === undefined || value === null ? Object.create(null) : this.object(value, path);
  }
  /** 缺省与 null 视为空数组。 */
  optionalArray(value: JsonValue | undefined, path: string): JsonValue[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : this.fail(path, '数组', value);
  }
  string(value: JsonValue | undefined, path: string): string {
    return typeof value === 'string' ? value : this.fail(path, '字符串', value);
  }
  optionalString(value: JsonValue | undefined, path: string): string | null {
    return value === undefined || value === null ? null : this.string(value, path);
  }
  integer(value: JsonValue | undefined, path: string): number {
    return typeof value === 'number' ? value : this.fail(path, '整数', value);
  }
  optionalInteger(value: JsonValue | undefined, path: string): number | null {
    return value === undefined || value === null ? null : this.integer(value, path);
  }
  boolean(value: JsonValue | undefined, path: string): boolean {
    return typeof value === 'boolean' ? value : this.fail(path, '布尔值', value);
  }
  optionalBoolean(value: JsonValue | undefined, path: string): boolean | null {
    return value === undefined || value === null ? null : this.boolean(value, path);
  }
}

export type DumpOptions = {
  indent?: number;
  ensureAscii?: boolean;
  sortKeys?: boolean;
  separators?: readonly [string, string];
};

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

/** Python float.__repr__：最短往返位数，指数 < -4 或 ≥ 16 时用科学计数法。 */
export function pythonFloatRepr(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`非有限小数 ${value} 不在输入范围内`);
  if (Object.is(value, -0)) return '-0.0';
  const [coefficient, exponentText] = value.toExponential().split('e');
  const exponent = Number(exponentText);
  if (exponent < -4 || exponent >= 16)
    return `${coefficient}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** Python 的 sorted(str)：按码点比较，不是 UTF-16 码元。 */
export function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const diff = left[i].codePointAt(0)! - right[i].codePointAt(0)!;
    if (diff) return diff;
  }
  return left.length - right.length;
}

/**
 * Python json.dumps 的逐字节等价，只接受范围内的值：整数值的 number 视为 int，
 * 其余 number 与 JsonFloat 按 float 输出。对象键按插入序（JS 的整数形键会排到前面，
 * 调用方不得把这类键交给需要保序的输出）。
 */
export function dumpJson(value: unknown, options: DumpOptions = {}): string {
  const { indent, ensureAscii = true, sortKeys = false } = options;
  const [itemSeparator, keySeparator] =
    options.separators ?? (indent === undefined ? [', ', ': '] : [',', ': ']);
  const quote = (text: string): string => {
    let output = '"';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const code = text.charCodeAt(i);
      const short = SHORT_ESCAPES[char];
      if (short !== undefined) output += short;
      else if (code < 0x20 || (ensureAscii && code > 0x7e))
        output += '\\u' + code.toString(16).padStart(4, '0');
      else output += char;
    }
    return output + '"';
  };
  const write = (node: unknown, level: number): string => {
    if (node === null) return 'null';
    if (node === true) return 'true';
    if (node === false) return 'false';
    if (typeof node === 'string') return quote(node);
    if (typeof node === 'number') {
      if (Number.isInteger(node) && Number.isSafeInteger(node))
        return String(node === 0 ? 0 : node);
      return pythonFloatRepr(node);
    }
    if (node instanceof JsonFloat) return pythonFloatRepr(node.value);
    const open = indent === undefined ? '' : '\n' + ' '.repeat(indent * (level + 1));
    const close = indent === undefined ? '' : '\n' + ' '.repeat(indent * level);
    if (Array.isArray(node)) {
      if (!node.length) return '[]';
      return (
        '[' +
        open +
        node.map((item) => write(item, level + 1)).join(itemSeparator + open) +
        close +
        ']'
      );
    }
    if (typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>);
      if (!entries.length) return '{}';
      if (sortKeys) entries.sort(([a], [b]) => compareCodePoints(a, b));
      const items = entries.map(
        ([key, item]) => quote(key) + keySeparator + write(item, level + 1),
      );
      return '{' + open + items.join(itemSeparator + open) + close + '}';
    }
    throw new TypeError(`无法序列化 ${typeof node}`);
  };
  return write(value, 0);
}

/** 深拷贝 JsonValue，保留 JsonFloat（structuredClone 会把它变成普通对象）。 */
/** 原地深冻结（返回同一对象），对应 Python SDK 的 freeze：之后的赋值在严格模式下抛 TypeError。 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

export function cloneJson<T extends JsonValue>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof JsonFloat) return value;
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
  const output: JsonObject = Object.create(null);
  for (const [key, item] of Object.entries(value)) output[key] = cloneJson(item);
  return output as T;
}

/** Python `==`：True == 1 == 1.0，列表按序、字典不看键序。 */
export function pythonEquals(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  const numeric = (value: JsonValue | undefined): number | null =>
    typeof value === 'number'
      ? value
      : typeof value === 'boolean'
        ? Number(value)
        : value instanceof JsonFloat
          ? value.value
          : null;
  const a = numeric(left);
  const b = numeric(right);
  if (a !== null || b !== null) return a !== null && b !== null && a === b;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, i) => pythonEquals(item, right[i]));
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) && pythonEquals(left[key], right[key]),
    );
  }
  return left === right;
}

/** Python str()：标量按 Python 的写法；容器给出近似 repr（模型极少在此处返回容器）。 */
export function pythonStr(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value instanceof JsonFloat) return pythonFloatRepr(value.value);
  const repr = (item: JsonValue): string =>
    typeof item === 'string'
      ? `'${item.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      : pythonStr(item);
  if (Array.isArray(value)) return `[${value.map(repr).join(', ')}]`;
  return `{${Object.entries(value)
    .map(([key, item]) => `${repr(key)}: ${repr(item)}`)
    .join(', ')}}`;
}

/** Python 真值：None、False、0、0.0、空串与空容器为假。 */
export function pythonTruthy(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null || value === false || value === 0 || value === '')
    return false;
  if (value instanceof JsonFloat) return value.value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== 'object' || Object.keys(value).length > 0;
}
