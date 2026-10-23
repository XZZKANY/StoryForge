export function normalizeRoot(path: string): string {
  return path.replace(/[/\\]+$/, '');
}

/** Python's path order compares Unicode code points, not locale or UTF-16 units. */
export function compareChapterPaths(a: string, b: string): number {
  let left = 0;
  let right = 0;
  while (left < a.length && right < b.length) {
    const aPoint = a.codePointAt(left)!;
    const bPoint = b.codePointAt(right)!;
    if (aPoint !== bPoint) return aPoint - bPoint;
    left += aPoint > 0xffff ? 2 : 1;
    right += bPoint > 0xffff ? 2 : 1;
  }
  return (left < a.length ? 1 : 0) - (right < b.length ? 1 : 0);
}

function compareManuscriptComponent(a: string, b: string): number {
  const tokens = (path: string) =>
    (path.match(/\p{Nd}+|[^\p{Nd}]/gu) ?? []).map((part) => {
      if (!/^\p{Nd}/u.test(part)) return { text: part, numeric: false };
      // Nd 的连续区间由完整的 0–9 组组成；不转 Number，避免长章号丢精度。
      let digits = '';
      for (const char of part) {
        const point = char.codePointAt(0)!;
        let zero = point;
        while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
        digits += String((point - zero) % 10);
      }
      return { text: digits.replace(/^0+(?=\d)/, ''), numeric: true };
    });
  const left = tokens(a);
  const right = tokens(b);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const x = left[index];
    const y = right[index];
    const order =
      x.numeric && y.numeric
        ? x.text.length - y.text.length || compareChapterPaths(x.text, y.text)
        : compareChapterPaths(x.numeric ? '0' : x.text, y.numeric ? '0' : y.text);
    if (order) return order;
  }
  return left.length - right.length || compareChapterPaths(a, b);
}

/** 数字段按值、其余按码点；目录内先打破同号平局，避免卷1和卷01的章互相穿插。 */
export function compareManuscriptPaths(a: string, b: string): number {
  // 保留分隔符参与比较，使无数字的 A.md / A/正文.md 沿用原码点序。
  const parts = (path: string) => path.replace(/\\/g, '/').match(/[^/]*\/|[^/]+$/g) ?? [];
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = compareManuscriptComponent(left[index], right[index]);
    if (order) return order;
  }
  return left.length - right.length || compareChapterPaths(a, b);
}

function projectSeparator(path: string): '\\' | '/' {
  return path.includes('\\') ? '\\' : '/';
}

type ParsedPath = {
  absolute: boolean;
  root: string;
  segments: string[];
  escaped: boolean;
};

function parsePath(rawPath: string): ParsedPath {
  const normalized = rawPath.trim().replace(/\\/g, '/');
  let rest = normalized;
  let root = '';
  let absolute = false;
  const drive = rest.match(/^([a-zA-Z]:)(?:\/|$)/);
  if (drive) {
    root = drive[1].toLowerCase();
    rest = rest.slice(drive[1].length).replace(/^\/+/, '');
    absolute = true;
  } else if (rest.startsWith('/')) {
    root = '/';
    rest = rest.replace(/^\/+/, '');
    absolute = true;
  }

  const segments: string[] = [];
  let escaped = false;
  for (const segment of rest.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0) {
        segments.pop();
      } else {
        escaped = true;
      }
      continue;
    }
    segments.push(segment);
  }
  return { absolute, root, segments, escaped };
}

function comparisonSegments(path: ParsedPath): string[] {
  return path.segments.map((segment) => segment.toLowerCase());
}

function sameRoot(left: ParsedPath, right: ParsedPath): boolean {
  return left.absolute === right.absolute && left.root.toLowerCase() === right.root.toLowerCase();
}

function hasParentTraversal(path: string): boolean {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment === '..');
}

export function looksAbsolutePath(path: string): boolean {
  const trimmed = path.trim();
  return /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\');
}

export function isPathInsideProject(projectPath: string, filePath: string): boolean {
  const project = parsePath(projectPath);
  const candidate = parsePath(filePath);
  if (project.escaped || candidate.escaped || !sameRoot(project, candidate)) return false;
  const projectSegments = comparisonSegments(project);
  const candidateSegments = comparisonSegments(candidate);
  if (candidateSegments.length < projectSegments.length) return false;
  return projectSegments.every((segment, index) => candidateSegments[index] === segment);
}

export function relativePathInsideProject(projectPath: string, filePath: string): string | null {
  if (!isPathInsideProject(projectPath, filePath)) return null;
  const project = parsePath(projectPath);
  const candidate = parsePath(filePath);
  return candidate.segments.slice(project.segments.length).join(projectSeparator(projectPath));
}

export function resolveProjectRelativePath(projectPath: string, inputPath: string): string | null {
  const trimmed = inputPath.trim();
  if (!trimmed || hasParentTraversal(trimmed)) return null;
  if (looksAbsolutePath(trimmed)) {
    return isPathInsideProject(projectPath, trimmed) ? trimmed : null;
  }
  const relative = parsePath(trimmed);
  if (relative.absolute || relative.escaped || relative.segments.length === 0) return null;
  const separator = projectSeparator(projectPath);
  return `${normalizeRoot(projectPath)}${separator}${relative.segments.join(separator)}`;
}

export function joinProjectPath(projectPath: string, childPath: string): string | null {
  return resolveProjectRelativePath(projectPath, childPath);
}

export function relativeToProject(projectPath: string, filePath: string): string {
  return relativePathInsideProject(projectPath, filePath) ?? filePath;
}

export function projectBasename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

export function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}
