/**
 * 灵感速记的红线：载体是作者自己的 `灵感.md`，左栏只是它的一个入口。
 * 所以任何一次勾选 / 删除都只能动它自己那一行——文件里其余内容（正文段落、
 * 作者手写的小标题、别的列表）必须原样留下。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  appendIdeaNote,
  ideaNotesPath,
  parseIdeaNotes,
  removeIdeaNote,
  toggleIdeaNote,
} from '../src/lib/idea-notes';

const SAMPLE = [
  '# 灵感',
  '',
  '一场蓝色雨后，规则改写了世界。',
  '',
  '- 主角的系统在第三章才觉醒',
  '- [x] 给女二加一条独立线',
  '- [ ] 补第 12 章的雨',
  '-',
].join('\n');

test('三种列表写法都算条目，非列表行与空条目不算', () => {
  const notes = parseIdeaNotes(SAMPLE);
  assert.deepEqual(
    notes.map((note) => [note.text, note.done]),
    [
      ['主角的系统在第三章才觉醒', false],
      ['给女二加一条独立线', true],
      ['补第 12 章的雨', false],
    ],
  );
  // 行号必须是文件里的真实行号，否则回写会改错行。
  assert.deepEqual(
    notes.map((note) => note.line),
    [4, 5, 6],
  );
});

test('追加落在末尾且不堆空行；空文件自带标题', () => {
  assert.equal(appendIdeaNote('', '第一条'), '# 灵感\n\n- 第一条\n');
  assert.equal(appendIdeaNote('# 灵感\n\n- 旧的\n\n\n', '新的'), '# 灵感\n\n- 旧的\n- 新的\n');
  // 空白输入不产生空条目。
  assert.equal(appendIdeaNote(SAMPLE, '   '), SAMPLE);
});

test('勾选只改那一行，其余内容逐字保留', () => {
  const toggled = toggleIdeaNote(SAMPLE, 4, true);
  const lines = toggled.split('\n');
  assert.equal(lines[4], '- [x] 主角的系统在第三章才觉醒');
  assert.deepEqual(
    lines.filter((_, index) => index !== 4),
    SAMPLE.split('\n').filter((_, index) => index !== 4),
  );
});

test('取消勾选写回未完成态，缩进保留', () => {
  assert.equal(toggleIdeaNote('  - [x] 缩进条目', 0, false), '  - [ ] 缩进条目');
});

test('行号对不上或指向非列表行时原样返回——宁可这次点击没生效，也不能改错行', () => {
  assert.equal(toggleIdeaNote(SAMPLE, 2, true), SAMPLE, '正文行不得被改成待办');
  assert.equal(toggleIdeaNote(SAMPLE, 99, true), SAMPLE);
  assert.equal(removeIdeaNote(SAMPLE, 2), SAMPLE, '正文行不得被删');
  assert.equal(removeIdeaNote(SAMPLE, -1), SAMPLE);
});

test('删除只摘掉那一行', () => {
  const removed = removeIdeaNote(SAMPLE, 5);
  assert.ok(!removed.includes('给女二加一条独立线'));
  assert.ok(removed.includes('主角的系统在第三章才觉醒'));
  assert.ok(removed.includes('一场蓝色雨后，规则改写了世界。'));
});

test('速记文件落在项目根，跟随路径分隔符风格', () => {
  assert.equal(ideaNotesPath('D:\\连载\\末世吞噬'), 'D:\\连载\\末世吞噬\\灵感.md');
  assert.equal(ideaNotesPath('/home/w/books/雪夜斩/'), '/home/w/books/雪夜斩/灵感.md');
});
