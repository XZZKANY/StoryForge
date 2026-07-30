/**
 * 大纲跳转的红线：跳转靠行号，行号错一位作者就落在别的节点上。
 * 另外围栏代码块里的 `#` 不是标题——大纲文件里贴一段 DSML / 代码示例是常事。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  limitOutlineEntries,
  OUTLINE_HEADING_LIMIT,
  parseHeadings,
  type OutlineEntry,
} from '../src/lib/outline-index';

test('解析 ATX 标题并给出真实行号与层级', () => {
  const content = ['# 总纲', '', '正文一段。', '## 第一幕', '### 开场', '#### 钩子'].join('\n');
  assert.deepEqual(parseHeadings(content), [
    { line: 0, level: 1, text: '总纲' },
    { line: 3, level: 2, text: '第一幕' },
    { line: 4, level: 3, text: '开场' },
    { line: 5, level: 4, text: '钩子' },
  ]);
});

test('围栏代码块内的 # 不算标题', () => {
  const content = ['# 真标题', '```', '# 这是代码注释', '```', '## 又一个真标题'].join('\n');
  assert.deepEqual(
    parseHeadings(content).map((heading) => heading.text),
    ['真标题', '又一个真标题'],
  );
});

test('闭合式标题的尾部井号被剥掉，七个井号不是标题', () => {
  assert.deepEqual(parseHeadings('## 第二幕 ##'), [{ line: 0, level: 2, text: '第二幕' }]);
  assert.deepEqual(parseHeadings('####### 太深了'), []);
  // `#总纲` 没有空格，按 CommonMark 不是标题。
  assert.deepEqual(parseHeadings('#总纲'), []);
});

test('超过上限时如实报出丢掉的条数，不静默截断', () => {
  const entries: OutlineEntry[] = Array.from({ length: OUTLINE_HEADING_LIMIT + 7 }, (_, i) => ({
    line: i,
    level: 2,
    text: `节点 ${i}`,
    path: 'D:\\book\\大纲\\总纲.md',
    relativePath: '大纲/总纲.md',
  }));
  const limited = limitOutlineEntries(entries);
  assert.equal(limited.shown.length, OUTLINE_HEADING_LIMIT);
  assert.equal(limited.dropped, 7);
  assert.equal(limitOutlineEntries(entries.slice(0, 3)).dropped, 0);
});
