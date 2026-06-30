/**
 * 主题应用：把 AppSettings.theme 落到根元素的 data-theme（驱动 index.css 的语义 token），
 * 并同步切换 Monaco 编辑器主题。深色为默认。
 */
import type { ThemeMode } from './user-settings';

export function monacoThemeFor(theme: ThemeMode): 'vs' | 'vs-dark' {
  return theme === 'light' ? 'vs' : 'vs-dark';
}

/** 读取当前根元素主题；供 Monaco 初次创建时取初始主题。 */
export function currentMonacoTheme(): 'vs' | 'vs-dark' {
  if (typeof document === 'undefined') return 'vs-dark';
  return document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark';
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
  // 已打开的 Monaco 实例通过全局 setTheme 跟随；懒加载避免在非编辑场景引入 monaco。
  void import('monaco-editor')
    .then((monaco) => monaco.editor.setTheme(monacoThemeFor(theme)))
    .catch(() => {
      /* monaco 尚未加载时忽略，新建编辑器会用 currentMonacoTheme 取初值 */
    });
}
