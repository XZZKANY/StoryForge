/**
 * 纯路径工具：保持项目内 `\` 与 `/` 分隔符风格，不接触磁盘。
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

/**
 * 在 base 下拼路径，只做字符串拼接：分隔符跟着 base 走，base 里有 `\` 就用 `\`，否则用 `/`
 * （作者机上作品路径是反斜杠）。base 只去掉末尾的分隔符、中间不改写；后面各段按 `\` `/` 拆开、
 * 丢掉空段，再用这一种分隔符接上。
 * 不查项目边界——要围栏用 project-core 的 joinProjectPath。
 */
export function joinPath(base: string, ...parts: string[]): string {
  const separator = base.includes('\\') ? '\\' : '/';
  const segments = parts.flatMap((part) => part.split(/[\\/]+/)).filter(Boolean);
  return [base.replace(/[\\/]+$/, ''), ...segments].join(separator);
}

/**
 * 作品里的路径换成作品根那一种分隔符（文件树节点、宿主列出的条目、joinPath 拼出来的都是这种写法）；
 * 根照 projectPath 原样，只换分隔符、不改大小写；作品外的路径原样返回。
 * 早先文件树给文件夹拼路径一律用 `/`，反斜杠作品下存过 `D:\书/正文\第001章.md` 这种混合写法，
 * 从存档里读出路径时过一遍这里。
 */
export function withProjectSeparator(projectPath: string, path: string): string {
  const root = projectPath.replace(/[\\/]+$/, '');
  const slashed = (value: string) => value.replace(/\\/g, '/');
  const rest = path.slice(root.length);
  if (slashed(path.slice(0, root.length)) !== slashed(root) || /^[^\\/]/.test(rest)) return path;
  return joinPath(projectPath, rest);
}

/** 同目录改名：用 from 的父目录 + 新名。 */
export function siblingPath(from: string, newName: string): string {
  return joinPath(parentDir(from), newName);
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
