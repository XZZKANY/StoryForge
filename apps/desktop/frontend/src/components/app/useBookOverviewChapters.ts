import { useCallback, useEffect, useRef, useState } from 'react';

import { buildProjectChapterIndex, type ProjectChapter } from '../../lib/project/chapter-index';
import { buildProjectIndex } from '../../lib/project-context';
import { relativePathInsideProject, resolveProjectRelativePath } from '../../lib/project-context';
import { FS_MUTATION_EVENT } from '../../lib/tauri-fs';

export type BookOverviewChaptersStatus = 'unavailable' | 'loading' | 'available' | 'error';

export type BookOverviewChaptersHandle = {
  chapters: ProjectChapter[];
  currentChapter: ProjectChapter | null;
  status: BookOverviewChaptersStatus;
  error: string | null;
  refreshing: boolean;
  /** Rebuilds the deterministic local index without reading chapter bodies. */
  refresh: () => void;
};

const REFRESH_DEBOUNCE_MS = 250;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chapterMatchesCurrent(
  projectPath: string,
  chapter: ProjectChapter,
  currentFile: string | null,
) {
  if (!currentFile) return false;
  const resolved = resolveProjectRelativePath(projectPath, currentFile);
  if (!resolved) return false;
  const relative = relativePathInsideProject(projectPath, resolved);
  return (
    relative !== null &&
    relative.replace(/\\/g, '/').toLowerCase() ===
      chapter.relativePath.replace(/\\/g, '/').toLowerCase()
  );
}

export function useBookOverviewChapters({
  projectPath,
  currentFile,
  active = true,
}: {
  projectPath: string | null;
  currentFile?: string | null;
  active?: boolean;
}): BookOverviewChaptersHandle {
  const [scope, setScope] = useState<{ projectPath: string; chapters: ProjectChapter[] } | null>(
    null,
  );
  const [status, setStatus] = useState<BookOverviewChaptersStatus>('unavailable');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const generationRef = useRef(0);
  const requestRef = useRef(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    if (!projectPath || !active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- project scope teardown must drop prior index immediately
      setScope(null);
      setStatus('unavailable');
      setError(null);
      return;
    }

    const request = ++requestRef.current;
    setStatus('loading');
    setError(null);
    void buildProjectIndex(projectPath)
      .then((index) => {
        if (generation !== generationRef.current || request !== requestRef.current) return;
        setScope({ projectPath, chapters: buildProjectChapterIndex(index) });
        setStatus('available');
      })
      .catch((reason: unknown) => {
        if (generation !== generationRef.current || request !== requestRef.current) return;
        setScope({ projectPath, chapters: [] });
        setStatus('error');
        setError(errorMessage(reason));
      });
  }, [active, nonce, projectPath]);

  useEffect(() => {
    if (!projectPath || !active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFsMutation = (event: Event) => {
      const path = (event as CustomEvent<{ path?: unknown }>).detail?.path;
      if (typeof path === 'string' && !resolveProjectRelativePath(projectPath, path)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener(FS_MUTATION_EVENT, onFsMutation);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(FS_MUTATION_EVENT, onFsMutation);
    };
  }, [active, projectPath, refresh]);

  const chapters = scope?.projectPath === projectPath ? scope.chapters : [];
  const currentChapter =
    chapters.find((chapter) =>
      chapterMatchesCurrent(projectPath ?? '', chapter, currentFile ?? null),
    ) ?? null;

  return {
    chapters,
    currentChapter,
    status: projectPath && active ? status : 'unavailable',
    error: projectPath && active && scope?.projectPath === projectPath ? error : null,
    refreshing: projectPath !== null && active && status === 'loading',
    refresh,
  };
}

export { buildProjectChapterIndex } from '../../lib/project/chapter-index';
export type { ProjectChapter } from '../../lib/project/chapter-index';
