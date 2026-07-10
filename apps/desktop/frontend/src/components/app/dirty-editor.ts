export function nextDirtyEditorFile(
  currentDirtyFile: string | null,
  filePath: string | null,
  dirty: boolean,
): string | null {
  if (dirty) return filePath;
  return currentDirtyFile === filePath ? null : currentDirtyFile;
}

export function shouldConfirmBeforeReplacingDirtyEditor(
  dirtyFile: string | null,
  targetFile: string | null,
): boolean {
  return Boolean(dirtyFile && dirtyFile !== targetFile);
}
