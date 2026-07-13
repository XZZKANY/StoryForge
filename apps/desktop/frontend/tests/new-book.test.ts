import assert from 'node:assert/strict';
import { test } from 'vitest';

import { deriveNewBookName } from '../src/lib/project/initialize';

// Q1「发送即开书」：书名从首句灵感推导。文件系统编排（建目录 / 写 灵感.md）依赖 Tauri，
// 只在真机可验；这里固化纯推导逻辑（首行 + 剔非法字符 + 截断 + 空回落）。
test('deriveNewBookName 取首行、剔文件系统非法字符、截断到 16，空则回落未命名新书', () => {
  assert.equal(deriveNewBookName('雪夜灯市的悬疑武侠'), '雪夜灯市的悬疑武侠');
  assert.equal(deriveNewBookName('第一行标题\n第二行细节忽略'), '第一行标题');
  assert.equal(deriveNewBookName('带/非法\\字符:的*名字'), '带非法字符的名字');
  assert.equal(deriveNewBookName('   \n  '), '未命名新书');
  assert.equal(deriveNewBookName(''), '未命名新书');
  assert.equal(
    deriveNewBookName('这是一个非常非常非常非常非常长的书名超过十六字上限'),
    '这是一个非常非常非常非常非常长的',
  );
});
