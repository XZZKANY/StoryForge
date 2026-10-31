import { codePoints, pythonStrip } from '../kernel/pythonText';

/**
 * 作者当前视图：把「作者此刻正看着哪一段」解码成可注入循环的文本块。
 * 纯函数、无 IO：窗口内容取自前端已发的 content，不额外读盘。
 */

// 选区注入上限：作者整章全选时不把整章当「这一段」灌进每一轮。
export const SELECTION_MAX_CHARS = 4_000;
// 无选区时光标前后各取的字数。前多后少：续写与改稿都更依赖上文语感。
export const CURSOR_BEFORE_CHARS = 1_500;
export const CURSOR_AFTER_CHARS = 600;
// @ 钉上下文摘录上限（bundle 已在前端逐文件截断，这里只兜总量）。
export const PINNED_CONTEXT_MAX_CHARS = 6_000;

type Obj = { readonly [key: string]: unknown };

export type AuthorView = {
  readonly file_path: string | null;
  readonly cursor_line: number;
  readonly cursor_column: number;
  readonly selection_text: string;
  readonly content: string;
};

const cpSlice = (text: string, start: number, end?: number) =>
  codePoints(text).slice(start, end).join('');
const text = (value: unknown): string | null =>
  typeof value === 'string' && pythonStrip(value) ? pythonStrip(value) : null;
const nonNegativeInt = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
const stripNewlines = (value: string) => value.replace(/^\n+|\n+$/g, '');

export function authorViewFromPayload(args: Obj): AuthorView {
  const raw = args.author_view;
  const view: Obj =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Obj) : {};
  const selection = view.selection_text;
  return {
    file_path: text(view.file_path) ?? text(args.file_path),
    cursor_line: nonNegativeInt(view.cursor_line),
    cursor_column: nonNegativeInt(view.cursor_column),
    selection_text: typeof selection === 'string' ? cpSlice(selection, 0, SELECTION_MAX_CHARS) : '',
    content: typeof args.content === 'string' ? args.content : '',
  };
}

export const authorViewHasView = (view: AuthorView): boolean =>
  Boolean(pythonStrip(view.selection_text) || (pythonStrip(view.content) && view.cursor_line > 0));

/** 码点下标版的 str.find / str.rfind（只用于 ASCII 子串）。 */
function cpFind(haystack: string, needle: string, fromEnd = false): number {
  const index = fromEnd ? haystack.lastIndexOf(needle) : haystack.indexOf(needle);
  return index < 0 ? -1 : codePoints(haystack.slice(0, index)).length;
}

/**
 * 取光标行前后两段窗口，返回 [上文, 下文]。cursor_line 从 1 开始且含在上文里；
 * 越界一律夹到合法区间，宁可少取一行也不要抛错打断作者。
 */
export function cursorWindow(
  content: string,
  cursorLine: number,
  beforeChars = CURSOR_BEFORE_CHARS,
  afterChars = CURSOR_AFTER_CHARS,
): [string, string] {
  if (!content) return ['', ''];
  const lines = content.split('\n');
  const end = Math.max(0, Math.min(cursorLine, lines.length));
  let head = lines.slice(0, end).join('\n');
  let tail = lines.slice(end).join('\n');
  if (codePoints(head).length > beforeChars) {
    head = cpSlice(head, -beforeChars);
    // 从段落边界起头，避免上文以半句开始误导模型对语感的判断。
    const boundary = cpFind(head, '\n\n');
    if (boundary !== -1 && boundary < Math.floor(beforeChars / 2))
      head = cpSlice(head, boundary + 2);
  }
  if (codePoints(tail).length > afterChars) {
    tail = cpSlice(tail, 0, afterChars);
    const boundary = cpFind(tail, '\n\n', true);
    if (boundary !== -1 && boundary > Math.floor(afterChars / 2)) tail = cpSlice(tail, 0, boundary);
  }
  return [stripNewlines(head), stripNewlines(tail)];
}

/** 把作者视图拼成一段 system 文本。选区优先——作者主动选中即最强的指代信号。 */
export function buildAuthorViewBlock(view: AuthorView): string | null {
  if (!authorViewHasView(view)) return null;
  const location = view.file_path ? `作者正在编辑：${view.file_path}` : '作者正在编辑当前文件';
  if (pythonStrip(view.selection_text))
    return (
      `${location}\n作者当前**选中**了下面这段（作者说「这一段」「这几句」时指的就是它）：\n` +
      `<<<SELECTION\n${pythonStrip(view.selection_text)}\nSELECTION>>>`
    );
  const [head, tail] = cursorWindow(view.content, view.cursor_line);
  if (!head && !tail) return null;
  const blocks = [
    `${location}，光标停在第 ${view.cursor_line} 行。作者说「这里」「刚写的」时指的是光标附近。`,
  ];
  if (head) blocks.push('光标之前（含光标行）：\n<<<BEFORE_CURSOR\n' + head + '\nBEFORE_CURSOR>>>');
  if (tail) blocks.push('光标之后：\n<<<AFTER_CURSOR\n' + tail + '\nAFTER_CURSOR>>>');
  blocks.push('这是节选窗口，不是全文；需要更多正文用 fs_read。');
  return blocks.join('\n\n');
}

/** 作者 @ 钉的文件摘录。 */
export function buildPinnedContextBlock(contextBlock: string | null | undefined): string | null {
  if (!contextBlock || !pythonStrip(contextBlock)) return null;
  const excerpt = cpSlice(pythonStrip(contextBlock), 0, PINNED_CONTEXT_MAX_CHARS);
  return '作者为这轮对话指定了以下上下文文件摘录：\n\n' + excerpt;
}

/** 落事件表的摘要：只记形状与量，正文不进事件表。 */
export const authorViewSummary = (view: AuthorView) => ({
  file_path: view.file_path,
  cursor_line: view.cursor_line,
  selection_chars: codePoints(view.selection_text).length,
  content_chars: codePoints(view.content).length,
});
