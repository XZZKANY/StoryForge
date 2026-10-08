import { expect, it } from 'vitest';
import {
  createSuggestionChangeSet,
  projectRemainingSuggestion,
} from '../src/lib/suggestion-change-set';
import {
  planHunkAccept,
  planWholeAccept,
  verifiedAppliedOpIds,
  projectSourceOperations,
} from '../src/lib/suggestion-ops';
import type { PatchHunk } from '../src/lib/patch-hunks';

const normalize = (text: string) => text.replace(/\r\n/g, '\n');
const cases = [
  ['甲。\n乙。\n甲。', '\n甲。\n乙。'],
  ['甲。\n乙。\n甲。', '甲。乙。\n甲。\n甲。'],
  ['甲。\n\n甲。\n尾。', '新增。\n甲。\n\n甲。\n新尾。'],
  ['头。\n甲。\n乙。\n甲。\n尾。', '头。\n乙。\n甲。\n改尾。'],
  ['A\r\nB\r\nA\r\n', '\r\nA\r\nB\r\n'],
  ['首句。中句。末句。\n\n尾行。', '首句。末句。\n\n新尾行。\n'],
  ['同句。\n同句。\n同句。\n结尾。', '同句。\n新增。\n同句。\n新结尾。'],
  ['\n甲。\n\n乙。\n', '甲。\n乙。'],
] as const;
function oracle(before: string, ops: readonly PatchHunk[], ids: ReadonlySet<string>) {
  let result = before;
  for (const op of [...ops]
    .filter((op) => ids.has(op.id))
    .sort((a, b) => b.originalStartOffset - a.originalStartOffset)) {
    result =
      result.slice(0, op.originalStartOffset) + op.afterText + result.slice(op.originalEndOffset);
  }
  return result;
}
function orders(ops: readonly PatchHunk[]): PatchHunk[][] {
  return ops.length <= 1
    ? [Array.from(ops)]
    : ops.flatMap((op) => orders(ops.filter((other) => other !== op)).map((rest) => [op, ...rest]));
}
it.each(cases)('独立账本控制：所有接受顺序及重复接受保持精确投影 %s → %s', (before, after) => {
  const set = createSuggestionChangeSet(before, after);
  expect(oracle(before, set.operations, new Set(set.operations.map((op) => op.id)))).toBe(after);
  for (const order of orders(set.operations)) {
    let current = before;
    const accepted = new Set<string>();
    for (const op of order) {
      const plan = planHunkAccept(current, op, before, {
        operations: set.operations,
        appliedOpIds: accepted,
      });
      accepted.add(op.id);
      current = plan.content;
      expect(current).toBe(oracle(before, set.operations, accepted));
      const repeated = planHunkAccept(current, op, before, {
        operations: set.operations,
        appliedOpIds: accepted,
      });
      expect(repeated.content).toBe(current);
      expect(repeated.alreadyApplied).toBe(true);
      const idsBefore = [...accepted];
      const projection = projectRemainingSuggestion(current, set, accepted);
      expect(projection.after).toBe(after);
      expect(projection.view.conflicts).toEqual({});
      expect([...accepted]).toEqual(idsBefore);
      expect(
        planWholeAccept(current, before, after, accepted, normalize, set.operations).content,
      ).toBe(after);
    }
    expect(current).toBe(after);
  }
});

it('独立账本控制：后来范围外作者句子不会被原始快照覆盖', () => {
  const before = '首段。\n原句甲。\n中间。\n原句乙。\n末段。';
  const after = '首段。\n改句甲。\n中间。\n改句乙。\n末段。';
  const set = createSuggestionChangeSet(before, after);
  const first = set.operations[0];
  const accepted = new Set([first.id]);
  const current = oracle(before, set.operations, accepted) + '\n作者后来新增的独立段落。';
  for (const op of set.operations.slice(1)) {
    try {
      const result = planHunkAccept(current, op, before, {
        operations: set.operations,
        appliedOpIds: accepted,
      });
      expect(result.content.endsWith('作者后来新增的独立段落。')).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  }
});

it('独立账本控制：作者改回源稿后不能重新施加已消费块或声称仍已应用', () => {
  const before = '甲。\n乙。\n甲。';
  const after = '\n甲。\n乙。';
  const set = createSuggestionChangeSet(before, after);
  const op = set.operations.find((item) => item.beforeText === '乙。\n甲。')!;
  expect(op).toBeDefined();
  const accepted = new Set([op.id]);
  const result = planHunkAccept(before, op, before, {
    operations: set.operations,
    appliedOpIds: accepted,
  });
  expect(result.content).toBe(before);
  expect(result.alreadyApplied).toBe(true);
  expect(verifiedAppliedOpIds(before, before, set.operations, accepted).has(op.id)).toBe(false);
});

it.each(['prefix', 'suffix'] as const)(
  '独立归属控制：原块未删且作者另加%s内容时不能把结果前缀当作完成',
  (side) => {
    const before = '甲。\n乙。\n甲。';
    const after = '\n甲。\n乙。';
    const set = createSuggestionChangeSet(before, after);
    const op = set.operations.find((item) => item.beforeText === '乙。\n甲。')!;
    const accepted = new Set([op.id]);
    const current = side === 'prefix' ? '作者后来新增。\n' + before : before + '\n作者后来新增。';
    expect(verifiedAppliedOpIds(current, before, set.operations, accepted).has(op.id)).toBe(false);
  },
);
it('独立归属正控制：真实删除已完成且后来追加范围外文本仍有原位置证据', () => {
  const before = '甲。\n乙。\n甲。';
  const after = '\n甲。\n乙。';
  const set = createSuggestionChangeSet(before, after);
  const op = set.operations.find((item) => item.beforeText === '乙。\n甲。')!;
  const accepted = new Set([op.id]);
  const current = oracle(before, set.operations, accepted) + '\n作者后来新增。';
  expect(verifiedAppliedOpIds(current, before, set.operations, accepted).has(op.id)).toBe(true);
});

it.each(['unknown-id', 'duplicate-id', 'overlap', 'wrong-source'] as const)(
  '独立账本拒绝控制：%s不能构成精确快照证明',
  (kind) => {
    const before = '甲。\n乙。\n丙。\n丁。';
    const after = '改甲。\n乙。\n改丙。\n丁。';
    const set = createSuggestionChangeSet(before, after);
    expect(set.operations.length).toBeGreaterThan(1);
    let source: string = before;
    let ops: readonly PatchHunk[] = set.operations;
    const selected = new Set(set.operations.map((op) => op.id));
    if (kind === 'unknown-id') selected.add('不存在的操作身份');
    if (kind === 'duplicate-id')
      ops = set.operations.map((op) => ({ ...op, id: set.operations[0].id }));
    if (kind === 'overlap')
      ops = [
        set.operations[0],
        {
          ...set.operations[1],
          originalStartOffset: set.operations[0].originalStartOffset,
          originalEndOffset: set.operations[0].originalEndOffset,
          beforeText: set.operations[0].beforeText,
        },
      ];
    if (kind === 'wrong-source') source = before.replace('甲。', '外部作者甲。');
    expect(projectSourceOperations(source, ops, selected)).toBeNull();
  },
);
