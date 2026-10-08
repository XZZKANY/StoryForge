import { expect, it } from 'vitest';
import {
  createSuggestionChangeSet,
  projectRemainingSuggestion,
} from '../src/lib/suggestion-change-set';
import { planHunkAccept, planWholeAccept } from '../src/lib/suggestion-ops';
import type { PatchHunk } from '../src/lib/patch-hunks';

const normalize = (s: string) => s.replace(/\r\n/g, '\n');
// 独立坐标拼接预期，不复用生产投影实现或其位置猜测。
function oracle(before: string, selected: readonly PatchHunk[]) {
  let value = before;
  for (const op of [...selected].sort((a, b) => b.originalStartOffset - a.originalStartOffset))
    value =
      value.slice(0, op.originalStartOffset) + op.afterText + value.slice(op.originalEndOffset);
  return value;
}
function documents() {
  const units = ['甲。', '乙。', '', '甲。乙。'];
  const docs = new Set(['']);
  for (const a of units) {
    docs.add(a);
    for (const b of units) {
      docs.add([a, b].join('\n'));
      for (const c of units) docs.add([a, b, c].join('\n'));
    }
  }
  return [...docs];
}
function checkPair(before: string, after: string) {
  const set = createSuggestionChangeSet(before, after);
  expect(oracle(before, set.operations)).toBe(after);
  expect(planWholeAccept(before, before, after, new Set(), normalize, set.operations).content).toBe(
    after,
  );
  let subsets = 0,
    transitions = 0;
  for (let mask = 0; mask < 1 << set.operations.length; mask++) {
    subsets++;
    const selected = set.operations.filter((_, i) => mask & (1 << i));
    const accepted = new Set(selected.map((op) => op.id));
    const current = oracle(before, selected);
    const projection = projectRemainingSuggestion(current, set, accepted);
    expect(projection.after, JSON.stringify({ before, after, mask })).toBe(after);
    expect(projection.view.conflicts).toEqual({});
    expect([...accepted]).toEqual(selected.map((op) => op.id));
    expect(
      planWholeAccept(current, before, after, accepted, normalize, set.operations).content,
    ).toBe(after);
    for (const op of set.operations) {
      transitions++;
      const result = planHunkAccept(current, op, before, {
        operations: set.operations,
        appliedOpIds: accepted,
      });
      const next = selected.includes(op) ? selected : [...selected, op];
      expect(result.content, JSON.stringify({ before, after, mask, op: op.id })).toBe(
        oracle(before, next),
      );
      expect(result.alreadyApplied).toBe(accepted.has(op.id));
    }
  }
  return { subsets, transitions };
}
it('7,056 对短源稿覆盖全部已接受子集及下一处选择，完整和剩余投影精确一致', () => {
  let pairs = 0,
    subsets = 0,
    transitions = 0;
  for (const before of documents())
    for (const after of documents()) {
      const counts = checkPair(before, after);
      pairs++;
      subsets += counts.subsets;
      transitions += counts.transitions;
    }
  expect(pairs).toBe(7056);
  expect(subsets).toBeGreaterThan(15000);
  expect(transitions).toBeGreaterThan(20000);
});
it.each([
  ['', '她说：“别走。”\n灯还亮着。\n'],
  ['灯还亮着。\n\n灯还亮着。\n\n灯还亮着。', '灯灭了。\n\n灯还亮着。\n'],
  ['她说：“别走。” 他没回答。灯还亮着。', '她说：“别等。” 他没回答。灯已经灭了。'],
  ['甲。\r\n\r\n乙。\r\n丙。\r\n', '新甲。\r\n\r\n乙。\r\n新丙。\r\n\r\n'],
  ['甲。\r\n乙。\r\n丙。', '新甲。\n乙。\n新丙。'],
  ['甲。\n乙。\n', '甲。\n'],
])('代表性中文、空行和 CRLF 子集投影：%j', (before, after) => {
  checkPair(before, after);
});
