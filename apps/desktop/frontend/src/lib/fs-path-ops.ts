/**
 * 文件树右键操作用的纯路径工具：保持项目内 `\` 与 `/` 分隔符风格，不接触磁盘。
 * 抽成纯函数便于单测（新建 / 改名要在正确的目录里拼路径，混合分隔符易错）。
 */

/** 路径最后一段（文件名 / 目录名）。 */
export function entryName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** 父目录路径；顶层或无分隔符时原样返回。 */
export function parentDir(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return idx <= 0 ? trimmed : trimmed.slice(0, idx);
}

/** 在 dir 下拼子项，沿用 dir 的分隔符风格。 */
export function joinChild(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
}

/** 同目录改名：用 from 的父目录 + 新名。 */
export function siblingPath(from: string, newName: string): string {
  return joinChild(parentDir(from), newName);
}

/**
 * 校验并规整用户输入的单段名字：去空白；空 / `.` / `..` / 含分隔符一律拒绝（不许借改名跳目录）。
 */
export function sanitizeEntryName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name === '.' || name === '..') return null;
  if (/[\\/]/.test(name)) return null;
  return name;
}

/** 给作者看的章节名：去掉 `.md` / `.markdown` 后缀；路径与匹配仍用原文件名。 */
export function displayDocName(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '') || name;
}

/**
 * 新建文件的默认名：同目录已有「第N章」就接着编下一章（位数照最宽的那个补零），
 * 否则给「未命名.md」。
 */
export function suggestNewFileName(siblingNames: readonly string[]): string {
  let next = 0;
  let width = 3;
  for (const name of siblingNames) {
    const match = /^第(\d+)章/.exec(name);
    if (!match) continue;
    next = Math.max(next, Number(match[1]) + 1);
    width = Math.max(width, match[1].length);
  }
  return next > 0 ? `第${String(next).padStart(width, '0')}章.md` : '未命名.md';
}

/** 副本的默认名：「第003章 副本.md」，重名就「副本 2」「副本 3」往下排。 */
export function copyName(name: string, takenNames: readonly string[]): string {
  const taken = new Set(takenNames.map((item) => item.toLowerCase()));
  const match = /^(.*?)(\.(?:md|markdown))?$/i.exec(name);
  const stem = match?.[1] || name;
  const ext = match?.[2] ?? '';
  for (let index = 1; ; index += 1) {
    const candidate = `${stem} 副本${index === 1 ? '' : ` ${index}`}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** 新建 Markdown 文件名：规整后补 `.md` 扩展名（已带则不重复）。 */
export function ensureMarkdownName(raw: string): string | null {
  const name = sanitizeEntryName(raw);
  if (!name) return null;
  return /\.md$/i.test(name) || /\.markdown$/i.test(name) ? name : `${name}.md`;
}
