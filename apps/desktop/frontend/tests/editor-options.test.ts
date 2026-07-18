import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  lineNumbersFor,
  resolveEditorFontFamily,
  STORYFORGE_EDITOR_FONT_GRID,
  STORYFORGE_EDITOR_FONT_PROSE,
  STORYFORGE_EDITOR_UNICODE_HIGHLIGHT,
} from '../src/components/editor/options';

test('StoryForge editor keeps Chinese punctuation readable without Monaco ambiguous-character boxes', () => {
  assert.equal(STORYFORGE_EDITOR_UNICODE_HIGHLIGHT.ambiguousCharacters, false);
  assert.equal(STORYFORGE_EDITOR_UNICODE_HIGHLIGHT.nonBasicASCII, false);
  assert.equal(STORYFORGE_EDITOR_UNICODE_HIGHLIGHT.invisibleCharacters, true);
});

test('Q9 editor grid font stack leads with a CJK monospace face and falls back to monospace', () => {
  // 领头必须是等宽 CJK 候选（装机内置这类字体才能中英 2:1 对齐），末尾必须以 monospace 兜底。
  assert.match(STORYFORGE_EDITOR_FONT_GRID, /^"Sarasa Mono SC"/);
  assert.match(STORYFORGE_EDITOR_FONT_GRID, /monospace$/);
  // 霞鹜文楷等宽是可分发（OFL）的中文回退候选，别在整理字体栈时被顺手删掉。
  assert.ok(STORYFORGE_EDITOR_FONT_GRID.includes('霞鹜文楷等宽'));
});

test('小说正文（Markdown）不显示行号，数据/代码类文件保留行号', () => {
  assert.equal(lineNumbersFor('D:\\连载\\正文\\第001章.md'), 'off');
  assert.equal(lineNumbersFor('/project/大纲/总纲.MD'), 'off');
  assert.equal(lineNumbersFor('/project/notes.markdown'), 'off');
  assert.equal(lineNumbersFor('/project/.storyforge/canon/canon.json'), 'on');
  assert.equal(lineNumbersFor(null), 'off');
});

test('设置「行号」on/off 一刀切覆盖智能判定', () => {
  assert.equal(lineNumbersFor('D:\\连载\\正文\\第001章.md', 'on'), 'on');
  assert.equal(lineNumbersFor('/project/.storyforge/canon/canon.json', 'off'), 'off');
  assert.equal(lineNumbersFor('D:\\连载\\正文\\第001章.md', 'auto'), 'off');
});

test('Q9 双轨散文字体是比例字体（sans-serif 收口），resolveEditorFontFamily 按模式选栈', () => {
  assert.match(STORYFORGE_EDITOR_FONT_PROSE, /sans-serif$/);
  assert.doesNotMatch(STORYFORGE_EDITOR_FONT_PROSE, /monospace/);
  assert.equal(resolveEditorFontFamily('prose'), STORYFORGE_EDITOR_FONT_PROSE);
  assert.equal(resolveEditorFontFamily('grid'), STORYFORGE_EDITOR_FONT_GRID);
});
