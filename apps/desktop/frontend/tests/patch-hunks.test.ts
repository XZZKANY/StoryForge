import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  applyPatchHunkToCurrent,
  buildPatchHunks,
  hunkZoneAfterLineNumber,
  isWholeFileDrifted,
  placePatchHunks,
} from '../src/lib/patch-hunks';

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

  const afterFirstHunk = applyPatchHunkToCurrent(before, hunks[0]);
  assert.equal(
    afterFirstHunk,
    ['第一句。', '第二句更顺。', '第三句保留。', '第四句略散。', ''].join('\n'),
  );

  const remainingHunks = buildPatchHunks(afterFirstHunk, after);
  assert.equal(remainingHunks.length, 1);
  assert.equal(applyPatchHunkToCurrent(afterFirstHunk, remainingHunks[0]), after);
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

  const afterInsertion = applyPatchHunkToCurrent(before, hunks[0]);
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

  assert.throws(() => applyPatchHunkToCurrent(locallyEdited, hunk), /该修改块的原文已变化/);
});

test('T07-F1：重复目标行被作者改动后不再回退到零分候选，判为冲突', () => {
  const before = '重复句。\n重复句。\n尾巴。';
  const after = '重复句改。\n重复句。\n尾巴。';
  const [hunk] = buildPatchHunks(before, after);
  assert.equal(hunk.beforeTextOccurrences, 2, '目标原文在源文件里出现两次');
  // 作者在待确认期改了目标行（第一处），只剩另一处重复且上下文不再匹配。
  const edited = '重复句作者改。\n重复句。\n尾巴。';
  assert.throws(() => applyPatchHunkToCurrent(edited, hunk), /原文已变化|出现多次/);
});

test('T07-F1：重复目标行无作者改动时结果与 after 逐字一致', () => {
  const before = '重复句。\n重复句。\n尾巴。';
  const after = '重复句改。\n重复句。\n尾巴。';
  const [hunk] = buildPatchHunks(before, after);
  assert.equal(applyPatchHunkToCurrent(before, hunk), after);
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

test('whole-file drift guard passes when current matches before across EOL differences', () => {
  const normalizeEol = (text: string) => text.replace(/\r\n/g, '\n');
  const before = '沈砚推开铜钟铺的门。\n风铃只响了一声。\n';
  const currentCrlf = '沈砚推开铜钟铺的门。\r\n风铃只响了一声。\r\n';

  assert.equal(isWholeFileDrifted(before, before, normalizeEol), false);
  // 仅换行风格不同不算漂移：归一化后一致即可放行写回。
  assert.equal(isWholeFileDrifted(currentCrlf, before, normalizeEol), false);
});

test('whole-file drift guard flags a locally edited file as drifted', () => {
  const normalizeEol = (text: string) => text.replace(/\r\n/g, '\n');
  const before = '沈砚推开铜钟铺的门。\n风铃只响了一声。\n';
  const locallyEdited = before.replace('只响了一声', '连响了三声');

  // 作者本地改动后旧补丁的 before 不再匹配当前内容，必须判漂移、拒直接写回。
  assert.equal(isWholeFileDrifted(locallyEdited, before, normalizeEol), true);
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

test('接受键落在新稿侧这处改动的最后一行下方：有新稿内容的与 modifiedEndIndex 一致', () => {
  const before = ['开场。', '第二句略硬。', '中段。', '收束。', ''].join('\n');
  const after = ['开场。', '第二句更顺。', '中段。', '新加一句。', '收束。', ''].join('\n');
  const hunks = buildPatchHunks(before, after);
  assert.equal(hunks.length, 2);
  assert.deepEqual(
    hunks.map((hunk) => hunkZoneAfterLineNumber(hunk, after)),
    [2, 4],
  );
  for (const hunk of hunks) {
    assert.equal(hunkZoneAfterLineNumber(hunk, after), hunk.modifiedEndIndex);
  }
});

test('纯删除：整行删除跟在 Monaco 画删除行的位置（上一行之后），句内删除挂在所在行下方', () => {
  const lineBefore = ['开场。', '多余句。', '收束。', ''].join('\n');
  const lineAfter = ['开场。', '收束。', ''].join('\n');
  const [lineHunk] = buildPatchHunks(lineBefore, lineAfter);
  assert.equal(lineHunk.afterText, '');
  assert.equal(hunkZoneAfterLineNumber(lineHunk, lineAfter), lineHunk.modifiedStartIndex);
  assert.equal(hunkZoneAfterLineNumber(lineHunk, lineAfter), 1);

  const topBefore = ['删掉的开头。', '开场。', ''].join('\n');
  const topAfter = ['开场。', ''].join('\n');
  const [topHunk] = buildPatchHunks(topBefore, topAfter);
  assert.equal(hunkZoneAfterLineNumber(topHunk, topAfter), 0, '首行之前删的挂在第 0 行之后');

  const segmentBefore = ['开场。', '甲说，乙笑了。丙哭了。', '收束。', ''].join('\n');
  const segmentAfter = ['开场。', '甲说，丙哭了。', '收束。', ''].join('\n');
  const [segmentHunk] = buildPatchHunks(segmentBefore, segmentAfter);
  assert.equal(segmentHunk.unitKind, 'segment');
  assert.equal(segmentHunk.afterText, '');
  assert.equal(
    hunkZoneAfterLineNumber(segmentHunk, segmentAfter),
    segmentHunk.modifiedStartIndex + 1,
  );
  assert.equal(hunkZoneAfterLineNumber(segmentHunk, segmentAfter), 2);

  // 删的是全文最后一句（没有换行收尾）：按索引 +1 会落到不存在的第 2 行，按偏移算仍在第 1 行。
  const tailAfter = '甲说了。';
  const [tailHunk] = buildPatchHunks('甲说了。乙笑了。', tailAfter);
  assert.equal(tailHunk.afterText, '');
  assert.equal(hunkZoneAfterLineNumber(tailHunk, tailAfter), 1);
});

test('同一行的几处句段改动合进一个 zone，按文中顺序编号', () => {
  const before = ['开场。', '甲说，天晴了。他说，乙笑了。', '收束。', ''].join('\n');
  const after = ['开场改。', '甲说，天阴了。他说，乙哭了。', '收束。', ''].join('\n');
  const hunks = buildPatchHunks(before, after);
  assert.equal(hunks.length, 3);
  const { zones, unplaced } = placePatchHunks(hunks, before, after);
  assert.deepEqual(unplaced, []);
  assert.deepEqual(
    zones.map((zone) => [zone.afterLineNumber, zone.hunks.map((placed) => placed.index)]),
    [
      [1, [0]],
      [2, [1, 2]],
    ],
  );
  assert.equal(zones[1].hunks[0].hunk, hunks[1], '带的是原 hunk 对象，接受时原样交回');
});

test('分块接受之后（operationView）：原稿坐标的操作按内容唯一匹配回当前差异，认不出的与冲突的留给横幅', () => {
  const ops = buildPatchHunks(
    ['A', 'B', 'C', 'D', 'E', ''].join('\n'),
    ['A', 'B2', 'C', 'D2', 'E', ''].join('\n'),
  );
  assert.equal(ops.length, 2);
  // 作者在开头加了两行：原稿第 2 行的改动在当前稿里落在第 4 行。
  const before = ['新一', '新二', 'A', 'B', 'C', 'D', 'E', ''].join('\n');
  const after = ['新一', '新二', 'A', 'B2', 'C', 'D2', 'E', ''].join('\n');
  const located = placePatchHunks(ops, before, after, {});
  assert.deepEqual(
    located.zones.map((zone) => [zone.afterLineNumber, zone.hunks.map((placed) => placed.hunk)]),
    [
      [4, [ops[0]]],
      [6, [ops[1]]],
    ],
  );
  assert.deepEqual(located.unplaced, []);

  const conflicted = placePatchHunks(ops, before, after, { [ops[1].id]: '原修改区间已变化' });
  assert.deepEqual(
    conflicted.unplaced.map((placed) => placed.index),
    [1],
  );
  assert.equal(conflicted.zones.length, 1);

  // 当前差异里找不到同内容的改动（作者改过这一行）：不猜位置，留给横幅。
  const drifted = placePatchHunks(ops, before, after.replace('D2', 'D3'), {});
  assert.deepEqual(
    drifted.unplaced.map((placed) => placed.hunk),
    [ops[1]],
  );

  // 两处操作内容一模一样：认领不唯一，都不落位。
  const twinBefore = ['X', 'Y', 'X', ''].join('\n');
  const twinAfter = ['X2', 'Y', 'X2', ''].join('\n');
  const twins = buildPatchHunks(twinBefore, twinAfter);
  assert.equal(twins.length, 2);
  const ambiguous = placePatchHunks(twins, twinBefore, twinAfter, {});
  assert.equal(ambiguous.zones.length, 0);
  assert.equal(ambiguous.unplaced.length, 2);
  // 当前差异里只剩一处同内容的改动，也认不出它是哪一个操作。
  const oneLeft = placePatchHunks(
    twins,
    ['X', 'Y', 'Z', ''].join('\n'),
    ['X2', 'Y', 'Z', ''].join('\n'),
    {},
  );
  assert.equal(oneLeft.zones.length, 0);
  assert.equal(oneLeft.unplaced.length, 2);
});
