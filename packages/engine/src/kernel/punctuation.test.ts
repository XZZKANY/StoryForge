import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-punctuation.json';
import {
  canonicalPunctuation,
  DIALOGUE_PATTERN,
  fullwidthCjkPunctuation,
  restoreIncidentalPunctuation,
} from './punctuation';

/** 接受的差异：TS 另把全角 / 半角的同一个标点折到一起（Python 不折），其余照 Python 原样。 */
const WIDTH = {
  '，': ',',
  '：': ':',
  '；': ';',
  '？': '?',
  '！': '!',
  '（': '(',
  '）': ')',
} as const;
const widthFolded = (text: string) =>
  Array.from(text, (character) => WIDTH[character as keyof typeof WIDTH] ?? character).join('');

describe('real Python punctuation oracle', () => {
  for (const fixture of golden.canonical) {
    it(fixture.id, () =>
      expect(canonicalPunctuation(fixture.input)).toBe(widthFolded(fixture.output)),
    );
  }
  for (const fixture of golden.dialogue) {
    it(fixture.id, () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const matches = Array.from(fixture.input.matchAll(DIALOGUE_PATTERN), (match) => ({
          text: match[0],
          start: Array.from(fixture.input.slice(0, match.index)).length,
          end: Array.from(fixture.input.slice(0, match.index + match[0].length)).length,
        }));
        expect(matches).toEqual(fixture.matches);
        expect(fixture.input.replace(DIALOGUE_PATTERN, '')).toBe(fixture.stripped);
        expect(DIALOGUE_PATTERN.lastIndex).toBe(0);
      }
    });
  }
  for (const fixture of golden.fullwidth) {
    it(fixture.id, () =>
      expect(fullwidthCjkPunctuation(fixture.input)).toEqual([fixture.output, fixture.count]),
    );
  }
  for (const fixture of golden.restoration) {
    it(fixture.id, () => {
      const policy =
        fixture.allowed_punctuation_forms === null
          ? null
          : {
              allowed_punctuation_forms: new Set(fixture.allowed_punctuation_forms),
            };
      const result = restoreIncidentalPunctuation(fixture.before, fixture.after, policy);
      expect(result).toBe(fixture.output);
      expect(new TextEncoder().encode(result)).toEqual(new TextEncoder().encode(fixture.output));
      expect(policy === null ? null : [...policy.allowed_punctuation_forms]).toEqual(
        fixture.allowed_punctuation_forms,
      );
    });
  }
});

const NL = String.fromCharCode(10);

describe('full-width / half-width drift (TS only)', () => {
  it('folds the paired marks and nothing else', () => {
    expect(canonicalPunctuation('你好，世界：真的？好！（嗯）；')).toBe('你好,世界:真的?好!(嗯);');
    expect(canonicalPunctuation('好。')).toBe('好。');
    expect(canonicalPunctuation('好。')).not.toBe(canonicalPunctuation('好…'));
  });

  it('restores untouched lines whose commas the model turned half-width (P3-8 real run)', () => {
    const before = [
      '# 第三章',
      '',
      '老周站在运水车旁边，手里拿着一根钢筋。',
      '',
      '"人呢？"',
      '',
      '他走了。',
    ].join(NL);
    const after = [
      '# 第三章',
      '',
      '老周站在运水车旁边,手里拿着一根钢筋。',
      '',
      '"人呢?"',
      '',
      '他头也不回地走了。',
    ].join(NL);
    expect(restoreIncidentalPunctuation(before, after)).toBe(
      [
        '# 第三章',
        '',
        '老周站在运水车旁边，手里拿着一根钢筋。',
        '',
        '"人呢？"',
        '',
        '他头也不回地走了。',
      ].join(NL),
    );
  });

  it('keeps a wholly punctuation-only revision as the author asked for it', () => {
    expect(restoreIncidentalPunctuation('甲,乙' + NL + '丙?', '甲，乙' + NL + '丙？')).toBe(
      '甲，乙' + NL + '丙？',
    );
  });
});
