import { JsonFloat, type JsonObject, type JsonValue } from './json';
import type { PlainJson } from './redaction';

/** Python 预言机记录的类型化值（golden 文件里的 `{kind, value}`）。 */
export type TypedValue = { kind: string; value?: unknown };

export function textFromCodePoints(points: readonly number[]): string {
  let text = '';
  for (let i = 0; i < points.length; i += 4096)
    text += String.fromCodePoint(...points.slice(i, i + 4096));
  return text;
}

/** Python 的值落在输入范围内时才能表示：超大整数、非有限小数、含代理码点的字符串都抛错。 */
export class OutOfDomainFact extends RangeError {}

/** 把 Python 的类型化输出转成范围内的 JsonValue，供 toEqual 与 TS 结果比对。 */
export function fromPythonFact(fact: TypedValue): JsonValue {
  switch (fact.kind) {
    case 'null':
      return null;
    case 'bool':
      return fact.value as boolean;
    case 'int': {
      const value = Number(fact.value as string);
      if (!Number.isSafeInteger(value)) throw new OutOfDomainFact(`unsafe int ${fact.value}`);
      return value === 0 ? 0 : value;
    }
    case 'float': {
      const value = Number(fact.value as string);
      if (!Number.isFinite(value)) throw new OutOfDomainFact(`non-finite float ${fact.value}`);
      return new JsonFloat(value);
    }
    case 'str': {
      const points = fact.value as number[];
      if (points.some((point) => point >= 0xd800 && point <= 0xdfff))
        throw new OutOfDomainFact('surrogate code point');
      return textFromCodePoints(points);
    }
    case 'list':
      return (fact.value as TypedValue[]).map(fromPythonFact);
    case 'dict': {
      const output: JsonObject = Object.create(null);
      for (const [key, entry] of fact.value as [number[], TypedValue][]) {
        if (key.some((point) => point >= 0xd800 && point <= 0xdfff))
          throw new OutOfDomainFact('surrogate code point in key');
        output[textFromCodePoints(key)] = fromPythonFact(entry);
      }
      return output;
    }
    default:
      throw new Error(`Unknown typed oracle kind ${fact.kind}`);
  }
}

/** 同上，但小数直接取数值：用于浏览器 JSON 值（命令参数、载荷）。 */
export function plainFromPythonFact(fact: TypedValue): PlainJson {
  const plain = (value: JsonValue): PlainJson => {
    if (value instanceof JsonFloat) return value.value;
    if (Array.isArray(value)) return value.map(plain);
    if (value !== null && typeof value === 'object') {
      const output: { [key: string]: PlainJson } = Object.create(null);
      for (const [key, item] of Object.entries(value)) output[key] = plain(item);
      return output;
    }
    return value;
  };
  return plain(fromPythonFact(fact));
}
