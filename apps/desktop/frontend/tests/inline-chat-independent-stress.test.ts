import { describe, expect, it } from 'vitest';
import { hunksToLineDiff, planAnchoredInlineDiff } from '../src/lib/inline-chat';

function variants(): string[] {
  const alphabet = ['', '甲。乙。', '重复', '😀'];
  const result = [''];
  for (let length = 1; length <= 3; length += 1) {
    const visit = (lines: string[]) => {
      if (lines.length === length) {
        result.push(lines.join('\n'));
        return;
      }
      for (const line of alphabet) visit([...lines, line]);
    };
    visit([]);
  }
  return [...new Set(result)];
}

describe('independent anchored projection stress', () => {
  it('full-range projection exactly equals every candidate across repeated, empty, multi-sentence and final lines', () => {
    const texts = variants();
    const failures: object[] = [];
    for (const before of texts)
      for (const after of texts) {
        const plan = planAnchoredInlineDiff(before, after, {
          startLine: 1,
          endLine: before.split('\n').length,
        });
        if (plan.clampedAfter !== after && failures.length < 12)
          failures.push({ before, after, actual: plan.clampedAfter });
      }
    expect(failures).toEqual([]);
  });

  it('whole-line operations are ordered, non-overlapping and reconstruct candidate exactly', () => {
    const pairs = [
      ['甲。乙。丙。\n重复\n重复\n尾行', '甲。丁。\n重复\n新行\n尾行\n'],
      ['\n\n末行\n', '\n末行'],
      ['独行。第二句。第三句。', '独行。更新第二句。第三句。'],
      ['', '新行\n'],
      ['只有一行', ''],
    ];
    for (const [before, after] of pairs) {
      const hunks = hunksToLineDiff(before, after);
      const removed = new Set<number>();
      for (const hunk of hunks) {
        if (hunk.removedStartLine !== null && hunk.removedEndLine !== null) {
          for (let i = hunk.removedStartLine; i <= hunk.removedEndLine; i += 1) {
            expect(removed.has(i), `overlap at line ${i}`).toBe(false);
            removed.add(i);
          }
        }
        expect(hunk.addedLineCount).toBe(hunk.newLines.length);
      }
      expect(
        planAnchoredInlineDiff(before, after, { startLine: 1, endLine: before.split('\n').length })
          .clampedAfter,
      ).toBe(after);
    }
  });

  it('normalizes CRLF without losing terminal blank lines or astral text', () => {
    const before = '标题\r\n甲。乙。\r\n\r\n😀\r\n';
    const after = '标题\r\n甲。改句。\r\n\r\n😀\r\n\r\n';
    expect(planAnchoredInlineDiff(before, after, { startLine: 1, endLine: 5 }).clampedAfter).toBe(
      after.replace(/\r\n/g, '\n'),
    );
  });

  it('never mutates uniquely protected leading or trailing lines under off-anchor model drift', () => {
    const bodies = ['', '中段', '第一句。第二句。', '重复\n重复', '\n中段\n'];
    for (const body of bodies)
      for (const replacement of bodies) {
        const before = `保护开头😀\n${body}\n保护结尾𠮷`;
        const after = `越界开头\n${replacement}\n越界结尾`;
        const result = planAnchoredInlineDiff(before, after, {
          startLine: 2,
          endLine: before.split('\n').length - 1,
        });
        expect(result.clampedAfter.startsWith('保护开头😀\n')).toBe(true);
        expect(result.clampedAfter.endsWith('\n保护结尾𠮷')).toBe(true);
        expect(result.droppedOffAnchor).toBeGreaterThan(0);
      }
  });

  it('handles large fully changed documents with exact full-range reconstruction', () => {
    const before = Array.from({ length: 2500 }, (_, i) => `旧行${i}。第二句。`).join('\n');
    const after = Array.from({ length: 2501 }, (_, i) => `新行${i}。末句。`).join('\n');
    expect(
      planAnchoredInlineDiff(before, after, { startLine: 1, endLine: 2500 }).clampedAfter,
    ).toBe(after);
  });
});

it('bounded fallback fails closed for ambiguous partial-scope additions', () => {
  const before = [
    '保护首行',
    ...Array.from({ length: 2500 }, (_, i) => `旧段${i}`),
    '保护末行',
  ].join('\n');
  const after = [
    '越界首行',
    ...Array.from({ length: 2501 }, (_, i) => `新段${i}`),
    '越界末行',
  ].join('\n');
  const plan = planAnchoredInlineDiff(before, after, { startLine: 2, endLine: 2501 });
  expect(plan.clampedAfter).toBe(before);
  expect(plan.isNoop).toBe(true);
  expect(plan.droppedOffAnchor).toBeGreaterThan(0);
});
