import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-context.windows.json';
import {
  escapeControlCharsAndQuotes,
  escapeStrayQuotes,
  InputDomainError,
  JsonFields,
  JsonFloat,
  MAX_JSON_DEPTH,
  ModelJsonNotFound,
  parseJson,
  parseJsonBytes,
  parseModelJson,
  type JsonObject,
  type ModelJsonOptions,
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

// 样本取自各调用方的 golden 夹具与原有测试；每组选项就是收进来之前那一处的规矩。
describe('parseModelJson', () => {
  const failure = (raw: string, options: ModelJsonOptions) => {
    try {
      parseModelJson(raw, options);
    } catch (error) {
      return error;
    }
    throw new Error('expected a failure');
  };

  it('lines + objectSpan (book breakdown): fenced, embedded, missing and malformed replies', () => {
    const options: ModelJsonOptions = { source: 's', fence: 'lines', locate: 'objectSpan' };
    expect(parseModelJson('```json\n{"conflict_and_rhythm": "围栏"}\n```', options)).toEqual({
      conflict_and_rhythm: '围栏',
    });
    expect(
      parseModelJson('模型说明：{"craft_methods": {"summary": "对象"}} 结尾', options),
    ).toEqual({ craft_methods: { summary: '对象' } });
    expect(parseModelJson('[1, 2]', options)).toEqual([1, 2]);
    expect(failure('not json', options)).toBeInstanceOf(ModelJsonNotFound);
    const malformed = failure('{"a": 1} 多余 }', options);
    expect(malformed).toBeInstanceOf(InputDomainError);
    expect(malformed).not.toBeInstanceOf(ModelJsonNotFound);
    // 整条回复只有一行时首行就是全部，剥完是空串。
    expect(failure('```json {"a": 1}```', options)).toBeInstanceOf(ModelJsonNotFound);
  });

  it('none + objectSpan (writing skills): a fence is skipped by the span, not stripped', () => {
    const options: ModelJsonOptions = { source: 's', locate: 'objectSpan' };
    expect(parseModelJson('```json\n{"skills": []}\n```', options)).toEqual({ skills: [] });
    expect(failure('不是 JSON', options)).toBeInstanceOf(ModelJsonNotFound);
  });

  it('lines + arraySpan (review issues): a missing span keeps the whole-reply parse error', () => {
    const options: ModelJsonOptions = { source: 's', fence: 'lines', locate: 'arraySpan' };
    expect(parseModelJson('模型说明：\n[{"code":"x"}, 5] 后记', options)).toEqual([
      { code: 'x' },
      5,
    ]);
    expect(parseModelJson('```\n{"a": 1}\n```', options)).toEqual({ a: 1 });
    const error = failure('not json at all', options) as Error;
    expect(error).toBeInstanceOf(ModelJsonNotFound);
    expect(error.name).toBe('InputDomainError');
    expect(error.message).toBe((failure('not json at all', { source: 's' }) as Error).message);
  });

  it('strictLines, then balancedArray (semantic judge)', () => {
    expect(parseModelJson('```JSON\n[1]\n```', { source: 's', fence: 'strictLines' })).toEqual([1]);
    expect(failure('```js\n[1]\n```', { source: 's', fence: 'strictLines' })).toBeInstanceOf(
      InputDomainError,
    );
    const embedded = '说明 [{"a": "]"}] 尾巴 ]';
    expect(parseModelJson(embedded, { source: 's', locate: 'balancedArray' })).toEqual([
      { a: ']' },
    ]);
    expect(failure(embedded, { source: 's', locate: 'arraySpan' })).not.toBeInstanceOf(
      ModelJsonNotFound,
    );
  });

  it('block keeps JS whitespace inside the fence, blockPython keeps Python whitespace', () => {
    const nel = String.fromCharCode(0x85);
    const bom = String.fromCharCode(0xfeff);
    expect(parseModelJson('```json\n{"a": 1}\n```', { source: 's', fence: 'block' })).toEqual({
      a: 1,
    });
    expect(parseModelJson('```{"a": 1}```', { source: 's', fence: 'block' })).toEqual({ a: 1 });
    expect(
      parseModelJson(`\`\`\`json${bom}{"a": 1}\`\`\``, { source: 's', fence: 'block' }),
    ).toEqual({ a: 1 });
    expect(
      failure(`\`\`\`json${bom}{"a": 1}\`\`\``, { source: 's', fence: 'blockPython' }),
    ).toBeInstanceOf(InputDomainError);
    expect(
      parseModelJson(`\`\`\`json${nel}{"a": 1}\`\`\``, { source: 's', fence: 'blockPython' }),
    ).toEqual({ a: 1 });
    expect(
      failure(`\`\`\`json${nel}{"a": 1}\`\`\``, { source: 's', fence: 'block' }),
    ).toBeInstanceOf(InputDomainError);
  });

  it('block + uniqueKeys + escapeStrayQuotes (chapter check)', () => {
    const options: ModelJsonOptions = {
      source: 's',
      fence: 'block',
      uniqueKeys: true,
      repair: escapeStrayQuotes,
    };
    expect(parseModelJson('```json\n{"goal": "他说"快走"然后离开"}\n```', options)).toEqual({
      goal: '他说"快走"然后离开',
    });
    expect(failure('{"a": 1, "a": 2}', options)).toBeInstanceOf(InputDomainError);
    const broken = '{"a": "他说"好"';
    expect((failure(broken, options) as Error).message).toBe(
      (failure(escapeStrayQuotes(broken), { source: 's' }) as Error).message,
    );
  });

  it('a custom locate (chapter brief) runs only after the whole reply fails', () => {
    const seen: string[] = [];
    const locate = (text: string) => {
      seen.push(text);
      return text.startsWith('{') ? { found: true } : null;
    };
    const options: ModelJsonOptions = { source: 's', fence: 'block', locate };
    expect(parseModelJson('```json\n{"a": 1}\n```', options)).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a": 1} 说明\n```', options)).toEqual({ found: true });
    expect(failure('说明', options)).toBeInstanceOf(ModelJsonNotFound);
    expect(seen).toEqual(['{"a": 1} 说明', '说明']);
  });

  it('lines + escapeControlCharsAndQuotes (compaction) also fixes raw newlines', () => {
    const options: ModelJsonOptions = {
      source: 's',
      fence: 'lines',
      repair: escapeControlCharsAndQuotes,
    };
    const reply = '```json\n{"entries": [{"quote": "第一行\n第二行", "note": "他说"走"吧"}]}\n```';
    expect(parseModelJson(reply, options)).toEqual({
      entries: [{ quote: '第一行\n第二行', note: '他说"走"吧' }],
    });
    expect(failure(reply, { ...options, repair: escapeStrayQuotes })).toBeInstanceOf(
      InputDomainError,
    );
  });

  it('the two repairers close a string on a comma differently', () => {
    const text = '{"line": "他说"好",她笑了", "count": 1}';
    expect(parseJson(escapeStrayQuotes(text), 's')).toEqual({ line: '他说"好",她笑了', count: 1 });
    expect(() => parseJson(escapeControlCharsAndQuotes(text), 's')).toThrow(InputDomainError);
  });
});
