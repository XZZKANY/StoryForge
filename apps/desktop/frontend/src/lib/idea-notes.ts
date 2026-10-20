/**
 * 灵感速记：项目根 `灵感.md` 的 markdown 列表行。
 *
 * 刻意不另起一份私有存储。写着写着冒出来的点子和待补的坑，作者会想在别处（编辑器里、
 * 手机上、git diff 里）看见它们；Agent 的 `fs.read` 也读得到同一份文件。所以载体就是
 * 一份普通 markdown——左栏只是它的一个快捷入口，不是它的唯一入口。
 *
 * 三种列表写法都算条目：`- 文本`（速记默认，最轻）、`- [ ] 文本`、`- [x] 文本`。
 * 作者手写的普通列表因此天然被识别，不必先学一套语法。非列表行原样保留。
 */

export type IdeaNote = {
  /** 在文件中的 0 基行号，回写时按行定位。 */
  line: number;
  text: string;
  done: boolean;
};

const ITEM_PATTERN = /^(\s*)-\s+(?:\[( |x|X)\]\s+)?(.*)$/;

export function parseIdeaNotes(content: string): IdeaNote[] {
  const notes: IdeaNote[] = [];
  const lines = content.split('\n');
  for (let line = 0; line < lines.length; line += 1) {
    const match = lines[line].match(ITEM_PATTERN);
    if (!match) continue;
    const text = match[3].trim();
    if (!text) continue;
    notes.push({ line, text, done: match[2]?.toLowerCase() === 'x' });
  }
  return notes;
}

/**
 * 按条目本身（文字 + 勾选状态）在当前内容里找回它的行：排队写入时，前一次改动可能已让行号挪了位。
 * 原行号上还是它就用原行号；否则只认唯一一处同样的条目，找不到或不止一处返回 null。
 */
export function locateIdeaNote(content: string, note: IdeaNote): number | null {
  const notes = parseIdeaNotes(content);
  const same = notes.filter((item) => item.text === note.text && item.done === note.done);
  if (same.some((item) => item.line === note.line)) return note.line;
  return same.length === 1 ? same[0].line : null;
}

/** 追加一条：落在文件末尾，保证与既有内容之间恰好一个换行，不堆空行。 */
export function appendIdeaNote(content: string, text: string): string {
  const note = text.trim();
  if (!note) return content;
  const body = content.replace(/\s+$/, '');
  if (!body) return `# 灵感\n\n- ${note}\n`;
  return `${body}\n- ${note}\n`;
}

/**
 * 勾选 / 取消：只改那一行的复选框，正文与缩进原样保留。
 * 行号对不上（文件被外部改过）就原样返回，宁可这次点击没生效，也不能改错行。
 */
export function toggleIdeaNote(content: string, line: number, done: boolean): string {
  const lines = content.split('\n');
  if (line < 0 || line >= lines.length) return content;
  const match = lines[line].match(ITEM_PATTERN);
  if (!match) return content;
  const [, indent, , text] = match;
  lines[line] = `${indent}- [${done ? 'x' : ' '}] ${text.trim()}`;
  return lines.join('\n');
}

/** 删除一条：整行移除，其余行不动。 */
export function removeIdeaNote(content: string, line: number): string {
  const lines = content.split('\n');
  if (line < 0 || line >= lines.length) return content;
  if (!ITEM_PATTERN.test(lines[line])) return content;
  lines.splice(line, 1);
  return lines.join('\n');
}

/** 改一条的文字：缩进与勾选状态照旧；行号对不上或新文字为空就原样返回。 */
export function editIdeaNote(content: string, line: number, text: string): string {
  const next = text.trim();
  const lines = content.split('\n');
  if (!next || line < 0 || line >= lines.length) return content;
  const match = lines[line].match(ITEM_PATTERN);
  if (!match) return content;
  const [, indent, mark] = match;
  lines[line] = mark === undefined ? `${indent}- ${next}` : `${indent}- [${mark}] ${next}`;
  return lines.join('\n');
}

/** 撤销删除：把删掉的那一行原样放回原来的位置。 */
export function restoreIdeaNoteLine(content: string, line: number, raw: string): string {
  const lines = content.split('\n');
  lines.splice(Math.min(Math.max(line, 0), lines.length), 0, raw);
  return lines.join('\n');
}

export function ideaNotesPath(projectPath: string): string {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath.replace(/[\\/]+$/, '')}${separator}灵感.md`;
}
