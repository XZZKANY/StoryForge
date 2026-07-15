import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

// 壳子头部行高单一事实源指纹护栏：三栏头部行（左栏顶行 / 中栏页签行 / 右栏对话头）
// 必须引用 tailwind.config.js 的 shell-row token，谁把行高改回写死的 h-9/h-10 这里就红。
// 背景：中栏 36px vs 左右栏 40px 的 4px 断层反复出现（2026-07-15 真机截图）。

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const HEADER_ELEMENTS = [
  { file: '../src/components/shell/SidePanel.tsx', testid: 'side-panel-header' },
  { file: '../src/components/shell/EditorTabs.tsx', testid: 'editor-tabs' },
  { file: '../src/components/chat-window/panels.tsx', testid: 'conversation-header' },
];

function openingTag(source: string, testid: string): string {
  const match = source.match(
    new RegExp(`<(?:div|header|section)[^>]*data-testid="${testid}"[^>]*>`),
  );
  assert.ok(match, `找不到 data-testid="${testid}" 的元素`);
  return match[0];
}

test('tailwind 的 shell-row token 只定义一次', () => {
  const config = read('../tailwind.config.js');
  assert.equal((config.match(/'shell-row'/g) ?? []).length, 1);
});

for (const { file, testid } of HEADER_ELEMENTS) {
  test(`${testid} 行高引用 h-shell-row，不写死 h-9/h-10`, () => {
    const tag = openingTag(read(file), testid);
    assert.match(tag, /\bh-shell-row\b/);
    assert.doesNotMatch(tag, /\bh-(?:9|10)\b/);
  });
}
