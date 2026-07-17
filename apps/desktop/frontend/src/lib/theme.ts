/**
 * 主题应用：把 AppSettings.theme 落到根元素的 data-theme（驱动 index.css 的语义 token），
 * 并同步切换 Monaco 编辑器主题。深色为默认。
 *
 * Monaco 不认 CSS 变量，只认 hex：内置 vs-dark 背景 (#1e1e1e) 与壳子 --background
 * (#1c1c1f) 有色差，会在编辑区凑出第三种底色，故自定义 storyforge 主题把编辑器
 * 背景 / 行号 / 滚动条 thumb 对齐 token。改 index.css 的 token 色值时必须同步这里。
 */
import type { ThemeMode } from './user-settings';

type MonacoModule = typeof import('monaco-editor');

export type StoryforgeMonacoTheme = 'storyforge-dark' | 'storyforge-light';

const STORYFORGE_MONACO_THEMES: Array<{
  name: StoryforgeMonacoTheme;
  base: 'vs' | 'vs-dark';
  colors: Record<string, string>;
}> = [
  {
    name: 'storyforge-dark',
    base: 'vs-dark',
    colors: {
      'editor.background': '#1c1c1f', // --background
      'editor.foreground': '#ededed', // --foreground
      'editorLineNumber.foreground': '#7c7c85', // --subtle
      'editorLineNumber.activeForeground': '#a1a1aa', // --muted
      'scrollbarSlider.background': '#4c4c5459', // --border-strong @35%
      'scrollbarSlider.hoverBackground': '#4c4c5499',
      'scrollbarSlider.activeBackground': '#4c4c54cc',
    },
  },
  {
    name: 'storyforge-light',
    base: 'vs',
    colors: {
      'editor.background': '#f7f7f8', // --background
      'editor.foreground': '#1a1a1d', // --foreground
      'editorLineNumber.foreground': '#8e8e96', // --subtle
      'editorLineNumber.activeForeground': '#5e5e66', // --muted
      'scrollbarSlider.background': '#c9c9d059', // --border-strong @35%
      'scrollbarSlider.hoverBackground': '#c9c9d099',
      'scrollbarSlider.activeBackground': '#c9c9d0cc',
    },
  },
];

let themesDefined = false;

/** 幂等注册 storyforge 主题；vitest 的 monaco stub 无 defineTheme，静默跳过。 */
export function ensureMonacoThemes(monaco: MonacoModule): void {
  if (themesDefined) return;
  if (typeof monaco.editor?.defineTheme !== 'function') return;
  for (const theme of STORYFORGE_MONACO_THEMES) {
    monaco.editor.defineTheme(theme.name, {
      base: theme.base,
      inherit: true,
      rules: [],
      colors: theme.colors,
    });
  }
  themesDefined = true;
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

export function applyTheme(theme: ThemeMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
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
