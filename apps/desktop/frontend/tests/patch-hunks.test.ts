import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyPatchHunk, buildPatchHunks } from '../src/lib/patch-hunks';

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
