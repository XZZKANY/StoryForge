/**
 * 作品底座映射层红线（纯函数，无 DOM）。
 *
 * 这一层唯一的职责是**照抄**后端投影：章序、字数、截断条数都不许前端自己算。
 * 前端另算一遍就会出现「面板说第 12 章、模型以为第 13 章」，比不显示更糟。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  droppedCount,
  formatEstimatedChars,
  mapBookContextPayload,
} from '../src/lib/book-context';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    total_chapters: 3,
    total_estimated_chars: 12345,
    current_relative_path: '正文/第002章.md',
    current_ordinal: 2,
    chapters: [
      { ordinal: 1, relative_path: '正文/第001章.md', estimated_chars: 4000 },
      { ordinal: 2, relative_path: '正文/第002章.md', estimated_chars: 4100 },
      { ordinal: 3, relative_path: '正文/第003章.md', estimated_chars: 4245 },
    ],
    skeleton: [{ relative_path: '大纲/总纲.md', estimated_chars: 800 }],
    skeleton_total: 1,
    skeleton_limit: 12,
    roster: [
      {
        canonical_name: '陈默',
        aliases: ['守夜人'],
        first_chapter: 1,
        last_chapter: 3,
        missing: false,
      },
    ],
    roster_declared_total: 1,
    roster_limit: 20,
    dossier_relative_path: '.storyforge/canon/derived/dossier.md',
    previous_chapter: { relative_path: '正文/第001章.md', tail: '雨停了。' },
    prompt_block: '[作品底座 · 确定性]\n· 全书 3 章正文。',
    ...overrides,
  };
}

test('the chapter order is copied from the backend, never recomputed here', () => {
  const snapshot = mapBookContextPayload(payload());

  assert.ok(snapshot);
  // 后端按 chapter_ordinals 的路径序编号；前端照单全收,不解析文件名里的数字。
  assert.deepEqual(
    snapshot.chapters.map((chapter) => chapter.ordinal),
    [1, 2, 3],
  );
  assert.equal(snapshot.currentOrdinal, 2);
  assert.equal(snapshot.currentRelativePath, '正文/第002章.md');
});

test('a chapter row carries the bare filename for display but keeps the full relative path', () => {
  const snapshot = mapBookContextPayload(payload());

  assert.ok(snapshot);
  assert.equal(snapshot.chapters[0].name, '第001章.md');
  assert.equal(snapshot.chapters[0].relativePath, '正文/第001章.md');
});

test('a malformed payload is rejected instead of degrading into an empty manuscript', () => {
  // 空手稿会让作者以为「书里什么都没有」;形状不对就该如实报错。
  assert.equal(mapBookContextPayload(null), null);
  assert.equal(mapBookContextPayload('nope'), null);
  assert.equal(mapBookContextPayload({}), null);
  assert.equal(mapBookContextPayload({ chapters: 'not-an-array' }), null);
});

test('an empty book is still a valid projection, not an error', () => {
  const snapshot = mapBookContextPayload(payload({ chapters: [], total_chapters: 0 }));

  assert.ok(snapshot);
  assert.equal(snapshot.totalChapters, 0);
  assert.deepEqual(snapshot.chapters, []);
});

test('rows missing an ordinal or a path are dropped rather than rendered as blanks', () => {
  const snapshot = mapBookContextPayload(
    payload({
      chapters: [
        { ordinal: 1, relative_path: '正文/第001章.md', estimated_chars: 10 },
        { relative_path: '正文/无章号.md' },
        { ordinal: 3 },
      ],
    }),
  );

  assert.ok(snapshot);
  assert.equal(snapshot.chapters.length, 1);
});

test('truncation counts survive the mapping so the panel can name what was dropped', () => {
  const snapshot = mapBookContextPayload(
    payload({
      skeleton: Array.from({ length: 12 }, (_, index) => ({
        relative_path: `设定/${index}.md`,
        estimated_chars: 100,
      })),
      skeleton_total: 17,
      roster: Array.from({ length: 20 }, (_, index) => ({ canonical_name: `人物${index}` })),
      roster_declared_total: 27,
    }),
  );

  assert.ok(snapshot);
  // #235 的教训:只给一个「已截断」布尔,作者永远不知道整类被丢了。
  assert.equal(droppedCount(snapshot.skeletonTotal, snapshot.skeleton.length), 5);
  assert.equal(droppedCount(snapshot.rosterDeclaredTotal, snapshot.roster.length), 7);
});

test('droppedCount never goes negative when nothing was truncated', () => {
  assert.equal(droppedCount(3, 3), 0);
  assert.equal(droppedCount(3, 5), 0);
});

test('the prompt the model actually received is carried through verbatim', () => {
  const block = '[作品底座 · 确定性]\n· 全书 30 章正文；当前打开的是第 30 章。';
  const snapshot = mapBookContextPayload(payload({ prompt_block: block }));

  assert.ok(snapshot);
  assert.equal(snapshot.promptBlock, block);
});

test('the char format mirrors the backend _format_chars thresholds', () => {
  // 与 apps/api/app/domains/agent_runs/book_context.py::_format_chars 同口径;
  // 改一侧必须同步改另一侧,否则面板与 prompt 会报出两个字数。
  assert.equal(formatEstimatedChars(0), '约 0 字');
  assert.equal(formatEstimatedChars(999), '约 999 字');
  assert.equal(formatEstimatedChars(1000), '约 1.0 千字');
  assert.equal(formatEstimatedChars(4100), '约 4.1 千字');
  assert.equal(formatEstimatedChars(9999), '约 10.0 千字');
  assert.equal(formatEstimatedChars(10000), '约 1.0 万字');
  assert.equal(formatEstimatedChars(124000), '约 12.4 万字');
});
