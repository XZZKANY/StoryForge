import type * as monaco from 'monaco-editor';

export const STORYFORGE_EDITOR_UNICODE_HIGHLIGHT: monaco.editor.IUnicodeHighlightOptions = {
  ambiguousCharacters: false,
  invisibleCharacters: true,
  nonBasicASCII: false,
};

// Q9「格字对不齐」：Monaco 默认 monospace 栈里 CJK 不是 ASCII 的 2× 宽，中英混排就错位。
// 指定一条 CJK 2:1 等宽栈——装机后内置一款开源等宽 CJK 字体（等距更纱黑体 / 霞鹜文楷等宽，
// 均 OFL 可分发）时中英混排格格对齐；本机未装则回退 Cascadia/Consolas + 系统 CJK（≈现状），
// 末尾始终以 monospace 收口保证等宽兜底。散文比例字体（可选双轨）留待后续接字体切换。
export const STORYFORGE_EDITOR_FONT_GRID =
  '"Sarasa Mono SC", "等距更纱黑体 SC", "Sarasa Term SC", "Noto Sans Mono CJK SC", ' +
  '"LXGW WenKai Mono", "霞鹜文楷等宽", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace';

// Q9 双轨「散文」：长文更舒适的比例字体（非等宽），Monaco 支持。格子对齐让位给阅读手感，
// 作者可在状态栏「字体 · 格子/散文」间切换。
export const STORYFORGE_EDITOR_FONT_PROSE =
  '"Microsoft YaHei UI", "PingFang SC", "Source Han Sans SC", "Noto Sans SC", sans-serif';

export type EditorFontMode = 'grid' | 'prose';

export function resolveEditorFontFamily(mode: EditorFontMode): string {
  return mode === 'prose' ? STORYFORGE_EDITOR_FONT_PROSE : STORYFORGE_EDITOR_FONT_GRID;
}

// 行号只留给数据/代码类文件（canon.json 等）；小说正文（Markdown）行号对作者没有
// 意义，位置感知交给状态栏字数与滚动，观测定位不依赖行号列的显示。
// mode（设置「行号」）可一刀切覆盖：auto = 上述按文件类型判定。
export function lineNumbersFor(filePath: string | null, mode: 'auto' | 'on' | 'off' = 'auto') {
  if (mode !== 'auto') return mode;
  if (!filePath) return 'off';
  const lower = filePath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown') ? 'off' : 'on';
}
