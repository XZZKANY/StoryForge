import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-context.windows.json';
import {
  plainFromPythonFact,
  textFromCodePoints,
  type TypedValue,
} from './pythonFacts.test-support';
import { isSensitiveKey, redactSensitive, redactSensitiveText } from './redaction';

// 迁移计划 §4.3.1：超大整数、非有限小数、孤立代理码点到不了脱敏（命令入口先拒收）。
const SAFE = Number.MAX_SAFE_INTEGER;
// U+1C89 是 Unicode 16 新增字母，Python 3.13（Unicode 15.1）把它当非单词字符；按宿主为准，差异接受。
const NEWER_THAN_PYTHON = new Set([0x1c89]);
const outside = (points: readonly number[]) =>
  points.some((p) => (p >= 0xd800 && p <= 0xdfff) || NEWER_THAN_PYTHON.has(p));
function badLeaf(fact: TypedValue): boolean {
  if (fact.kind === 'int') return Math.abs(Number(fact.value)) > SAFE;
  if (fact.kind === 'float') return !Number.isFinite(Number(fact.value));
  if (fact.kind === 'str') return outside(fact.value as number[]);
  return false;
}
/** 只剪输入：敏感键的整个值被换成 [REDACTED]，输出与输入结构不再对应。 */
function pruneInput(input: TypedValue): TypedValue | null {
  if (input.kind === 'list')
    return {
      kind: 'list',
      value: (input.value as TypedValue[]).flatMap((item) => {
        const kept = pruneInput(item);
        return kept === null ? [] : [kept];
      }),
    };
  if (input.kind === 'dict')
    return {
      kind: 'dict',
      value: (input.value as [number[], TypedValue][]).flatMap(([key, item]) => {
        const kept = outside(key) ? null : pruneInput(item);
        return kept === null ? [] : [[key, kept]];
      }),
    };
  return badLeaf(input) ? null : input;
}
/** 脱敏逐个叶子独立处理：把范围外的叶子在输入与 Python 输出里成对剪掉，其余照常比对。 */
function prune(input: TypedValue, output: TypedValue): [TypedValue, TypedValue] | null {
  if (input.kind !== output.kind) {
    const kept = pruneInput(input);
    return kept === null || badLeaf(output) ? null : [kept, output];
  }
  if (input.kind === 'list') {
    const items = input.value as TypedValue[];
    const results = output.value as TypedValue[];
    const kept = items.flatMap((item, i) => {
      const pair = prune(item, results[i]);
      return pair === null ? [] : [pair];
    });
    return [
      { kind: 'list', value: kept.map(([a]) => a) },
      { kind: 'list', value: kept.map(([, b]) => b) },
    ];
  }
  if (input.kind === 'dict') {
    const entries = input.value as [number[], TypedValue][];
    const results = output.value as [number[], TypedValue][];
    const kept = entries.flatMap(([key, item], i) => {
      if (outside(key)) return [];
      const pair = prune(item, results[i][1]);
      return pair === null ? [] : [[key, pair, results[i][0]] as const];
    });
    return [
      { kind: 'dict', value: kept.map(([key, [a]]) => [key, a]) },
      { kind: 'dict', value: kept.map(([, [, b], key]) => [key, b]) },
    ];
  }
  return badLeaf(input) || badLeaf(output) ? null : [input, output];
}

// 密钥本身含代理码点，整条用例都在范围外。
const OUT_OF_DOMAIN_CASES = new Set(['literal-codepoint-length']);
const PRUNED_CASES = 17;

describe('redaction (audited Python with explicit synthetic configured values)', () => {
  const keyCases = golden.redaction.keys.filter((fixture) => !outside(fixture.input));
  it('keeps every in-domain sensitive-key case', () => {
    expect([keyCases.length, golden.redaction.keys.length]).toEqual([40, 41]);
  });
  for (const [i, fixture] of keyCases.entries()) {
    it(`sensitive key ${i}`, () => {
      expect(isSensitiveKey(textFromCodePoints(fixture.input))).toBe(fixture.output);
    });
  }
  it('prunes only out-of-domain leaves', () => {
    const pruned = golden.redaction.cases.filter(
      (fixture) =>
        !OUT_OF_DOMAIN_CASES.has(fixture.id) &&
        JSON.stringify(prune(fixture.input, fixture.output)) !==
          JSON.stringify([fixture.input, fixture.output]),
    );
    expect(pruned).toHaveLength(PRUNED_CASES);
  });
  for (const fixture of golden.redaction.cases) {
    if (OUT_OF_DOMAIN_CASES.has(fixture.id)) continue;
    it(fixture.id, () => {
      const pair = prune(fixture.input, fixture.output);
      expect(pair).not.toBeNull();
      let value = plainFromPythonFact(pair![0]);
      const context = { values: fixture.context.map(textFromCodePoints) };
      for (let i = 0; i < fixture.passes; i += 1) value = redactSensitive(value, context);
      expect(value).toEqual(plainFromPythonFact(pair![1]));
    });
  }
  it('does not mutate inputs/context across repeated calls', () => {
    const text = 'abcdef abcdef';
    const context = { values: ['abcdef'] };
    expect(redactSensitiveText(text, context)).toBe('[REDACTED] [REDACTED]');
    expect(redactSensitiveText(text, context)).toBe('[REDACTED] [REDACTED]');
    expect(context.values).toEqual(['abcdef']);
  });
  it('treats astral characters as word characters at token boundaries', () => {
    const context = { values: [] };
    expect(redactSensitiveText('𠀀sk-abcdefgh', context)).toBe('𠀀sk-abcdefgh');
    expect(redactSensitiveText('😀sk-abcdefgh', context)).toBe('😀[REDACTED]');
    expect(redactSensitiveText('token=abcdef1', context)).toBe('token=[REDACTED]');
  });
});
