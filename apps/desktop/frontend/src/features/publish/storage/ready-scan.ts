import { computeReadyScore, type PublishBook, type PublishSettings, type ReadySignals } from '../model';
import { TauriFileSystem } from '../../../lib/tauri-fs';
import { loadProjectPublish } from './project-publish';

const TEXT_EXT = new Set(['md', 'txt', 'markdown']);
const SKIP_DIR = new Set([
  '.git',
  'node_modules',
  '.storyforge',
  'dist',
  'build',
  '.trellis',
]);

export type ReadyScanResult = {
  signals: ReadySignals;
  score: number;
  blocked: boolean;
  blockReasons: string[];
  lastLocalEditAt: string | null;
};

/**
 * 本地启发式 Ready 扫描：限深 listDir + 文本字数。
 * 失败时返回 unknown 友好结果（不造假达标）。
 */
export async function scanProjectReady(
  projectPath: string,
  book: Pick<PublishBook, 'title' | 'readyConfirmed'>,
  settings: Pick<PublishSettings, 'minChaptersForReady' | 'minCharsForReady'>,
): Promise<ReadyScanResult> {
  const projectFile = await loadProjectPublish(projectPath).catch(() => null);
  const checklist = projectFile?.checklist;
  const checklistComplete = checklist
    ? Object.values(checklist).every(Boolean)
    : false;
  const hasBlurbAndTags = Boolean(
    projectFile?.meta?.blurb?.trim() && (projectFile.meta.tags?.length ?? 0) > 0,
  );

  let chapterCount = 0;
  let charCount = 0;
  let latestMtime = 0;

  try {
    const entries = await TauriFileSystem.listDir(projectPath, true);
    const files = entries.filter((e) => {
      if (e.isDir) return false;
      const parts = e.path.replace(/\\/g, '/').split('/');
      if (parts.some((p) => SKIP_DIR.has(p))) return false;
      const ext = (e.extension || e.name.split('.').pop() || '').toLowerCase();
      return TEXT_EXT.has(ext);
    });

    // 限文件数，防扫盘卡死
    const capped = files.slice(0, 80);
    for (const file of capped) {
      if (file.modified > latestMtime) latestMtime = file.modified;
      const name = file.name.toLowerCase();
      const looksChapter =
        /chapter|chap|第.+章|正文|draft|scene/i.test(name) ||
        /\/(chapters|正文|drafts|scenes)\//i.test(file.path.replace(/\\/g, '/'));
      try {
        const text = await TauriFileSystem.readFile(file.path);
        const len = text.replace(/\s+/g, '').length;
        charCount += len;
        if (looksChapter || len > 500) chapterCount += 1;
      } catch {
        /* skip unreadable */
      }
    }
    if (chapterCount === 0 && charCount > 0) {
      chapterCount = Math.max(1, Math.floor(charCount / 3000));
    }
  } catch {
    /* 扫描失败：保持 0，由 model 标阻断或低分 */
  }

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const editedInLast7Days =
    latestMtime > 0 && Date.now() - latestMtime * 1000 < sevenDaysMs;

  const signals: ReadySignals = {
    hasTitle: Boolean(book.title?.trim() || projectFile?.title?.trim()),
    chapterCount,
    charCount,
    checklistComplete,
    hasBlurbAndTags,
    editedInLast7Days,
    readyConfirmed: book.readyConfirmed || Boolean(projectFile?.readyConfirmed),
  };

  const breakdown = computeReadyScore(signals, settings);
  return {
    signals,
    score: breakdown.score,
    blocked: breakdown.blocked,
    blockReasons: breakdown.blockReasons,
    lastLocalEditAt: latestMtime > 0 ? new Date(latestMtime * 1000).toISOString() : null,
  };
}
