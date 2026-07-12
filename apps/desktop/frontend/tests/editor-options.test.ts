import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  STORYFORGE_EDITOR_FONT_GRID,
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
