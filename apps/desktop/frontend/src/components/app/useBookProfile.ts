/**
 * 左栏「作品」视图的数据口：档案（`.storyforge/book.json`）+ 三样写作途中要用的现算事实
 * （全书字数 / 大纲目录 / 灵感速记）。
 *
 * 只在视图激活时读盘。四视图是 CSS 互斥常驻挂载的（见 SidePanel），若在 mount 时就扫，
 * 每开一个项目都会白扫一遍全书——那是几百次读盘。
 *
 * 异步结果一律带上它属于哪个项目：切项目时上一本书的统计不得落到当前这本的卡上。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { importCoverImage, readCoverDataUrl } from '../../lib/book-cover';
import {
  bookProfilePath,
  emptyBookProfile,
  parseBookProfile,
  serializeBookProfile,
  type BookProfile,
} from '../../lib/book-profile';
import {
  appendIdeaNote,
  ideaNotesPath,
  parseIdeaNotes,
  removeIdeaNote,
  toggleIdeaNote,
  type IdeaNote,
} from '../../lib/idea-notes';
import { scanManuscriptTotals, type ManuscriptTotals } from '../../lib/manuscript-stats';
import { limitOutlineEntries, parseHeadings, type OutlineEntry } from '../../lib/outline-index';
import { buildProjectIndex } from '../../lib/project-context';
import { TauriFileSystem } from '../../lib/tauri-fs';
import { emitToast } from '../../lib/toast';

export type BookProfileHandle = {
  profile: BookProfile;
  loading: boolean;
  save: (next: BookProfile) => Promise<void>;
  /** 封面 data URI；null = 没设封面或封面文件已不在。 */
  coverUrl: string | null;
  /**
   * 换封面。`current` 由视图交出「此刻的档案」——它手里才有那些还没提交的编辑框内容，
   * hook 若自己去读最新 profile 就会把作者敲了一半的书名覆盖掉。
   */
  pickCover: (current: BookProfile) => Promise<void>;
  totals: ManuscriptTotals | null;
  totalsError: string | null;
  outline: OutlineEntry[];
  outlineDropped: number;
  notes: IdeaNote[];
  addNote: (text: string) => Promise<void>;
  toggleNote: (note: IdeaNote) => Promise<void>;
  removeNote: (note: IdeaNote) => Promise<void>;
  refreshing: boolean;
  refresh: () => void;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await TauriFileSystem.readFile(path);
  } catch {
    // 档案 / 灵感文件尚未创建是常态，不是错误。
    return '';
  }
}

async function scanOutline(projectPath: string): Promise<OutlineEntry[]> {
  const index = await buildProjectIndex(projectPath);
  const files = index.files.filter((file) => file.kind === 'outline');
  const entries: OutlineEntry[] = [];
  for (const file of files) {
    const content = await readTextOrEmpty(file.path);
    for (const heading of parseHeadings(content)) {
      entries.push({ ...heading, path: file.path, relativePath: file.relativePath });
    }
  }
  return entries;
}

export function useBookProfile({
  activeProject,
  active,
}: {
  activeProject: string | null;
  active: boolean;
}): BookProfileHandle {
  const [profile, setProfile] = useState<BookProfile>(emptyBookProfile);
  const [loading, setLoading] = useState(false);
  const [totals, setTotals] = useState<{ projectPath: string; value: ManuscriptTotals } | null>(
    null,
  );
  const [totalsError, setTotalsError] = useState<string | null>(null);
  const [outlineAll, setOutlineAll] = useState<OutlineEntry[]>([]);
  const [notes, setNotes] = useState<IdeaNote[]>([]);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  // 灵感文件全文留在手边：勾选 / 删除是按行改写，必须基于读到的那一份原文。
  const notesSource = useRef('');

  // 换项目即清空：新书读完之前，屏幕上不该留着上一本的简介、封面和字数。
  // 用渲染期调整而不是 effect——effect 里同步 setState 会多跑一轮级联渲染，
  // 且那一轮里旧书的数据仍挂在新书的名下。
  const [syncedProject, setSyncedProject] = useState(activeProject);
  if (syncedProject !== activeProject) {
    setSyncedProject(activeProject);
    setProfile(emptyBookProfile());
    setNotes([]);
    setOutlineAll([]);
    setTotals(null);
    setTotalsError(null);
    setCoverUrl(null);
  }

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!activeProject || !active) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setRefreshing(true);
      setTotalsError(null);
      const [rawProfile, rawNotes] = await Promise.all([
        readTextOrEmpty(bookProfilePath(activeProject)),
        readTextOrEmpty(ideaNotesPath(activeProject)),
      ]);
      if (cancelled) return;
      const loaded = parseBookProfile(rawProfile);
      setProfile(loaded);
      notesSource.current = rawNotes;
      setNotes(parseIdeaNotes(rawNotes));
      setLoading(false);

      if (loaded.cover) {
        const url = await readCoverDataUrl(activeProject, loaded.cover);
        if (!cancelled) setCoverUrl(url);
      }

      try {
        const outline = await scanOutline(activeProject);
        if (!cancelled) setOutlineAll(outline);
      } catch {
        if (!cancelled) setOutlineAll([]);
      }

      try {
        const value = await scanManuscriptTotals(activeProject);
        if (!cancelled) setTotals({ projectPath: activeProject, value });
      } catch (error) {
        if (!cancelled) setTotalsError(message(error));
      }
      if (!cancelled) setRefreshing(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProject, active, nonce]);

  const save = useCallback(
    async (next: BookProfile) => {
      setProfile(next);
      if (!activeProject) return;
      const separator = activeProject.includes('\\') ? '\\' : '/';
      const storyforgeDir = `${activeProject.replace(/[\\/]+$/, '')}${separator}.storyforge`;
      try {
        await TauriFileSystem.createDir(activeProject, storyforgeDir, true);
        await TauriFileSystem.writeFile(
          activeProject,
          bookProfilePath(activeProject),
          serializeBookProfile(next),
        );
      } catch (error) {
        emitToast(`作品档案保存失败：${message(error)}`);
      }
    },
    [activeProject],
  );

  const pickCover = useCallback(
    async (current: BookProfile) => {
      if (!activeProject) return;
      try {
        const fileName = await importCoverImage(activeProject, current.cover);
        if (!fileName) return;
        await save({ ...current, cover: fileName });
        setCoverUrl(await readCoverDataUrl(activeProject, fileName));
      } catch (error) {
        emitToast(`封面导入失败：${message(error)}`);
      }
    },
    [activeProject, save],
  );

  const writeNotes = useCallback(
    async (content: string) => {
      if (!activeProject) return;
      notesSource.current = content;
      setNotes(parseIdeaNotes(content));
      try {
        await TauriFileSystem.writeFile(activeProject, ideaNotesPath(activeProject), content);
      } catch (error) {
        emitToast(`灵感速记保存失败：${message(error)}`);
      }
    },
    [activeProject],
  );

  const addNote = useCallback(
    (text: string) => writeNotes(appendIdeaNote(notesSource.current, text)),
    [writeNotes],
  );
  const toggleNote = useCallback(
    (note: IdeaNote) => writeNotes(toggleIdeaNote(notesSource.current, note.line, !note.done)),
    [writeNotes],
  );
  const removeNote = useCallback(
    (note: IdeaNote) => writeNotes(removeIdeaNote(notesSource.current, note.line)),
    [writeNotes],
  );

  const outline = useMemo(() => limitOutlineEntries(outlineAll), [outlineAll]);
  // 上一本书的统计不算数：项目对不上就当作还没统计出来。
  const currentTotals =
    totals && activeProject && totals.projectPath === activeProject ? totals.value : null;

  return {
    profile,
    loading,
    save,
    coverUrl,
    pickCover,
    totals: currentTotals,
    totalsError,
    outline: outline.shown,
    outlineDropped: outline.dropped,
    notes,
    addNote,
    toggleNote,
    removeNote,
    refreshing,
    refresh,
  };
}
