/**
 * 全文搜索匹配器。
 *
 * 本领域特有的一条：小说 .md 的一「行」常常是一整个自然段（几百上千字），
 * 所以结果必须是命中处附近的窗口片段，且高亮偏移相对片段而非原行 ——
 * 偏移算错的话高亮会落在离命中很远的地方，而这在整行短文本的用例里根本测不出来。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  countHits,
  findHitsInContent,
  MAX_HITS_PER_FILE,
  SEARCH_MIN_QUERY,
} from '../src/lib/project-search';

test('逐行给出 1-based 行号，可直接用于跳转', () => {
  const { hits } = findHitsInContent('第一行\n有玄明的第二行\n第三行\n又见玄明', '玄明');
  assert.deepEqual(
    hits.map((hit) => hit.line),
    [2, 4],
  );
});

test('同一行内多次命中各算一处，且不会因重叠自增死循环', () => {
  const { hits } = findHitsInContent('aaaa', 'aa');
  assert.equal(hits.length, 2, '按不重叠推进：aa|aa');
  assert.deepEqual(
    hits.map((hit) => hit.line),
    [1, 1],
  );
});

test('默认不区分大小写，可显式开启区分', () => {
  assert.equal(findHitsInContent('Hello hello', 'hello').hits.length, 2);
  assert.equal(findHitsInContent('Hello hello', 'hello', { caseSensitive: true }).hits.length, 1);
});

test('过短查询直接返回空，不触发扫描', () => {
  assert.equal(findHitsInContent('随便什么内容', 'a'.repeat(SEARCH_MIN_QUERY - 1)).hits.length, 0);
});

test('长段落只回窗口片段，高亮偏移相对片段而非原行', () => {
  // 命中埋在一个 600 字的自然段中间——这正是小说正文的常态。
  const needle = '青铜钟';
  const line = `${'霜'.repeat(300)}${needle}${'雪'.repeat(300)}`;
  const { hits } = findHitsInContent(line, needle);
  assert.equal(hits.length, 1);

  const hit = hits[0];
  assert.ok(hit.text.length < 120, `片段应远短于原行，实际 ${hit.text.length}`);
  assert.ok(hit.text.startsWith('…') && hit.text.endsWith('…'), '两端截断应带省略号');
  assert.equal(
    hit.text.slice(hit.start, hit.end),
    needle,
    'start/end 必须能从片段里切回命中词本身',
  );
});

test('片段贴着行首 / 行尾时不加多余省略号，偏移仍然对得上', () => {
  const head = findHitsInContent('青铜钟在响', '青铜钟').hits[0];
  assert.ok(!head.text.startsWith('…'), '行首命中不该有前省略号');
  assert.equal(head.text.slice(head.start, head.end), '青铜钟');

  const tail = findHitsInContent('钟声来自青铜钟', '青铜钟').hits[0];
  assert.ok(!tail.text.endsWith('…'), '行尾命中不该有后省略号');
  assert.equal(tail.text.slice(tail.start, tail.end), '青铜钟');
});

test('CRLF 文件的行尾回车不进片段，也不影响行号', () => {
  const { hits } = findHitsInContent('第一行\r\n玄明\r\n第三行', '玄明');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.ok(!hits[0].text.includes('\r'), '片段里不该带 \\r');
});

test('单文件命中数封顶并标记 truncated，防一个词把面板刷爆', () => {
  const content = Array.from({ length: MAX_HITS_PER_FILE + 20 }, () => '玄明').join('\n');
  const { hits, truncated } = findHitsInContent(content, '玄明');
  assert.equal(hits.length, MAX_HITS_PER_FILE);
  assert.equal(truncated, true);
});

test('countHits 跨文件累加', () => {
  assert.equal(
    countHits([
      { path: 'a', hits: [{ line: 1, text: 'x', start: 0, end: 1 }], truncated: false },
      {
        path: 'b',
        hits: [
          { line: 2, text: 'y', start: 0, end: 1 },
          { line: 3, text: 'z', start: 0, end: 1 },
        ],
        truncated: false,
      },
    ]),
    3,
  );
});
