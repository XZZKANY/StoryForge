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
export function parseJson(text: string, source: string): JsonValue {
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
