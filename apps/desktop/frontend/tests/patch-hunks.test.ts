import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyPatchHunk, applyPatchHunkToCurrent, buildPatchHunks } from '../src/lib/patch-hunks';

test('patch hunks split separated line changes and apply one hunk at a time', () => {
  const before = ['第一句。', '第二句略硬。', '第三句保留。', '第四句略散。', ''].join('\n');
  const after = ['第一句。', '第二句更顺。', '第三句保留。', '第四句收紧。', ''].join('\n');

  const hunks = buildPatchHunks(before, after);

  assert.equal(hunks.length, 2);
  assert.deepEqual(
    hunks.map((hunk) => [hunk.originalStartIndex, hunk.removedLines, hunk.addedLines]),
    [
      [1, 1, 1],
      [3, 1, 1],
    ],
  );

  const afterFirstHunk = applyPatchHunk(before, after, hunks[0]);
  assert.equal(
    afterFirstHunk,
    ['第一句。', '第二句更顺。', '第三句保留。', '第四句略散。', ''].join('\n'),
  );

  const remainingHunks = buildPatchHunks(afterFirstHunk, after);
  assert.equal(remainingHunks.length, 1);
  assert.equal(applyPatchHunk(afterFirstHunk, after, remainingHunks[0]), after);
});

test('patch hunks handle insertion-only and deletion-only edits', () => {
  const before = ['开场。', '多余句。', '收束。', ''].join('\n');
  const after = ['新增钩子。', '开场。', '收束。', ''].join('\n');

  const hunks = buildPatchHunks(before, after);

  assert.equal(hunks.length, 2);
  assert.equal(hunks[0].removedLines, 0);
  assert.equal(hunks[0].addedLines, 1);
  assert.equal(hunks[1].removedLines, 1);
  assert.equal(hunks[1].addedLines, 0);

  const afterInsertion = applyPatchHunk(before, after, hunks[0]);
  assert.equal(afterInsertion, ['新增钩子。', '开场。', '多余句。', '收束。', ''].join('\n'));
});

test('patch hunks split separated CJK sentence edits within one long paragraph', () => {
  const before =
    '沈砚推开铜钟铺的门，风铃只响了一声。城门外的雾仍旧压着街面，他觉得这像一场拖得太久的梦。巡夜人从巷口经过，没有发现柜台下的旧印。铜匠留下的账册还摊在火盆旁，纸角已经卷黑。';
  const after =
    '沈砚推开铜钟铺的门，风铃只响了一声。城门外的雾仍旧贴着湿冷街面，他觉得这像一场拖得太久的梦。巡夜人从巷口经过，没有发现柜台下的旧印。铜匠留下的账册被他收进怀里，纸角已经卷黑。';

  const hunks = buildPatchHunks(before, after);

  assert.equal(hunks.length, 2);
  assert.deepEqual(
    hunks.map((hunk) => hunk.unitKind),
    ['segment', 'segment'],
  );
  assert.match(hunks[0].beforeText, /雾仍旧压着街面/);
  assert.match(hunks[1].beforeText, /账册还摊在火盆旁/);
});

test('patch hunks can be accepted one by one after current content has changed', () => {
  const before =
    '沈砚推开铜钟铺的门，风铃只响了一声。城门外的雾仍旧压着街面，他觉得这像一场拖得太久的梦。巡夜人从巷口经过，没有发现柜台下的旧印。铜匠留下的账册还摊在火盆旁，纸角已经卷黑。';
  const after =
    '沈砚推开铜钟铺的门，风铃只响了一声。城门外的雾仍旧贴着湿冷街面，他觉得这像一场拖得太久的梦。巡夜人从巷口经过，没有发现柜台下的旧印。铜匠留下的账册被他收进怀里，纸角已经卷黑。';
  const hunks = buildPatchHunks(before, after);

  const afterFirstHunk = applyPatchHunkToCurrent(before, hunks[0]);
  assert.match(afterFirstHunk, /雾仍旧贴着湿冷街面/);
  assert.match(afterFirstHunk, /账册还摊在火盆旁/);

  const afterSecondHunk = applyPatchHunkToCurrent(afterFirstHunk, hunks[1]);
  assert.equal(afterSecondHunk, after);
});

test('patch hunk application rejects a changed local slice as a single-hunk conflict', () => {
  const before =
    '沈砚推开铜钟铺的门，风铃只响了一声。城门外的雾仍旧压着街面，他觉得这像一场拖得太久的梦。巡夜人从巷口经过，没有发现柜台下的旧印。';
  const after =
    '沈砚推开铜钟铺的门，风铃只响了一声。城门外的雾仍旧贴着街面，他觉得这像一场拖得太久的梦。巡夜人从巷口经过，没有发现柜台下的旧印。';
  const [hunk] = buildPatchHunks(before, after);
  const locallyEdited = before.replace('雾仍旧压着街面', '雾忽然抬高');

  assert.throws(
    () => applyPatchHunkToCurrent(locallyEdited, hunk),
    /该修改块的原文已变化/,
  );
});

test('insertion hunks relocate by context after an earlier hunk changes length', () => {
  const before = '铜钟响了。街面仍暗。巡夜人停步。';
  const after = '铜钟连续响了三声。街面仍暗。沈砚藏起旧印。巡夜人停步。';
  const hunks = buildPatchHunks(before, after);

  assert.equal(hunks.length, 2);
  assert.equal(hunks[1].beforeText, '');

  const afterFirstHunk = applyPatchHunkToCurrent(before, hunks[0]);
  assert.equal(afterFirstHunk, '铜钟连续响了三声。街面仍暗。巡夜人停步。');

  const afterInsertion = applyPatchHunkToCurrent(afterFirstHunk, hunks[1]);
  assert.equal(afterInsertion, after);
});

test('new file patch (empty before) builds insertion-only hunks and applies to empty current', () => {
  const before = '';
  const after = ['第三章 灯下拓片', '', '沈青梧把铜镜放到灯下。', ''].join('\n');

  const hunks = buildPatchHunks(before, after);

  assert.ok(hunks.length >= 1);
  assert.ok(hunks.every((hunk) => hunk.removedLines === 0));
  assert.ok(hunks.every((hunk) => hunk.beforeText === ''));

  let current = before;
  for (const hunk of hunks) {
    current = applyPatchHunkToCurrent(current, hunk);
  }
  assert.equal(current, after);
});
