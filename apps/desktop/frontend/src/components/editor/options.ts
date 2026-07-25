import type * as monaco from 'monaco-editor';

export const STORYFORGE_EDITOR_UNICODE_HIGHLIGHT: monaco.editor.IUnicodeHighlightOptions = {
  ambiguousCharacters: false,
  invisibleCharacters: true,
  nonBasicASCII: false,
};

// Q9「格字对不齐」：Monaco 默认 monospace 栈里 CJK 不是 ASCII 的 2× 宽，中英混排就错位。
// 指定一条 CJK 2:1 等宽栈——装机后内置一款开源等宽 CJK 字体（等距更纱黑体 / 霞鹜文楷等宽，
// 均 OFL 可分发）时中英混排格格对齐；本机未装则回退 Cascadia/Consolas + 系统 CJK（≈现状），
// 末尾始终以 monospace 收口保证等宽兜底。
export const STORYFORGE_EDITOR_FONT_GRID =
  '"Sarasa Mono SC", "等距更纱黑体 SC", "Sarasa Term SC", "Noto Sans Mono CJK SC", ' +
  '"LXGW WenKai Mono", "霞鹜文楷等宽", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace';

// 「书稿」轨：让正文看起来像书而不是代码，故用衬线/楷体比例字体（此前这里是无衬线黑体栈，
// 与「散文模式」的名字不符）。霞鹜文楷（OFL 可分发）优先，退到思源宋体 / 系统宋体，
// 末尾以 serif 收口——本机一款都没装时也不会掉回 UI 黑体。
export const STORYFORGE_EDITOR_FONT_PROSE =
  '"LXGW WenKai", "霞鹜文楷", "Source Han Serif SC", "思源宋体", "Noto Serif SC", ' +
  '"Songti SC", SimSun, Georgia, serif';

export type EditorFontMode = 'grid' | 'prose';

export function resolveEditorFontFamily(mode: EditorFontMode): string {
  return mode === 'prose' ? STORYFORGE_EDITOR_FONT_PROSE : STORYFORGE_EDITOR_FONT_GRID;
}

/** 正文（小说手稿）判定：Markdown 走书稿排版，canon.json 等数据文件保留代码编辑器行为。 */
export function isProseFile(filePath: string | null): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

// 行号只留给数据/代码类文件（canon.json 等）；小说正文（Markdown）行号对作者没有
// 意义，位置感知交给状态栏字数与滚动，观测定位不依赖行号列的显示。
// mode（设置「行号」）可一刀切覆盖：auto = 上述按文件类型判定。
export function lineNumbersFor(filePath: string | null, mode: 'auto' | 'on' | 'off' = 'auto') {
  if (mode !== 'auto') return mode;
  if (!filePath) return 'off';
  return isProseFile(filePath) ? 'off' : 'on';
}

/** 正文行宽档位；'full' = 不限宽，铺满编辑区（旧行为）。 */
export type ProseMeasure = 'narrow' | 'medium' | 'wide' | 'full';

/** 命令面板循环切换的档位顺序（窄 → 适中 → 宽 → 不限）。 */
export const PROSE_MEASURE_ORDER: readonly ProseMeasure[] = ['narrow', 'medium', 'wide', 'full'];

/** 每档目标行长，单位是中文字（CJK 字宽 ≈ 1em，故可直接乘字号估算）。 */
export const PROSE_MEASURE_COLUMNS: Record<Exclude<ProseMeasure, 'full'>, number> = {
  narrow: 32,
  medium: 42,
  wide: 56,
};

/** 档位文案从列数派生，设置弹窗与命令面板共用一份，改列数不必改两处文案。 */
export const PROSE_MEASURE_LABELS: Record<ProseMeasure, string> = {
  narrow: `窄（约 ${PROSE_MEASURE_COLUMNS.narrow} 字）`,
  medium: `适中（约 ${PROSE_MEASURE_COLUMNS.medium} 字）`,
  wide: `宽（约 ${PROSE_MEASURE_COLUMNS.wide} 字）`,
  full: '不限（铺满编辑区）',
};

// glyphMargin（审稿圆点）+ 装饰列 + 细滚动条的固定占位，不该算进「每行几个字」。
const MEASURE_CHROME_PX = 64;

/**
 * 正文容器的最大宽度（px）；null = 不限宽。
 * 不限宽时 1920 屏一行能拉到 1200px+，眼睛回不到行首——这是正文读感的第一杀手。
 */
export function resolveProseMeasurePx(measure: ProseMeasure, fontSize: number): number | null {
  if (measure === 'full') return null;
  return Math.round(PROSE_MEASURE_COLUMNS[measure] * fontSize + MEASURE_CHROME_PX);
}

/** 中文正文行距 1.9×（Monaco 默认 ≈1.35× 对 CJK 太挤）；数据文件保持紧凑。 */
export function resolveEditorLineHeight(fontSize: number, prose: boolean): number {
  return Math.round(fontSize * (prose ? 1.9 : 1.5));
}

/**
 * 按当前文件类型解析全部排版类 options，create 与 updateOptions 共用同一份，
 * 避免「初始化一套、切文件后另一套」的漂移。
 */
export function editorTypographyOptions({
  filePath,
  fontSize,
  fontMode,
  lineNumbers = 'auto',
}: {
  filePath: string | null;
  fontSize: number;
  fontMode: EditorFontMode;
  lineNumbers?: 'auto' | 'on' | 'off';
}): monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions {
  const prose = isProseFile(filePath);
  return {
    fontSize,
    fontFamily: resolveEditorFontFamily(fontMode),
    lineHeight: resolveEditorLineHeight(fontSize, prose),
    // 字距只加在书稿轨：格子轨靠等宽换 2:1 对齐，加字距等于放弃那个卖点。
    letterSpacing: prose && fontMode === 'prose' ? 0.3 : 0,
    lineNumbers: lineNumbersFor(filePath, lineNumbers),
    // 正文顶到容器边、最后一段贴着底缘（scrollBeyondLastLine 已关）都不像稿纸。
    padding: prose ? { top: 28, bottom: 160 } : { top: 8, bottom: 24 },
    // 正文不是代码：折叠、括号配对高亮、词联想、缩进参考线、当前行方框在小说里全是噪音，
    // 而 Monaco 默认全开。数据文件（canon.json）保留这些。
    folding: !prose,
    matchBrackets: prose ? 'never' : 'always',
    bracketPairColorization: { enabled: !prose },
    guides: { indentation: !prose, bracketPairs: !prose },
    quickSuggestions: !prose,
    suggestOnTriggerCharacters: !prose,
    wordBasedSuggestions: prose ? 'off' : 'currentDocument',
    occurrencesHighlight: prose ? 'off' : 'singleFile',
    renderLineHighlight: prose ? 'none' : 'line',
    renderWhitespace: 'none',
    // 长文手感：滚动与光标都不跳格。
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    cursorWidth: 2,
  };
}
