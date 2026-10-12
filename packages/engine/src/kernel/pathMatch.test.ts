import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-path-match.json';
import { matchPythonPath } from './pathMatch';

// 迁移计划 §4.3.1：大小写以宿主 Unicode 为准。与 Python 不同、已接受的两类：
// Python 正则把土耳其语 İ(U+0130)/ı(U+0131) 与 i/I 互认，JS 的 Unicode 大小写折叠不认；
// U+1C89/U+1C8A 是 Unicode 16 新增的一对大小写字母，Python 3.13（Unicode 15.1）不认识。
const TURKISH_I = [
  'shape-33-22',
  'shape-33-23',
  'shape-33-29',
  'shape-34-22',
  'shape-34-23',
  'shape-34-29',
  "class-'[--a]'-304",
  "class-'[--a]'-305",
  "class-'[a-zA-Z]'-304",
  "class-'[a-zA-Z]'-305",
  "case-304-'i'",
  "case-class-304-'i'",
  "case-305-'I'",
  "case-class-305-'I'",
];
const UNICODE_16 = ["case-7305-'\\u1c8a'", "case-class-7305-'\\u1c8a'"];
const DIVERGENT = new Set([...TURKISH_I, ...UNICODE_16].map((id) => `${id}/windows`));

describe('real Python Path.match', () => {
  it('keeps every divergent id present in the oracle', () => {
    const ids = new Set(golden.cases.map((row) => row.id));
    expect([...DIVERGENT].filter((id) => !ids.has(id))).toEqual([]);
    expect(DIVERGENT.size).toBe(16);
  });
  for (const row of golden.cases) {
    it(row.id, () => {
      if (row.platform !== 'windows' && row.platform !== 'posix')
        throw new TypeError('Unknown platform');
      const platform = row.platform;
      const match = () => matchPythonPath(row.path, row.pattern, platform);
      if (row.error) expect(match).toThrowError(new RangeError(row.error.message));
      else if (DIVERGENT.has(row.id)) expect(match()).toBe(!row.output);
      else expect(match()).toBe(row.output);
    });
  }
  it('does not use exponentially backtracking regex for repeated stars', () => {
    const path = 'a'.repeat(200);
    expect(matchPythonPath(path, '*a'.repeat(200), 'posix')).toBe(true);
    expect(matchPythonPath(path, '*a'.repeat(200) + 'b', 'posix')).toBe(false);
  });
  it('folds case on Windows for manuscript names, including full-width and Greek letters', () => {
    expect(matchPythonPath('正文/第001章.MD', '*.md', 'windows')).toBe(true);
    expect(matchPythonPath('正文/第001章.MD', '*.md', 'posix')).toBe(false);
    expect(matchPythonPath('ＡＢ.md', 'ａｂ.md', 'windows')).toBe(true);
    expect(matchPythonPath('Σ.md', 'ς.md', 'windows')).toBe(true);
    expect(matchPythonPath('\u212A.md', '[a-z].md', 'windows')).toBe(true);
  });
});
