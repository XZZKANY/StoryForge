import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-context.windows.json';
import {
  InputDomainError,
  JsonFields,
  JsonFloat,
  MAX_JSON_DEPTH,
  parseJson,
  parseJsonBytes,
  type JsonObject,
} from './json';
import { fromPythonFact, type TypedValue } from './pythonFacts.test-support';

// 迁移计划 §4.3.1：golden 不重录，逐条判定。
const IN_DOMAIN = new Set([
  'whitespace',
  'containers',
  'dict-order-duplicates',
  'unicode-version-repr',
  'bytes-utf-8',
  'float-format',
]);
const BOTH_REJECT = new Set([
  'text-bom',
  'non-json-whitespace',
  'leading-zero',
  'trailing-comma',
  'trailing-content',
  'lowercase-nan',
  'unescaped-control',
  'bad-escape',
  'invalid-utf8',
  'invalid-utf16',
  'invalid-utf32',
]);
// Python 接受、按输入范围拒收：超大整数、NaN/Infinity、BOM、UTF-16/32、代理码点。
const OUT_OF_DOMAIN = new Set([
  'numbers',
  'float-specials',
  'escaped-surrogates',
  'bytes-utf-8-sig',
  'bytes-utf-16',
  'bytes-utf-16-le',
  'bytes-utf-16-be',
  'bytes-utf-32',
  'bytes-utf-32-le',
  'bytes-utf-32-be',
  'utf8-surrogatepass',
  'utf16-surrogatepass',
  'utf32-surrogatepass',
  'raw-pair-utf-8',
  'raw-pair-utf-16-le',
  'raw-pair-utf-32-le',
  'raw-escaped-utf-8',
  'raw-escaped-utf-16-le',
  'raw-escaped-utf-32-le',
  'escaped-raw-utf-8',
  'escaped-raw-utf-16-le',
  'escaped-raw-utf-32-le',
  'mixed-runs-utf-8',
  'mixed-runs-utf-16-le',
  'mixed-runs-utf-32-le',
  'dict-collisions-utf-8',
  'dict-collisions-utf-16-le',
  'dict-collisions-utf-32-le',
  'dict-pair-duplicate-utf-8',
  'dict-pair-duplicate-utf-16-le',
  'dict-pair-duplicate-utf-32-le',
  'primitive-raw-pair-utf-8',
  'primitive-raw-pair-utf-16-le',
  'primitive-raw-pair-utf-32-le',
]);

function bytes(chunks: { base64: string; repeat: number }[]): Uint8Array {
  const text = chunks.map((chunk) => atob(chunk.base64).repeat(chunk.repeat)).join('');
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

describe('golden JSON cases under the input domain', () => {
  it('classifies every Python case exactly once', () => {
    const ids = golden.json.map((fixture) => fixture.id);
    expect(ids).toHaveLength(51);
    for (const id of ids)
      expect([IN_DOMAIN, BOTH_REJECT, OUT_OF_DOMAIN].filter((set) => set.has(id))).toHaveLength(1);
    expect([IN_DOMAIN.size, BOTH_REJECT.size, OUT_OF_DOMAIN.size]).toEqual([6, 11, 34]);
  });
  for (const fixture of golden.json) {
    it(fixture.id, () => {
      const parse = () =>
        fixture.mode === 'text'
          ? parseJson(fixture.text!, 'golden.json')
          : parseJsonBytes(bytes(fixture.chunks!), 'golden.json');
      if (IN_DOMAIN.has(fixture.id)) {
        expect(fixture.error).toBeUndefined();
        expect(parse()).toEqual(fromPythonFact(fixture.output as TypedValue));
        return;
      }
      // 两边都拒收的用例 Python 记录了异常；范围外的用例 Python 当初是接受的。
      expect(fixture.error !== undefined).toBe(BOTH_REJECT.has(fixture.id));
      expect(parse).toThrow(InputDomainError);
    });
  }
});

describe('domain JSON parser', () => {
  const arrays = (depth: number) => '['.repeat(depth) + '7' + ']'.repeat(depth);
  const objects = (depth: number) => '{"x":'.repeat(depth) + '7' + '}'.repeat(depth);

  it('accepts 64 nested containers and rejects the 65th without deep recursion', () => {
    expect(MAX_JSON_DEPTH).toBe(64);
    expect(() => parseJson(arrays(64), 's')).not.toThrow();
    expect(() => parseJson(objects(64), 's')).not.toThrow();
    expect(() => parseJson(arrays(65), 's')).toThrow('嵌套超过 64 层');
    expect(() => parseJson(objects(65), 's')).toThrow('嵌套超过 64 层');
    expect(() => parseJson('['.repeat(200_000), 's')).toThrow('嵌套超过 64 层');
    expect(() => parseJson('[' + Array(5000).fill('{}').join(',') + ']', 's')).not.toThrow();
  });

  it('keeps integer and float literals apart', () => {
    expect(parseJson('[3, 3.0, 1e3, -0, -0.0]', 's')).toEqual([
      3,
      new JsonFloat(3),
      new JsonFloat(1000),
      0,
      new JsonFloat(-0),
    ]);
    expect(Object.is(parseJson('-0', 's'), 0)).toBe(true);
    expect(parseJson('9007199254740991', 's')).toBe(9007199254740991);
    expect(() => parseJson('9007199254740992', 's')).toThrow('超出安全范围');
    expect(() => parseJson('1e400', 's')).toThrow('超出范围');
    for (const text of ['NaN', 'Infinity', '-Infinity', '01', '1.', '-', '.5'])
      expect(() => parseJson(text, 's')).toThrow(InputDomainError);
  });

  it('rejects lone surrogates and keeps escaped pairs', () => {
    expect(parseJson('"\\ud83d\\ude00"', 's')).toBe('\u{1f600}');
    for (const text of ['"\\ud800"', '"\\udc00"', '"\\ud800x"', '"\\udc00\\ud800"'])
      expect(() => parseJson(text, 's')).toThrow('孤立的代理码点');
  });

  it('reads bytes only as BOM-free UTF-8', () => {
    expect(parseJsonBytes(new TextEncoder().encode('{"名":"老王"}'), 's')).toEqual({ 名: '老王' });
    expect(() => parseJsonBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), 'a.json')).toThrow(
      'a.json：文件以 BOM 开头',
    );
    expect(() => parseJsonBytes(new Uint8Array([0x22, 0xed, 0xa0, 0x80, 0x22]), 'a.json')).toThrow(
      'a.json：不是合法的 UTF-8 文本',
    );
    expect(() =>
      parseJsonBytes(new Uint8Array([0xff, 0xfe, 0x7b, 0x00, 0x7d, 0x00]), 'a.json'),
    ).toThrow(InputDomainError);
  });

  it('builds prototype-free objects where the later duplicate wins', () => {
    const value = parseJson('{"__proto__":1,"constructor":2,"a":1,"a":3}', 's') as JsonObject;
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.keys(value)).toEqual(['__proto__', 'constructor', 'a']);
    expect([value['__proto__'], value['constructor'], value['a']]).toEqual([1, 2, 3]);
  });

  it('reports the line and column of a syntax problem', () => {
    expect(() => parseJson('{\n  "a": 1,\n  "b": tru\n}', 'canon.json')).toThrow(
      'canon.json 第 3 行第 8 列：这里不能出现「t」',
    );
    expect(() => parseJson('[1,]', 'x.json')).toThrow('x.json 第 1 行第 4 列');
    expect(() => parseJson('', 'x.json')).toThrow('内容意外结束');
  });

  it('names the field path, the expectation and the actual kind', () => {
    const fields = new JsonFields('canon.json');
    expect(() => fields.string(true, 'entities[0].id')).toThrow(
      'canon.json 的 entities[0].id 应为字符串，实际是布尔值',
    );
    expect(() => fields.integer(new JsonFloat(3), 'x')).toThrow('应为整数，实际是小数');
    expect(() => fields.object([], 'x')).toThrow('应为对象，实际是数组');
    expect(() => fields.optionalArray('老王', 'aliases')).toThrow('应为数组，实际是字符串');
    expect(fields.optionalArray(null, 'x')).toEqual([]);
    expect(fields.optionalArray(undefined, 'x')).toEqual([]);
    expect(fields.optionalString(null, 'x')).toBeNull();
    expect(fields.optionalInteger(undefined, 'x')).toBeNull();
    const object = parseJson('{"constructor":1}', 's') as JsonObject;
    expect(fields.member(object, 'constructor')).toBe(1);
    expect(fields.member({ a: 1 }, 'toString')).toBeUndefined();
  });
});
