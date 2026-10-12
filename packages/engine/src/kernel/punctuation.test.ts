import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-punctuation.json';
import {
  canonicalPunctuation,
  DIALOGUE_PATTERN,
  restoreIncidentalPunctuation,
} from './punctuation';

describe('real Python punctuation oracle', () => {
  for (const fixture of golden.canonical) {
    it(fixture.id, () => expect(canonicalPunctuation(fixture.input)).toBe(fixture.output));
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
