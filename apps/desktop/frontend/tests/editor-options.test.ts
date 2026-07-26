import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  editorTypographyOptions,
  isProseFile,
  lineNumbersFor,
  PROSE_MEASURE_COLUMNS,
  PROSE_MEASURE_LABELS,
  PROSE_MEASURE_ORDER,
  resolveEditorFontFamily,
  resolveEditorLineHeight,
  resolveProseWordWrap,
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

test('「书稿」字体轨是衬线比例字体（此前是无衬线黑体，与模式名不符）', () => {
  assert.match(STORYFORGE_EDITOR_FONT_PROSE, /serif$/);
  assert.doesNotMatch(STORYFORGE_EDITOR_FONT_PROSE, /sans-serif/);
  assert.doesNotMatch(STORYFORGE_EDITOR_FONT_PROSE, /monospace/);
  assert.equal(resolveEditorFontFamily('prose'), STORYFORGE_EDITOR_FONT_PROSE);
  assert.equal(resolveEditorFontFamily('grid'), STORYFORGE_EDITOR_FONT_GRID);
});

test('正文判定只认 Markdown，数据文件不走书稿排版', () => {
  assert.equal(isProseFile('D:\\连载\\正文\\第001章.md'), true);
  assert.equal(isProseFile('/project/大纲/总纲.MARKDOWN'), true);
  assert.equal(isProseFile('/project/.storyforge/canon/canon.json'), false);
  assert.equal(isProseFile(null), false);
});

test('行长走 Monaco bounded 换行（不是容器限宽居中）——中文字按 2 半角列换算', () => {
  assert.deepEqual(resolveProseWordWrap('medium', true), {
    wordWrap: 'bounded',
    wordWrapColumn: 84,
  });
  assert.deepEqual(resolveProseWordWrap('narrow', true), {
    wordWrap: 'bounded',
    wordWrapColumn: 64,
  });
  assert.deepEqual(resolveProseWordWrap('wide', true), {
    wordWrap: 'bounded',
    wordWrapColumn: 112,
  });
  // 不限档与数据文件都跟着窗口宽度换行，绝不能回落成不换行（横向滚动条）。
  assert.deepEqual(resolveProseWordWrap('full', true), { wordWrap: 'on' });
  assert.deepEqual(resolveProseWordWrap('medium', false), { wordWrap: 'on' });
});

test('限行宽只改折行点，不把编辑区缩成中间一栏（PR #196 的居中已回退）', () => {
  const prose = editorTypographyOptions({
    filePath: 'D:\\连载\\正文\\第001章.md',
    fontSize: 14,
    fontMode: 'prose',
    proseMeasure: 'narrow',
  });
  assert.equal(prose.wordWrap, 'bounded');
  assert.equal(prose.wordWrapColumn, 64);

  const data = editorTypographyOptions({
    filePath: '/project/.storyforge/canon/canon.json',
    fontSize: 14,
    fontMode: 'prose',
    proseMeasure: 'narrow',
  });
  assert.equal(data.wordWrap, 'on');
});

test('行宽档位顺序覆盖全部档且文案齐备——命令面板循环切换不会漏档或显示 undefined', () => {
  assert.deepEqual([...PROSE_MEASURE_ORDER].sort(), ['full', 'medium', 'narrow', 'wide']);
  assert.equal(new Set(PROSE_MEASURE_ORDER).size, PROSE_MEASURE_ORDER.length);
  for (const measure of PROSE_MEASURE_ORDER) {
    assert.ok(PROSE_MEASURE_LABELS[measure], `${measure} 缺档位文案`);
  }
  // 文案里的字数从列数派生，改列数不会留下对不上的旧数字。
  assert.ok(PROSE_MEASURE_LABELS.medium.includes(String(PROSE_MEASURE_COLUMNS.medium)));
});

test('中文正文行距明显松于数据文件（Monaco 默认 ≈1.35× 对 CJK 太挤）', () => {
  assert.equal(resolveEditorLineHeight(14, true), 27);
  assert.equal(resolveEditorLineHeight(14, false), 21);
  assert.ok(resolveEditorLineHeight(14, true) > Math.round(14 * 1.35));
});

test('正文关掉代码编辑器噪音（折叠/括号/词联想/缩进线/当前行方框），数据文件保留', () => {
  const prose = editorTypographyOptions({
    filePath: 'D:\\连载\\正文\\第001章.md',
    fontSize: 14,
    fontMode: 'prose',
  });
  assert.equal(prose.folding, false);
  assert.equal(prose.matchBrackets, 'never');
  assert.equal(prose.quickSuggestions, false);
  assert.equal(prose.wordBasedSuggestions, 'off');
  assert.equal(prose.guides?.indentation, false);
  assert.equal(prose.renderLineHighlight, 'none');
  assert.equal(prose.padding?.bottom, 160);

  const data = editorTypographyOptions({
    filePath: '/project/.storyforge/canon/canon.json',
    fontSize: 14,
    fontMode: 'prose',
  });
  assert.equal(data.folding, true);
  assert.equal(data.matchBrackets, 'always');
  assert.equal(data.quickSuggestions, true);
  assert.equal(data.guides?.indentation, true);
});

test('字距只加在书稿轨——格子轨靠等宽换 2:1 对齐，加字距等于放弃那个卖点', () => {
  const book = editorTypographyOptions({ filePath: 'a.md', fontSize: 14, fontMode: 'prose' });
  const grid = editorTypographyOptions({ filePath: 'a.md', fontSize: 14, fontMode: 'grid' });
  assert.ok((book.letterSpacing ?? 0) > 0);
  assert.equal(grid.letterSpacing, 0);
  assert.equal(grid.fontFamily, STORYFORGE_EDITOR_FONT_GRID);
});
