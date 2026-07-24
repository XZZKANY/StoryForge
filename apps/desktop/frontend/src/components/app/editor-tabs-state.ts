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

// 页签拖拽重排：把 from 移到 to 的位置（纯本地数组次序，不动磁盘）。越界/同位/未打开即原样返回。
export function reorderEditorFiles(openFiles: string[], from: string, to: string): string[] {
  const fromIndex = openFiles.indexOf(from);
  const toIndex = openFiles.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return openFiles;
  const next = [...openFiles];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
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
