/**
 * 主题应用：把解析后的深 / 浅模式落到根元素的 data-theme，把外观派生出的 token 写成内联 CSS 变量
 * （见 lib/appearance.ts），并同步切换 Monaco 编辑器主题。深色为默认。
 *
 * Monaco 不认 CSS 变量，只认 hex：内置 vs-dark 背景 (#1e1e1e) 与壳子 --background 有色差，
 * 会在编辑区凑出第三种底色，故 storyforge 主题把编辑器背景 / 行号 / 滚动条 thumb 对齐同一份派生色板。
 * Markdown 标题等语法色也改成色板里的前景（加粗）：内置 vs 主题会把 `# 第一章` 染成语法蓝。
 */
import {
  DEFAULT_APPEARANCE,
  applyAppearanceToDocument,
  derivePalette,
  mixRgb,
  rgbToHex,
  type AppearanceSettings,
  type Palette,
  type ThemeMode,
} from './appearance';

type MonacoModule = typeof import('monaco-editor');
type MonacoThemeData = import('monaco-editor').editor.IStandaloneThemeData;

export type StoryforgeMonacoTheme = 'storyforge-dark' | 'storyforge-light';

let currentAppearance: AppearanceSettings = DEFAULT_APPEARANCE;
let definedSignature: string | null = null;

const paletteSignature = ({ palette, accent, customColors }: AppearanceSettings) =>
  JSON.stringify({ palette, accent, customColors });

export function monacoThemeData(mode: ThemeMode, palette: Palette): MonacoThemeData {
  const hex = rgbToHex;
  const bare = (rgb: Palette[keyof Palette]) => rgbToHex(rgb).slice(1);
  // 深色行号再压一档（装饰性信息）；浅色直接用提示文字色，保住 4.5:1。
  const lineNumber =
    mode === 'light' ? palette.subtle : mixRgb(palette.foreground, palette.background, 0.55);
  return {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'keyword.md', foreground: bare(palette.foreground), fontStyle: 'bold' },
      { token: 'comment.md', foreground: bare(palette.muted) },
      { token: 'string.link.md', foreground: bare(palette.muted) },
      { token: 'string.md', foreground: bare(palette.foreground) },
      { token: 'variable.md', foreground: bare(palette.foreground) },
      { token: 'variable.source.md', foreground: bare(palette.foreground) },
      { token: 'strong.md', fontStyle: 'bold' },
      { token: 'emphasis.md', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': hex(palette.background),
      // gutter 显式钉到画布色，不继承 base 主题默认（浅色 vs 默认白会拼出第三底色）。
      'editorGutter.background': hex(palette.background),
      'editor.foreground': hex(palette.foreground),
      'editorLineNumber.foreground': hex(lineNumber),
      'editorLineNumber.activeForeground': hex(palette.muted),
      'scrollbarSlider.background': `${hex(palette['border-strong'])}59`,
      'scrollbarSlider.hoverBackground': `${hex(palette['border-strong'])}99`,
      'scrollbarSlider.activeBackground': `${hex(palette['border-strong'])}cc`,
    },
  };
}

/** 按当前外观注册 storyforge 主题；色板没变就不重复注册。vitest 的 monaco stub 无 defineTheme，静默跳过。 */
export function ensureMonacoThemes(monaco: MonacoModule): void {
  if (typeof monaco.editor?.defineTheme !== 'function') return;
  const signature = paletteSignature(currentAppearance);
  if (signature === definedSignature) return;
  for (const mode of ['dark', 'light'] as const) {
    monaco.editor.defineTheme(
      monacoThemeFor(mode),
      monacoThemeData(mode, derivePalette(mode, currentAppearance)),
    );
  }
  definedSignature = signature;
}

export function monacoThemeFor(theme: ThemeMode): StoryforgeMonacoTheme {
  return theme === 'light' ? 'storyforge-light' : 'storyforge-dark';
}

/** 读取当前根元素主题；供 Monaco 初次创建时取初始主题。 */
export function currentMonacoTheme(): StoryforgeMonacoTheme {
  if (typeof document === 'undefined') return 'storyforge-dark';
  return document.documentElement.dataset.theme === 'light'
    ? 'storyforge-light'
    : 'storyforge-dark';
}

/** 外观设置变了（主题 / 强调色 / 自定义颜色 / 字体 / 模式）：记下来并按解析后的模式整体重刷。 */
export function applyAppearance(settings: AppearanceSettings, mode: ThemeMode): void {
  currentAppearance = settings;
  applyTheme(mode);
}

export function applyTheme(theme: ThemeMode): void {
  applyAppearanceToDocument(theme, currentAppearance);
  // 已打开的 Monaco 实例通过全局 setTheme 跟随；懒加载避免在非编辑场景引入 monaco。
  void import('monaco-editor')
    .then((monaco) => {
      ensureMonacoThemes(monaco);
      monaco.editor.setTheme(monacoThemeFor(theme));
    })
    .catch(() => {
      /* monaco 尚未加载时忽略，新建编辑器会用 currentMonacoTheme 取初值 */
    });
}
