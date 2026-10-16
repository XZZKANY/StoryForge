/**
 * 写作工作台的入口与中栏去处（作者 10-16：进写作台中间是空的）。进写作台时没开着文件就打开
 * 停下的那一章；中栏空着时给「接着写第 N 章」或（空书）「和 AI 聊聊这本书」。停下的那一章与
 * 总览「继续写」同一条规则：当前章，否则阅读序最新一章。
 *
 * 章节索引也在这里建：总览要列章节；写作台中栏空着时也要知道停在哪一章。
 */
import { useCallback } from 'react';
import type { MainSurface } from './app-shell-types';
import { useBookOverviewChapters } from './useBookOverviewChapters';
import { WritingDeskEmptyState } from './WritingDeskEmptyState';

export function useWritingDesk(
  workspace: { activeProject: string | null; currentFile: string | null },
  tabs: { displayedFile: string | null },
  mainSurface: MainSurface,
  continueWriting: (relativePath?: string) => void,
  discussBook: () => void,
) {
  const displayedFile = tabs.displayedFile;
  const chapters = useBookOverviewChapters({
    projectPath: workspace.activeProject,
    currentFile: workspace.currentFile,
    active: mainSurface === 'overview' || (mainSurface === 'workspace' && !displayedFile),
  });
  const resume = chapters.currentChapter ?? chapters.chapters[chapters.chapters.length - 1] ?? null;
  const enterWritingDesk = useCallback(
    () => continueWriting(displayedFile ? undefined : resume?.relativePath),
    [continueWriting, displayedFile, resume],
  );
  const emptyState = (
    <WritingDeskEmptyState
      resumeOrdinal={resume?.ordinal ?? null}
      bookEmpty={chapters.status === 'available' && chapters.chapters.length === 0}
      loading={chapters.status === 'loading' || chapters.status === 'unavailable'}
      onResume={resume ? () => continueWriting(resume.relativePath) : undefined}
      onDiscussBook={discussBook}
    />
  );
  return { chapters, enterWritingDesk, emptyState };
}
