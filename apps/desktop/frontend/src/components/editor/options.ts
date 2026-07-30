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

/** 正文行宽档位；'full' = 不限，跟着窗口宽度换行。 */
export type ProseMeasure = 'narrow' | 'medium' | 'wide' | 'full';

/** 命令面板循环切换的档位顺序（窄 → 适中 → 宽 → 不限）。 */
export const PROSE_MEASURE_ORDER: readonly ProseMeasure[] = ['narrow', 'medium', 'wide', 'full'];

/** 每档目标行长，单位是中文字。 */
export const PROSE_MEASURE_COLUMNS: Record<Exclude<ProseMeasure, 'full'>, number> = {
  narrow: 32,
  medium: 42,
  wide: 56,
};

/** 档位文案从列数派生，设置弹窗与命令面板共用一份，改列数不必改两处文案。 */
export const PROSE_MEASURE_LABELS: Record<ProseMeasure, string> = {
  narrow: `窄（约 ${PROSE_MEASURE_COLUMNS.narrow} 字换行）`,
  medium: `适中（约 ${PROSE_MEASURE_COLUMNS.medium} 字换行）`,
  wide: `宽（约 ${PROSE_MEASURE_COLUMNS.wide} 字换行）`,
  full: '不限（跟着窗口宽度换行）',
};

// Monaco 的 wordWrapColumn 按半角列计，一个中文字占 2 列。
const HALFWIDTH_COLUMNS_PER_CJK = 2;

/**
 * 行长控制走 Monaco 自身的 bounded 换行，而不是把编辑器容器限宽居中。
 * 限宽居中试过一版（PR #196）：文字缩成屏幕中间一栏，两侧是点不动的死区、
 * 滚动条浮在屏幕中间，写起来很别扭。bounded 让编辑区照旧铺满（背景连续、
 * 哪儿都能点、滚动条贴窗口右缘），只把折行点提前到目标字数。
 */
export function resolveProseWordWrap(
  measure: ProseMeasure,
  prose: boolean,
): Pick<monaco.editor.IEditorOptions, 'wordWrap' | 'wordWrapColumn'> {
  if (!prose || measure === 'full') return { wordWrap: 'on' };
  return {
    wordWrap: 'bounded',
    wordWrapColumn: PROSE_MEASURE_COLUMNS[measure] * HALFWIDTH_COLUMNS_PER_CJK,
  };
}

/** 中文正文行距 1.9×（Monaco 默认 ≈1.35× 对 CJK 太挤）；数据文件保持紧凑。 */
export function resolveEditorLineHeight(fontSize: number, prose: boolean): number {
  return Math.round(fontSize * (prose ? 1.9 : 1.5));
}

/**
 * 只读 diff / 预览类视图里的正文排版。同一段稿子在编辑器里是 1.9× 行距 + 书稿字距，
 * 在补丁面板里却吃 Monaco 默认的 ≈1.35× 且无字距——逐字核对时两种呼吸节奏对不上。
 * 这里让两处共用同一份推导，字体栈由调用方传入（已由 resolveEditorFontFamily 解析过）。
 */
export function proseReadingTypography(
  fontSize: number,
  fontFamily: string,
): Pick<monaco.editor.IEditorOptions, 'fontSize' | 'fontFamily' | 'lineHeight' | 'letterSpacing'> {
  return {
    fontSize,
    fontFamily,
    lineHeight: resolveEditorLineHeight(fontSize, true),
    letterSpacing: fontFamily === STORYFORGE_EDITOR_FONT_PROSE ? 0.3 : 0,
  };
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
  proseMeasure = 'medium',
}: {
  filePath: string | null;
  fontSize: number;
  fontMode: EditorFontMode;
  lineNumbers?: 'auto' | 'on' | 'off';
  proseMeasure?: ProseMeasure;
}): monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions {
  const prose = isProseFile(filePath);
  return {
    ...resolveProseWordWrap(proseMeasure, prose),
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
