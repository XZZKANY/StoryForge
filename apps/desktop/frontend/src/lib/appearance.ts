/**
 * 外观：模式 × 主题 × 强调色 × 自定义背景 / 前景 × 界面字体 → 一组与 index.css 同名的语义 token。
 *
 * 层次全部由「背景 + 前景」按比例混出。深色以背景为最深的画布，面板、卡片、悬停、描边依次向前景靠；
 * 浅色以背景为最亮的面板与卡片，画布、悬停、描边依次向前景压暗——与 index.css 一直以来的台阶方向一致。
 * 次级 / 提示文字派生后若对任一常用表面不足 4.5:1，就继续向前景收紧，直到达标或贴到前景。
 *
 * 默认组合（黑白、单色强调、无自定义）的派生结果必须与 index.css 的静态值逐字一致（tests/appearance.test.ts）：
 * 首帧 JS 未跑时用的是 CSS，跑起来后不跳色。
 */

export type Rgb = readonly [number, number, number];
export type ThemeMode = 'dark' | 'light';
export type ThemePreference = 'system' | ThemeMode;
export type PalettePreset = 'mono' | 'warm';
export type AccentChoice = 'mono' | 'blue' | 'green' | 'orange' | 'rose';
export type UiFont = 'system' | 'yahei' | 'dengxian';
export type ColorOverride = { background: string | null; foreground: string | null };
export type CustomColors = Record<ThemeMode, ColorOverride>;

export type AppearanceSettings = {
  theme: ThemePreference;
  palette: PalettePreset;
  accent: AccentChoice;
  customColors: CustomColors;
  uiFont: UiFont;
};

export const TOKEN_NAMES = [
  'background',
  'panel',
  'surface',
  'elevated',
  'border',
  'border-strong',
  'foreground',
  'muted',
  'subtle',
  'accent',
  'accent-foreground',
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];
export type Palette = Record<TokenName, Rgb>;

export const PALETTE_PRESETS: Record<
  PalettePreset,
  {
    label: string;
    description: string;
    base: Record<ThemeMode, { background: string; foreground: string }>;
  }
> = {
  mono: {
    label: '黑白',
    description: '纯中性的黑与白，层次只靠明暗台阶。',
    base: {
      dark: { background: '#101010', foreground: '#ececec' },
      light: { background: '#ffffff', foreground: '#1a1a1a' },
    },
  },
  warm: {
    label: '暖色',
    description: '暖墨与纸感：底色偏暖，适合长时间读写。',
    base: {
      dark: { background: '#151413', foreground: '#ebe6dc' },
      light: { background: '#faf8f2', foreground: '#2a2622' },
    },
  },
};

// 紫色不在其中：它专门留给 AI（--agent），强调色若也能选紫，作者就分不清哪个是 AI 了。
export const ACCENT_CHOICES: Record<
  AccentChoice,
  { label: string; dark: string | null; light: string | null }
> = {
  mono: { label: '单色', dark: null, light: null },
  blue: { label: '蓝', dark: '#6aa7ff', light: '#2563eb' },
  green: { label: '绿', dark: '#4cc38a', light: '#15803d' },
  orange: { label: '橙', dark: '#f59e4c', light: '#c2410c' },
  rose: { label: '玫红', dark: '#f47ba6', light: '#be185d' },
};

export const UI_FONTS: Record<UiFont, { label: string; stack: string | null }> = {
  system: { label: '系统默认', stack: null },
  yahei: {
    label: '微软雅黑',
    stack: "'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', sans-serif",
  },
  dengxian: { label: '等线', stack: "DengXian, 'Microsoft YaHei UI', 'PingFang SC', sans-serif" },
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'dark',
  palette: 'mono',
  accent: 'mono',
  customColors: {
    dark: { background: null, foreground: null },
    light: { background: null, foreground: null },
  },
  uiFont: 'system',
};

type LayerName = 'background' | 'panel' | 'surface' | 'elevated' | 'border' | 'border-strong';

// 每层离背景多远（0 = 背景本身，1 = 前景）。
const LAYER_RATIOS: Record<ThemeMode, Record<LayerName, number>> = {
  dark: {
    background: 0,
    panel: 0.05,
    surface: 0.09,
    elevated: 0.13,
    border: 0.18,
    'border-strong': 0.27,
  },
  light: {
    background: 0.045,
    panel: 0,
    surface: 0,
    elevated: 0.07,
    border: 0.11,
    'border-strong': 0.21,
  },
};
// 次级 / 提示文字离前景多远。
const TEXT_RATIOS: Record<ThemeMode, { muted: number; subtle: number }> = {
  dark: { muted: 0.3, subtle: 0.36 },
  light: { muted: 0.3, subtle: 0.34 },
};
const TEXT_SURFACES = ['background', 'panel', 'surface', 'elevated'] as const;
export const MIN_TEXT_CONTRAST = 4.5;

const HEX_RE = /^#?([0-9a-f]{6})$/i;

export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = HEX_RE.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex);
  if (!normalized) throw new RangeError(`不是六位十六进制颜色：${hex}`);
  const n = Number.parseInt(normalized.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function mixRgb(from: Rgb, to: Rgb, ratio: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * ratio)) as unknown as Rgb;
}

/** WCAG 相对亮度。 */
export function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 本模式实际用的背景 / 前景：作者自定义优先，否则取主题底色。 */
export function baseColors(mode: ThemeMode, settings: AppearanceSettings) {
  const preset = PALETTE_PRESETS[settings.palette].base[mode];
  const custom = settings.customColors[mode];
  return {
    background: normalizeHex(custom.background) ?? preset.background,
    foreground: normalizeHex(custom.foreground) ?? preset.foreground,
  };
}

function textToken(fg: Rgb, bg: Rgb, ratio: number, surfaces: Rgb[]): Rgb {
  // 不达标就往前景收，最多收到前景本身（那时若仍不达标，是背景 / 前景本身对比度不够，界面会提示）。
  for (let r = ratio; r > 0; r = Math.round((r - 0.02) * 100) / 100) {
    const candidate = mixRgb(fg, bg, r);
    if (surfaces.every((surface) => contrastRatio(candidate, surface) >= MIN_TEXT_CONTRAST)) {
      return candidate;
    }
  }
  return fg;
}

// 强调色也会被当文字用（链接、选中项），底色偏深或作者自定义了背景时，往前景方向逐步加深 / 提亮到 4.5:1。
function readableAccent(accent: Rgb, background: Rgb, toward: Rgb): Rgb {
  let current = accent;
  for (let i = 0; i < 12 && contrastRatio(current, background) < MIN_TEXT_CONTRAST; i += 1) {
    current = mixRgb(current, toward, 0.08);
  }
  return current;
}

function pickReadableOn(color: Rgb, candidates: Rgb[]): Rgb {
  return candidates.reduce((best, c) =>
    contrastRatio(c, color) > contrastRatio(best, color) ? c : best,
  );
}

export function derivePalette(mode: ThemeMode, settings: AppearanceSettings): Palette {
  const base = baseColors(mode, settings);
  const bg = hexToRgb(base.background);
  const fg = hexToRgb(base.foreground);
  const ratios = LAYER_RATIOS[mode];
  const layers = Object.fromEntries(
    (Object.keys(ratios) as LayerName[]).map((name) => [name, mixRgb(bg, fg, ratios[name])]),
  ) as Record<LayerName, Rgb>;
  const surfaces = TEXT_SURFACES.map((name) => layers[name]);
  const accentHex = ACCENT_CHOICES[settings.accent][mode];
  const accent = accentHex ? readableAccent(hexToRgb(accentHex), layers.background, fg) : fg;
  const accentForeground = accentHex
    ? pickReadableOn(accent, [hexToRgb('#ffffff'), hexToRgb('#111111')])
    : mode === 'dark'
      ? layers.background
      : layers.panel;
  return {
    ...layers,
    foreground: fg,
    muted: textToken(fg, bg, TEXT_RATIOS[mode].muted, surfaces),
    subtle: textToken(fg, bg, TEXT_RATIOS[mode].subtle, surfaces),
    accent,
    'accent-foreground': accentForeground,
  };
}

/** 背景与前景本身的对比度；低于 4.5:1 时界面提示作者，但照样生效（选择权在作者）。 */
export function baseContrast(mode: ThemeMode, settings: AppearanceSettings): number {
  const base = baseColors(mode, settings);
  return contrastRatio(hexToRgb(base.background), hexToRgb(base.foreground));
}

export function resolveThemeMode(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ThemeMode {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function paletteCssVars(palette: Palette): Record<string, string> {
  return Object.fromEntries(TOKEN_NAMES.map((name) => [`--${name}`, palette[name].join(' ')]));
}

/** 首帧防闪色用：index.html 的内联脚本在 React 挂载前按这份缓存写 CSS 变量。键与结构须与 index.html 同步。 */
export const APPEARANCE_CACHE_KEY = 'storyforge-appearance-cache';

export function appearanceCache(settings: AppearanceSettings) {
  return {
    v: 1,
    dark: paletteCssVars(derivePalette('dark', settings)),
    light: paletteCssVars(derivePalette('light', settings)),
    font: UI_FONTS[settings.uiFont].stack,
  };
}

/** 把本模式的 token 写到 <html> 上（内联变量盖过 index.css 的两套静态值），并更新首帧缓存。 */
export function applyAppearanceToDocument(mode: ThemeMode, settings: AppearanceSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = mode;
  for (const [name, value] of Object.entries(paletteCssVars(derivePalette(mode, settings)))) {
    root.style.setProperty(name, value);
  }
  const font = UI_FONTS[settings.uiFont].stack;
  if (font) root.style.setProperty('--font-ui', font);
  else root.style.removeProperty('--font-ui');
  try {
    localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(appearanceCache(settings)));
  } catch {
    // 存储被拒时只是下次启动可能闪一帧，不影响本次
  }
}
