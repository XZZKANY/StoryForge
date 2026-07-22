export function normalizeRoot(path: string): string {
  return path.replace(/[/\\]+$/, '');
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
