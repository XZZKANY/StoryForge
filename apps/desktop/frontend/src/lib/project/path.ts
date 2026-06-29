export function normalizeRoot(path: string): string {
  return path.replace(/[/\\]+$/, '');
}

export function relativeToProject(projectPath: string, filePath: string): string {
  const root = normalizeRoot(projectPath);
  return filePath.startsWith(root) ? filePath.slice(root.length).replace(/^[/\\]+/, '') : filePath;
}

export function projectBasename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

export function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}
