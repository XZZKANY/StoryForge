export function normalizeRoot(path: string): string {
  return path.replace(/[/\\]+$/, '');
}

function normalizeToSlash(path: string): string {
  return path.trim().replace(/\\/g, '/');
}

function normalizeDotSegments(path: string): string {
  const normalized = normalizeToSlash(path);
  const drive = normalized.match(/^[a-zA-Z]:/u)?.[0] ?? '';
  const absolutePrefix = drive || (normalized.startsWith('/') ? '/' : '');
  const rest = drive
    ? normalized.slice(drive.length).replace(/^\/+/, '')
    : normalized.replace(/^\/+/, '');
  const segments: string[] = [];
  for (const segment of rest.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (drive) return `${drive}/${segments.join('/')}`.replace(/\/+$/u, '');
  if (absolutePrefix === '/') return `/${segments.join('/')}`.replace(/\/+$/u, '') || '/';
  return segments.join('/');
}

function separatorFor(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

function stripPathRoot(path: string): string {
  return normalizeToSlash(path)
    .replace(/^[a-zA-Z]:\/?/u, '')
    .replace(/^\/+/u, '');
}

function hasUnsafeSegments(path: string): boolean {
  const rest = stripPathRoot(path);
  if (!rest) return true;
  return rest.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}

export function looksAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[/\\]/u.test(path) || path.startsWith('/') || path.startsWith('\\');
}

export function relativePathInsideProject(projectPath: string, filePath: string): string | null {
  const root = normalizeDotSegments(normalizeRoot(projectPath));
  const candidate = normalizeDotSegments(filePath);
  const rootForCompare = root.toLowerCase();
  const candidateForCompare = candidate.toLowerCase();
  if (candidateForCompare === rootForCompare) return '';
  if (!candidateForCompare.startsWith(`${rootForCompare}/`)) return null;
  const relative = candidate.slice(root.length + 1);
  if (!relative || hasUnsafeSegments(relative)) return null;
  const s = filePath.includes('\\') ? '\\' : separatorFor(projectPath);
  return relative.split('/').join(s);
}

export function isPathInsideProject(projectPath: string, filePath: string): boolean {
  return relativePathInsideProject(projectPath, filePath) !== null;
}

export function joinProjectPath(projectPath: string, relativePath: string): string {
  const s = separatorFor(projectPath);
  return [normalizeRoot(projectPath), ...normalizeToSlash(relativePath).split('/')].join(s);
}

export function resolveProjectRelativePath(projectPath: string, inputPath: string): string | null {
  const trimmed = inputPath.trim();
  if (!trimmed || hasUnsafeSegments(trimmed)) return null;
  if (looksAbsolutePath(trimmed)) {
    const relative = relativePathInsideProject(projectPath, trimmed);
    return relative === null ? null : joinProjectPath(projectPath, relative);
  }
  return joinProjectPath(projectPath, normalizeToSlash(trimmed));
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
