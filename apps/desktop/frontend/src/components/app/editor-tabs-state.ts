export function openEditorFile(openFiles: string[], path: string): string[] {
  return openFiles.includes(path) ? openFiles : [...openFiles, path];
}

export function closeEditorFile(openFiles: string[], path: string): string[] {
  return openFiles.filter((file) => file !== path);
}

export function nextEditorFileAfterClose(openFiles: string[], path: string): string | null {
  const index = openFiles.indexOf(path);
  if (index < 0) return openFiles[openFiles.length - 1] ?? null;
  return openFiles[index + 1] ?? openFiles[index - 1] ?? null;
}

export function updateDirtyEditorFiles(
  dirtyFiles: ReadonlySet<string>,
  path: string,
  dirty: boolean,
): Set<string> {
  const next = new Set(dirtyFiles);
  if (dirty) next.add(path);
  else next.delete(path);
  return next;
}

export function canCommitEditorSave(
  savedPath: string,
  savedModel: object,
  currentPath: string | null,
  currentModel: object | null,
): boolean {
  return savedPath === currentPath && savedModel === currentModel;
}

export function isRetainedEditorModel(savedModel: object, cachedModel: object | null): boolean {
  return savedModel === cachedModel;
}
