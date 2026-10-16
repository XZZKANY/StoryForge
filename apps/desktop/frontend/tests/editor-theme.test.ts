import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as monaco from 'monaco-editor';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { contrastRatio, hexToRgb } from '../src/lib/appearance';

const themeCalls = vi.hoisted(() => ({
  defineTheme:
    vi.fn<(name: string, data: import('monaco-editor').editor.IStandaloneThemeData) => void>(),
  setTheme: vi.fn<(name: string) => void>(),
}));
vi.mock('monaco-editor', () => ({ editor: themeCalls }));

const css = readFileSync('src/index.css', 'utf8');
function cssHex(name: string, theme: 'dark' | 'light') {
  const scope =
    theme === 'dark'
      ? css.match(/:root\s*\{([\s\S]*?)\}/)?.[1]
      : css.match(/:root\[data-theme='light'\]\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(scope, `Missing ${theme} CSS scope`);
  const rgb = scope.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  assert.ok(rgb, `Missing ${theme} --${name}`);
  return `#${rgb
    .slice(1)
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  delete document.documentElement.dataset.theme;
});

test('Monaco 注册的深色/浅色正文、gutter 与 CSS 画布对齐，浅色行号满足 AA 对比度', async () => {
  const { ensureMonacoThemes } = await import('../src/lib/theme');
  ensureMonacoThemes(monaco);
  assert.deepEqual(
    themeCalls.defineTheme.mock.calls.map(([name]) => name),
    ['storyforge-dark', 'storyforge-light'],
  );
  for (const mode of ['dark', 'light'] as const) {
    const entry = themeCalls.defineTheme.mock.calls.find(([name]) => name === `storyforge-${mode}`);
    assert.ok(entry);
    const [, definition] = entry;
    assert.equal(definition.base, mode === 'dark' ? 'vs-dark' : 'vs');
    assert.equal(definition.inherit, true);
    // Markdown 标题走前景色加粗，不再继承内置主题的语法蓝。
    const heading = definition.rules.find((rule) => rule.token === 'keyword.md');
    assert.equal(heading?.fontStyle, 'bold');
    assert.equal(`#${heading?.foreground}`, cssHex('foreground', mode));
    assert.equal(definition.colors['editor.background'], cssHex('background', mode));
    assert.equal(definition.colors['editor.foreground'], cssHex('foreground', mode));
    // gutter 双主题都钉到画布色，不继承 base 主题默认（浅色 vs 默认白会拼出第三底色）。
    assert.equal(definition.colors['editorGutter.background'], cssHex('background', mode));
    for (const [key, alpha] of [
      ['background', '59'],
      ['hoverBackground', '99'],
      ['activeBackground', 'cc'],
    ]) {
      assert.equal(
        definition.colors[`scrollbarSlider.${key}`],
        `${cssHex('border-strong', mode)}${alpha}`,
      );
    }
    if (mode === 'light') {
      assert.deepEqual(definition.colors, {
        'editor.background': '#f5f5f5',
        'editorGutter.background': '#f5f5f5',
        'editor.foreground': '#1a1a1a',
        // P2-E：浅色行号直接用提示文字色，对画布 ≥ 4.5:1（AA）。
        'editorLineNumber.foreground': '#686868',
        'editorLineNumber.activeForeground': '#5f5f5f',
        'scrollbarSlider.background': '#cfcfcf59',
        'scrollbarSlider.hoverBackground': '#cfcfcf99',
        'scrollbarSlider.activeBackground': '#cfcfcfcc',
      });
      assert.ok(contrastRatio(hexToRgb('#686868'), hexToRgb(cssHex('background', 'light'))) >= 4.5);
    }
  }
  ensureMonacoThemes(monaco);
  assert.equal(
    themeCalls.defineTheme.mock.calls.length,
    2,
    'Theme registration remains idempotent',
  );
});

test('主题往返同步根 token 作用域与 Monaco 全局主题，不重复注册', async () => {
  const { applyTheme, currentMonacoTheme, monacoThemeFor } = await import('../src/lib/theme');
  assert.equal(currentMonacoTheme(), 'storyforge-dark');
  for (const [index, mode] of (['dark', 'light', 'dark'] as const).entries()) {
    applyTheme(mode);
    assert.equal(document.documentElement.dataset.theme, mode);
    assert.equal(currentMonacoTheme(), monacoThemeFor(mode));
    await vi.waitFor(() => {
      assert.equal(themeCalls.setTheme.mock.calls.length, index + 1);
    });
    assert.deepEqual(themeCalls.setTheme.mock.calls[index], [`storyforge-${mode}`]);
  }
  assert.equal(themeCalls.defineTheme.mock.calls.length, 2);
});
