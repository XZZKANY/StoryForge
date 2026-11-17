import { normalizePathForMatch } from './project/path';

/**
 * 作者最近一次在编辑器里翻、点、打字的文件和时刻。AI 交来别的文件的修订时，界面据此判断
 * 作者是不是正在读手头这份：在读就不切画面（试用里读第二章时两次被刚写好的第三章抢走）。
 * 一分钟内碰过算在读——读稿一般隔十几二十秒翻一屏，干等 AI 写章时不会去碰编辑器。
 */
export const READING_WINDOW_MS = 60_000;

let lastActivity: { path: string; at: number } | null = null;

export function noteEditorActivity(filePath: string, at = Date.now()): void {
  lastActivity = { path: normalizePathForMatch(filePath), at };
}

export function isReadingFile(filePath: string, now = Date.now()): boolean {
  return (
    lastActivity !== null &&
    lastActivity.path === normalizePathForMatch(filePath) &&
    now - lastActivity.at < READING_WINDOW_MS
  );
}
