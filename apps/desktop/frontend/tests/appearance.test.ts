import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'vitest';

import {
  ACCENT_CHOICES,
  APPEARANCE_CACHE_KEY,
  DEFAULT_APPEARANCE,
  PALETTE_PRESETS,
  TOKEN_NAMES,
  applyAppearanceToDocument,
  baseContrast,
  contrastRatio,
  derivePalette,
  normalizeHex,
  relativeLuminance,
  resolveThemeMode,
  type AccentChoice,
  type AppearanceSettings,
  type PalettePreset,
  type ThemeMode,
} from '../src/lib/appearance';
import { sanitizeAppSettings } from '../src/lib/user-settings';

const css = readFileSync('src/index.css', 'utf8');

function cssToken(name: string, mode: ThemeMode): string {
  const scope =
    mode === 'dark'
      ? css.match(/:root\s*\{([\s\S]*?)\}/)?.[1]
      : css.match(/:root\[data-theme='light'\]\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(scope, `index.css 找不到 ${mode} 根块`);
  const match = scope.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  assert.ok(match, `index.css 缺 ${mode} --${name}`);
  return match.slice(1).join(' ');
}

const PRESETS = Object.keys(PALETTE_PRESETS) as PalettePreset[];
const ACCENTS = Object.keys(ACCENT_CHOICES) as AccentChoice[];
const MODES = ['dark', 'light'] as const;

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  localStorage.removeItem(APPEARANCE_CACHE_KEY);
});

test('默认外观的派生色板与 index.css 静态值逐值一致（首帧 JS 未跑时不跳色）', () => {
  for (const mode of MODES) {
    const palette = derivePalette(mode, DEFAULT_APPEARANCE);
    for (const name of TOKEN_NAMES) {
      assert.equal(palette[name].join(' '), cssToken(name, mode), `${mode} --${name}`);
    }
  }
});

test('每个主题 × 强调色 × 模式：文字在四种表面上 ≥ 4.5:1，按钮文字与强调色作文字也 ≥ 4.5:1', () => {
  for (const palette of PRESETS) {
    for (const accent of ACCENTS) {
      for (const mode of MODES) {
        const p = derivePalette(mode, { ...DEFAULT_APPEARANCE, palette, accent });
        const where = `${palette}/${accent}/${mode}`;
        for (const surface of ['background', 'panel', 'surface', 'elevated'] as const) {
          for (const text of ['foreground', 'muted', 'subtle'] as const) {
            assert.ok(
              contrastRatio(p[text], p[surface]) >= 4.5,
              `${where} ${text} 在 ${surface} 上`,
            );
          }
        }
        assert.ok(contrastRatio(p['accent-foreground'], p.accent) >= 4.5, `${where} 按钮文字`);
        assert.ok(contrastRatio(p.accent, p.background) >= 4.5, `${where} 强调色作文字`);
      }
    }
  }
});

test('层次台阶：深色面板比画布亮、浅色画布比面板暗，悬停与描边逐级远离底色', () => {
  for (const palette of PRESETS) {
    const dark = derivePalette('dark', { ...DEFAULT_APPEARANCE, palette });
    const light = derivePalette('light', { ...DEFAULT_APPEARANCE, palette });
    const lum = relativeLuminance;
    assert.ok(lum(dark.background) < lum(dark.panel), `${palette} 深色面板应比画布亮`);
    assert.ok(lum(dark.panel) < lum(dark.surface) && lum(dark.surface) < lum(dark.elevated));
    assert.ok(
      lum(dark.elevated) < lum(dark.border) && lum(dark.border) < lum(dark['border-strong']),
    );
    assert.ok(lum(light.background) < lum(light.panel), `${palette} 浅色画布应比面板暗`);
    assert.ok(
      lum(light.elevated) > lum(light.border) && lum(light.border) > lum(light['border-strong']),
    );
  }
});

test('紫色不在强调色里：它专门留给 AI', () => {
  assert.equal(
    Object.keys(ACCENT_CHOICES).some((key) => /purple|violet|iris|agent/.test(key)),
    false,
  );
});

test('自定义颜色只认六位十六进制；对比度不够照样生效，并能报出对比度', () => {
  assert.equal(normalizeHex('#ABCDEF'), '#abcdef');
  assert.equal(normalizeHex(' abcdef '), '#abcdef');
  assert.equal(normalizeHex('#abc'), null);
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex(42), null);

  const settings: AppearanceSettings = {
    ...DEFAULT_APPEARANCE,
    customColors: {
      ...DEFAULT_APPEARANCE.customColors,
      dark: { background: '#000000', foreground: '#333333' },
    },
  };
  assert.ok(baseContrast('dark', settings) < 4.5);
  const palette = derivePalette('dark', settings);
  assert.equal(palette.background.join(' '), '0 0 0');
  // 收到前景也达不到 4.5:1：次级文字贴到前景，不再更暗。
  assert.deepEqual(palette.muted, palette.foreground);
  // 只动了深色那一份，浅色仍是主题底色。
  assert.deepEqual(derivePalette('light', settings), derivePalette('light', DEFAULT_APPEARANCE));
});

test('跟随系统按系统深浅解析；显式选择不受系统影响', () => {
  assert.equal(resolveThemeMode('system', true), 'dark');
  assert.equal(resolveThemeMode('system', false), 'light');
  assert.equal(resolveThemeMode('light', true), 'light');
  assert.equal(resolveThemeMode('dark', false), 'dark');
});

test('写到页面：data-theme、内联 token、字体；缓存两套模式供下次首帧使用', () => {
  const settings: AppearanceSettings = {
    ...DEFAULT_APPEARANCE,
    accent: 'blue',
    uiFont: 'dengxian',
  };
  applyAppearanceToDocument('light', settings);
  const root = document.documentElement;
  assert.equal(root.dataset.theme, 'light');
  assert.equal(
    root.style.getPropertyValue('--accent'),
    derivePalette('light', settings).accent.join(' '),
  );
  assert.match(root.style.getPropertyValue('--font-ui'), /DengXian/);
  const cache = JSON.parse(localStorage.getItem(APPEARANCE_CACHE_KEY) ?? 'null');
  assert.equal(cache.v, 1);
  assert.equal(cache.dark['--background'], derivePalette('dark', settings).background.join(' '));
  assert.equal(cache.light['--accent'], derivePalette('light', settings).accent.join(' '));

  applyAppearanceToDocument('light', { ...settings, uiFont: 'system' });
  assert.equal(root.style.getPropertyValue('--font-ui'), '');
});

test('旧设置读入：缺外观字段补默认，非法值回落，「跟随系统」能存下来', () => {
  const legacy = sanitizeAppSettings({ theme: 'light' });
  assert.equal(legacy.theme, 'light');
  assert.equal(legacy.palette, 'mono');
  assert.equal(legacy.accent, 'mono');
  assert.deepEqual(legacy.customColors, DEFAULT_APPEARANCE.customColors);
  assert.equal(legacy.uiFont, 'system');

  const messy = sanitizeAppSettings({
    theme: 'system',
    palette: 'neon',
    accent: 'purple',
    uiFont: 'comic',
    customColors: { dark: { background: '#ABCDEF', foreground: 'nope' }, light: 'x' },
  });
  assert.equal(messy.theme, 'system');
  assert.equal(messy.palette, 'mono');
  assert.equal(messy.accent, 'mono');
  assert.equal(messy.uiFont, 'system');
  assert.deepEqual(messy.customColors, {
    dark: { background: '#abcdef', foreground: null },
    light: { background: null, foreground: null },
  });
  assert.equal(sanitizeAppSettings({ theme: 'sepia' }).theme, 'dark');
});
