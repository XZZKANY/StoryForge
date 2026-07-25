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

/** 新建 Markdown 文件名：规整后补 `.md` 扩展名（已带则不重复）。 */
export function ensureMarkdownName(raw: string): string | null {
  const name = sanitizeEntryName(raw);
  if (!name) return null;
  return /\.md$/i.test(name) || /\.markdown$/i.test(name) ? name : `${name}.md`;
}
