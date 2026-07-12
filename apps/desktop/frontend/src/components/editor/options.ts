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
