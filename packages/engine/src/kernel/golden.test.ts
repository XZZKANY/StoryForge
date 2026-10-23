import { describe, expect, it } from 'vitest';
import golden from '../../golden/p0.json';
import { renderBookContextBlock, type BookContext } from './bookContext';
import { isManuscriptPath, orderManuscriptFiles } from './manuscript';
import { pythonFixed } from './math';
import { checkParagraphPatterns } from './paragraphPatterns';

const platform = golden.platform;
if (platform !== 'windows' && platform !== 'posix') throw new Error('Unknown oracle platform');

describe('Python manuscript oracle (contained traversal is tested separately)', () => {
  for (const fixture of golden.membership) {
    it(`membership ${JSON.stringify(fixture.input)}`, () => {
      expect(isManuscriptPath(fixture.input)).toBe(fixture.output);
    });
  }
  for (const fixture of golden.manuscript) {
    it(`enumerated entries retain filtering with natural numeric order: ${fixture.id}`, () => {
      // 原 Python oracle 留存不改；数字章号的阅读序是本次明确的产品契约变更。
      const expected =
        fixture.id === 'unicode-order'
          ? [
              '正文/A/第01章.md',
              '正文/A0.md',
              '正文/A2.md',
              '正文/a1.md',
              '正文/b.md',
              '正文/é.md',
              '正文/é.md',
              '正文/第2章.md',
              '正文/第10章.md',
              '正文/\ue000.md',
              '正文/😀.md',
              '正文/𠀀.md',
            ]
          : fixture.output;
      expect(orderManuscriptFiles(fixture.entries, platform)).toEqual(expected);
      expect(orderManuscriptFiles([...fixture.entries].reverse(), platform)).toEqual(expected);
    });
  }
  it('retains the host-specific extension rule', () => {
    const entries = [{ relative_path: '正文/chapter.MD', is_directory: false }];
    expect(orderManuscriptFiles(entries, 'windows')).toEqual(['正文/chapter.MD']);
    expect(orderManuscriptFiles(entries, 'posix')).toEqual([]);
  });
});

describe('Python book-context prompt bytes', () => {
  for (const fixture of golden.book_context) {
    it(fixture.id, () => {
      const previous = fixture.input.previous_chapter;
      const context: BookContext = {
        ...fixture.input,
        previous_chapter: previous === null ? null : [previous[0], previous[1]],
      };
      const actual = renderBookContextBlock(context);
      expect(actual).toBe(fixture.output);
      if (actual !== null && fixture.output !== null) {
        expect(new TextEncoder().encode(actual)).toEqual(new TextEncoder().encode(fixture.output));
      }
    });
  }
});

describe('Python paragraph-pattern issues', () => {
  for (const fixture of golden.paragraph_patterns) {
    it(fixture.id, () => {
      expect(checkParagraphPatterns(fixture.input)).toEqual(fixture.output);
    });
  }
});

describe('Python 1 MiB CPU-sample results (not a performance measurement)', () => {
  for (const fixture of golden.cpu) {
    it(fixture.id, () => {
      const prose = fixture.block.repeat(fixture.repetitions) + 'x'.repeat(fixture.padding);
      expect(new TextEncoder().encode(prose).byteLength).toBe(1_048_576);
      expect(Array.from(prose).length).toBe(fixture.codepoints);
      expect(checkParagraphPatterns(prose)).toEqual(fixture.output);
    });
  }
});

describe('Python fixed-point formatting', () => {
  for (const [index, fixture] of golden.fixed.entries()) {
    it(`${index}: ${fixture.value} .${fixture.digits}f`, () => {
      expect(pythonFixed(fixture.value, fixture.digits)).toBe(fixture.output);
    });
  }
  it('rejects unsupported precision without concealing the error', () => {
    expect(() => pythonFixed(1.25, -1)).toThrow(RangeError);
    expect(() => pythonFixed(1.25, 0.5)).toThrow(RangeError);
  });
});
