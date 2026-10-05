import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildPatchHunks } from '../src/lib/patch-hunks';
import {
  createSuggestionChangeSet,
  matchChangeSetOperation,
  projectRemainingSuggestion,
} from '../src/lib/suggestion-change-set';

test('source revision, operation bytes and ranges are frozen once', () => {
  const set = createSuggestionChangeSet('A\nB\nC', 'AA\nB\nCC');
  assert.equal(set.baseRevision.content, set.before);
  assert.ok(Object.isFrozen(set));
  assert.ok(Object.isFrozen(set.baseRevision));
  assert.ok(Object.isFrozen(set.operations));
  for (const op of set.operations) {
    assert.ok(Object.isFrozen(op));
    assert.equal(set.before.slice(op.originalStartOffset, op.originalEndOffset), op.beforeText);
    assert.equal(set.after.slice(op.modifiedStartOffset, op.modifiedEndOffset), op.afterText);
  }
});

for (const separator of ['\n', '\r\n']) {
  test(`remaining projection preserves emoji and independent edits (${JSON.stringify(separator)})`, () => {
    const before = ['甲😀。', '乙。', '丙。'].join(separator);
    const after = ['甲😀改。', '乙。', '丙改。'].join(separator);
    const current = ['甲😀改。', '作者🧑‍💻自改。', '丙。'].join(separator);
    const set = createSuggestionChangeSet(before, after);
    const accepted = new Set([set.operations[0].id]);
    const result = projectRemainingSuggestion(current, set, accepted);
    assert.equal(result.after, ['甲😀改。', '作者🧑‍💻自改。', '丙改。'].join(separator));
    assert.equal(result.view.operations.length, 1);
    assert.equal(result.view.operations[0], set.operations[1]);
    assert.deepEqual(result.view.conflicts, {});
    assert.equal(result.finished, false);
    assert.equal(set.after, after);
    assert.deepEqual([...accepted], [set.operations[0].id]);
  });
}

test('completion is consumed operation identity, not equality with frozen full after', () => {
  const set = createSuggestionChangeSet('A\nB\nC', 'AA\nB\nCC');
  const current = 'AA\nB*\nCC';
  const projected = projectRemainingSuggestion(
    current,
    set,
    new Set(set.operations.map((op) => op.id)),
  );
  assert.equal(projected.finished, true);
  assert.equal(projected.after, current);
  assert.equal(projected.view.operations.length, 0);
});

test('unmappable residual stays explicit, no fabricated author→old replacement', () => {
  const set = createSuggestionChangeSet('甲。\n乙。\n丙。', '甲改。\n乙。\n丙改。');
  const current = '甲改。\n作者自改。\n作者另改。';
  const projected = projectRemainingSuggestion(current, set, new Set([set.operations[0].id]));
  assert.equal(projected.after, current);
  assert.equal(projected.finished, false);
  assert.equal(projected.view.operations[0], set.operations[1]);
  assert.match(projected.view.conflicts[set.operations[1].id], /定位|改动/);
  assert.equal(buildPatchHunks(current, projected.after).length, 0);
});

test('identical-looking operations require an owned object, not a cloned position id', () => {
  const set = createSuggestionChangeSet('X\nAAA\nY\nAAA\nZ', 'X\nBBB\nY\nBBB\nZ');
  assert.equal(set.operations.length, 2);
  assert.equal(matchChangeSetOperation(set, set.operations[0]), set.operations[0]);
  assert.equal(matchChangeSetOperation(set, set.operations[1]), set.operations[1]);
  assert.equal(matchChangeSetOperation(set, { ...set.operations[0] }), null);
});

test('same id with changed bytes cannot impersonate an original operation', () => {
  const set = createSuggestionChangeSet('旧一。\n中间。\n旧二。', '新一。\n中间。\n新二。');
  assert.equal(matchChangeSetOperation(set, { ...set.operations[1], beforeText: '手改。' }), null);
});

test('same-line separated operations retain exact original objects after one is accepted', () => {
  const set = createSuggestionChangeSet('灯灭了。风吹着。门关着。', '灯亮了。风吹着。门开着。');
  assert.equal(set.operations.length, 2);
  const result = projectRemainingSuggestion(
    '灯亮了。风吹着。门关着。',
    set,
    new Set([set.operations[0].id]),
  );
  assert.equal(result.after, '灯亮了。风吹着。门开着。');
  assert.equal(result.view.operations[0], set.operations[1]);
});

test('adjacent same-line double edits remain an indivisible original operation', () => {
  const set = createSuggestionChangeSet('灯灭了。门关着。', '灯亮了。门开着。');
  assert.equal(set.operations.length, 1);
  assert.equal(
    matchChangeSetOperation(set, {
      ...set.operations[0],
      beforeText: '灯灭了。',
      afterText: '灯亮了。',
    }),
    null,
  );
});

test('a half-selection of an indivisible original operation is not accepted', () => {
  const set = createSuggestionChangeSet('AB', 'CD');
  assert.equal(set.operations.length, 1);
  assert.equal(
    matchChangeSetOperation(set, { ...set.operations[0], beforeText: 'A', afterText: 'C' }),
    null,
  );
});

test('undo set restores original operations rather than deriving a new proposal', () => {
  const set = createSuggestionChangeSet('A\nB\nC', 'AA\nB\nCC');
  const result = projectRemainingSuggestion(set.before, set, new Set());
  assert.equal(result.after, set.after);
  assert.deepEqual(result.view.operations, set.operations);
  for (let index = 0; index < set.operations.length; index++) {
    assert.equal(result.view.operations[index], set.operations[index]);
  }
});
