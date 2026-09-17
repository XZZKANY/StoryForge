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

/**
 * Ctrl+Tab 在已固定页签间循环（不含预览槽）。当前文件不在固定页签集合时（例如正在预览、
 * 或刚关完只剩预览）方向 1 落到第一个、-1 落到最后一个，给个确定的起点而不是原地不动。
 * 与 Ctrl+W 关键区别：这里只换焦点、不关页签，因此不触发脏文件确认，按一圈不会丢稿。
 */
export function nextCyclicEditorFile(
  openFiles: string[],
  currentFile: string | null,
  direction: 1 | -1,
): string | null {
  if (openFiles.length === 0) return null;
  const index = currentFile === null ? -1 : openFiles.indexOf(currentFile);
  if (index < 0) return direction === 1 ? openFiles[0] : openFiles[openFiles.length - 1];
  return openFiles[(index + direction + openFiles.length) % openFiles.length];
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

export type EditorTabPane = 'file' | 'preview';

/**
 * 编辑器展示哪个文件：
 * - 预览页签被激活且预览槽有值 → 展示预览；
 * - 否则展示固定的当前文件；当前文件为空时回落到预览（例如只单击开了一个预览）。
 * 关键点（修 #5）：切到固定页签只改激活面（activePane='file'），不再清空预览槽，
 * 预览页签因而不会在切换时消失。
 */
export function resolveDisplayedEditorFile(
  activePane: EditorTabPane,
  previewFile: string | null,
  currentFile: string | null,
): string | null {
  if (activePane === 'preview' && previewFile) return previewFile;
  return currentFile ?? previewFile;
}

/**
 * 中栏活动页签高亮：展示的正是预览文件则预览页签高亮，否则固定页签高亮。
 * （#15 起设置改弹出式覆盖层，不再占中栏页签，故此处不再有 settings 分支。）
 */
export function resolveActiveCenterTab(
  displayedFile: string | null,
  previewFile: string | null,
): 'file' | 'preview' | null {
  if (!displayedFile) return null;
  return displayedFile === previewFile ? 'preview' : 'file';
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
