/**
 * 批量写章的页签：每章的修订到了会自动打开目标文件（写进文件只在编辑器里发生），写 10 章就开 10 个页签。
 * 调度器在每章开写前记一下目标页签此刻开没开着；这一章写进文件、下一章要开写时，只把调度器打开的那个关掉，
 * 作者原本开着的不动，最后一章留着。清单上撤销时，删之前问一下这一章有没有未保存的修改，删掉以后把页签摘掉。
 * 页签在壳层手里，这里只是两头之间的事件。
 */

export const WRITE_BATCH_TAB_EVENT = 'storyforge:write-batch-tab';

export type WriteBatchTabRequest =
  /** 这一章要开写了：记下目标页签此刻开没开着。 */
  | { kind: 'before'; filePath: string }
  /** 这一章写进文件了、下一章要开写：调度器打开的就关掉。 */
  | { kind: 'close'; filePath: string }
  /** 撤销要删这一章：壳层在派发时同步填上它有没有未保存的修改。 */
  | { kind: 'dirty'; filePath: string; dirty: boolean }
  /** 撤销删掉了这一章：开着的页签摘掉（有未保存修改的不动，免得丢了作者的字）。 */
  | { kind: 'drop'; filePath: string };

function emit(detail: WriteBatchTabRequest) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WriteBatchTabRequest>(WRITE_BATCH_TAB_EVENT, { detail }));
}

export function noteWriteBatchTarget(filePath: string): void {
  emit({ kind: 'before', filePath });
}

export function closeWriteBatchTab(filePath: string): void {
  emit({ kind: 'close', filePath });
}

/** 这一章在编辑器里有没有未保存的修改；壳层没接（没有页签）时当没有。 */
export function writeBatchTabDirty(filePath: string): boolean {
  const request = { kind: 'dirty' as const, filePath, dirty: false };
  emit(request);
  return request.dirty;
}

export function dropWriteBatchTab(filePath: string): void {
  emit({ kind: 'drop', filePath });
}
