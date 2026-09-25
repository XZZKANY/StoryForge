import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as monaco from 'monaco-editor';
import { afterEach, beforeEach, test, vi } from 'vitest';

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

test('Monaco 注册的深色正文/边槽与 CSS 画布对齐，浅色主题保留原值', async () => {
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
    assert.deepEqual(definition.rules, []);
    assert.equal(definition.colors['editor.background'], cssHex('background', mode));
    assert.equal(definition.colors['editor.foreground'], cssHex('foreground', mode));
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
    if (mode === 'dark') {
      assert.equal(definition.colors['editorGutter.background'], cssHex('background', mode));
    } else {
      assert.deepEqual(definition.colors, {
        'editor.background': '#f7f7f8',
        'editor.foreground': '#1a1a1d',
        'editorLineNumber.foreground': '#8e8e96',
        'editorLineNumber.activeForeground': '#5e5e66',
        'scrollbarSlider.background': '#c9c9d059',
        'scrollbarSlider.hoverBackground': '#c9c9d099',
        'scrollbarSlider.activeBackground': '#c9c9d0cc',
      });
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
