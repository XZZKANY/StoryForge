/**
 * 左栏「作品」视图的数据口：档案（`.storyforge/book.json`）+ 三样写作途中要用的现算事实
 * （全书字数 / 大纲目录 / 灵感速记）。
 *
 * 只在视图激活时读盘。四视图是 CSS 互斥常驻挂载的（见 SidePanel），若在 mount 时就扫，
 * 每开一个项目都会白扫一遍全书——那是几百次读盘。
 *
 * 异步结果一律带上它属于哪个项目：切项目时上一本书的统计不得落到当前这本的卡上。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useAsyncEffect } from '../../lib/async-guards';
import { importCoverImage, readCoverDataUrl } from '../../lib/host/book-cover';
import { joinPath } from '../../lib/fs-path-ops';
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
  editIdeaNote,
  locateIdeaNote,
  removeIdeaNote,
  restoreIdeaNoteLine,
  toggleIdeaNote,
  type IdeaNote,
} from '../../lib/idea-notes';
import { scanManuscriptTotals, type ManuscriptTotals } from '../../lib/manuscript-stats';
import { limitOutlineEntries, parseHeadings, type OutlineEntry } from '../../lib/outline-index';
import { ProjectFileMissingError } from '../../lib/host-file-errors';
import { buildProjectIndex } from '../../lib/project-context';
import { TauriFileSystem } from '../../lib/host/tauri-fs';
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
  /** 档案文件读取失败；缺失档案不算错误，会使用空档案。 */
  profileError?: string | null;
  /** 大纲文件读取失败；不把失败伪装成空大纲。 */
  outlineError?: string | null;
  outlineLoading?: boolean;
  /** 最近一次档案保存失败；保留编辑值并提供可见失败原因。 */
  saveError?: string | null;
  outline: OutlineEntry[];
  outlineDropped: number;
  notes: IdeaNote[];
  /** 存进去了返回 true；没存进去（别处改过、写盘失败、还没读出来）返回 false，界面据此保留输入。 */
  addNote: (text: string) => Promise<boolean>;
  toggleNote: (note: IdeaNote) => Promise<void>;
  removeNote: (note: IdeaNote) => Promise<void>;
  editNote: (note: IdeaNote, text: string) => Promise<boolean>;
  refreshing: boolean;
  refresh: () => void;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 文件不存在返回 null；其它读错照常抛出。 */
async function readTextOrNull(projectPath: string, path: string): Promise<string | null> {
  try {
    return await TauriFileSystem.readProjectFile(projectPath, path);
  } catch (error) {
    // 档案 / 灵感文件尚未创建是常态，不是错误；作品目录读不了等其它错误必须暴露。
    if (error instanceof ProjectFileMissingError) return null;
    throw error;
  }
}

/** 空文件也算可写；有内容就必须是 JSON 对象，否则当作读不出来。 */
function isProfileObject(raw: string): boolean {
  if (!raw.trim()) return true;
  try {
    const value: unknown = JSON.parse(raw);
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}

async function readTextOrEmpty(
  projectPath: string,
  path: string,
  allowMissing = true,
): Promise<string> {
  if (!allowMissing) return await TauriFileSystem.readProjectFile(projectPath, path);
  return (await readTextOrNull(projectPath, path)) ?? '';
}

async function scanOutline(projectPath: string): Promise<OutlineEntry[]> {
  const index = await buildProjectIndex(projectPath);
  const files = index.files.filter((file) => file.kind === 'outline');
  const entries: OutlineEntry[] = [];
  for (const file of files) {
    const content = await readTextOrEmpty(projectPath, file.path, false);
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
  const [profileError, setProfileError] = useState<string | null>(null);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [outlineAll, setOutlineAll] = useState<OutlineEntry[]>([]);
  const [notes, setNotes] = useState<IdeaNote[]>([]);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  // 灵感文件读到的那一份（文件不存在为 null；没读出来为 undefined，这时不许写）：勾选 / 删除按行
  // 改写都基于它，写盘也拿它当基线——别处改过就拒写，不拿旧缓存整份盖掉作者后来存的内容。
  const notesSource = useRef<{ project: string; content: string | null } | undefined>(undefined);
  // book.json 读到的那一份，规矩同上：读失败或 JSON 坏了为 undefined，不拿默认值把作者的档案整份盖掉。
  const profileSource = useRef<{ project: string; raw: string | null } | undefined>(undefined);
  // 档案和速记的写盘排成一队：后一次要以前一次写下的内容为基线，并发着写会被条件写当成别处改过。
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T>(job: () => Promise<T>): Promise<T> => {
    const run = writeQueue.current.then(job);
    writeQueue.current = run.catch(() => undefined);
    return run;
  }, []);
  const liveProject = useRef(activeProject);
  useLayoutEffect(() => {
    liveProject.current = activeProject;
  }, [activeProject]);
  const saveLifetimeRef = useRef(0);

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
    setProfileError(null);
    setOutlineError(null);
    setOutlineLoading(false);
    setSaveError(null);
    setCoverUrl(null);
  }

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useAsyncEffect(
    (isCurrent) => {
      if (!activeProject || !active) return;

      void (async () => {
        setLoading(true);
        setRefreshing(true);
        setTotalsError(null);
        setProfileError(null);
        setOutlineError(null);
        setSaveError(null);
        let rawProfile: string | null | undefined;
        let rawNotes: string | null | undefined;
        try {
          rawProfile = await readTextOrNull(activeProject, bookProfilePath(activeProject));
        } catch (error) {
          if (isCurrent()) setProfileError(message(error));
        }
        try {
          rawNotes = await readTextOrNull(activeProject, ideaNotesPath(activeProject));
        } catch {
          // 灵感文件读取失败不应阻止档案和正文继续显示；视图没有独立 notesError seam。
          rawNotes = undefined;
        }
        if (!isCurrent()) return;
        const broken = typeof rawProfile === 'string' && !isProfileObject(rawProfile);
        if (broken) setProfileError('book.json 不是有效的 JSON 对象，先在编辑器里修好');
        profileSource.current =
          rawProfile === undefined || broken
            ? undefined
            : { project: activeProject, raw: rawProfile };
        const loaded = parseBookProfile(rawProfile ?? '');
        setProfile(loaded);
        notesSource.current =
          rawNotes === undefined ? undefined : { project: activeProject, content: rawNotes };
        setNotes(parseIdeaNotes(rawNotes ?? ''));
        setLoading(false);

        if (loaded.cover) {
          const url = await readCoverDataUrl(activeProject, loaded.cover);
          if (isCurrent()) setCoverUrl(url);
        }

        setOutlineLoading(true);
        try {
          const outline = await scanOutline(activeProject);
          if (isCurrent()) setOutlineAll(outline);
        } catch (error) {
          if (isCurrent()) {
            setOutlineAll([]);
            setOutlineError(message(error));
          }
        } finally {
          if (isCurrent()) setOutlineLoading(false);
        }

        try {
          const value = await scanManuscriptTotals(activeProject);
          if (isCurrent()) setTotals({ projectPath: activeProject, value });
        } catch (error) {
          if (isCurrent()) setTotalsError(message(error));
        }
        if (isCurrent()) setRefreshing(false);
      })();
    },
    [activeProject, active, nonce],
  );

  useEffect(() => {
    const lifetime = ++saveLifetimeRef.current;
    return () => {
      if (saveLifetimeRef.current === lifetime) saveLifetimeRef.current += 1;
    };
  }, [activeProject]);

  const save = useCallback(
    async (next: BookProfile) => {
      setProfile(next);
      setSaveError(null);
      if (!activeProject) return;
      const project = activeProject;
      const lifetime = saveLifetimeRef.current;
      const fail = (detail: string) => {
        if (saveLifetimeRef.current !== lifetime) return;
        setSaveError(detail);
        emitToast(`作品档案保存失败：${detail}`);
      };
      await enqueue(async () => {
        const source = profileSource.current;
        if (!source || source.project !== project) {
          fail('档案没读出来，这次没有写入；修好 book.json 或刷新后再改');
          return;
        }
        const content = serializeBookProfile(next);
        // 失焦就提交：没改动的那一下不写盘。
        if (content === serializeBookProfile(parseBookProfile(source.raw ?? ''))) return;
        const storyforgeDir = joinPath(project, '.storyforge');
        try {
          await TauriFileSystem.createDir(project, storyforgeDir, true);
          await TauriFileSystem.writeFileIfUnchanged(
            project,
            bookProfilePath(project),
            content,
            source.raw === null ? { kind: 'missing' } : { kind: 'content', content: source.raw },
          );
          if (profileSource.current === source) profileSource.current = { project, raw: content };
        } catch (error) {
          fail(message(error));
        }
      });
    },
    [activeProject, enqueue],
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

  /** 写成功才更新界面；写进的作品已不是当前作品时只写盘、不动界面。 */
  const writeNotes = useCallback(
    async (project: string, base: string | null, content: string): Promise<boolean> => {
      try {
        await TauriFileSystem.writeFileIfUnchanged(
          project,
          ideaNotesPath(project),
          content,
          base === null ? { kind: 'missing' } : { kind: 'content', content: base },
        );
      } catch (error) {
        emitToast(`灵感速记没有保存：${message(error)}`, { tone: 'error' });
        if (liveProject.current === project) refresh();
        return false;
      }
      if (liveProject.current === project) {
        notesSource.current = { project, content };
        setNotes(parseIdeaNotes(content));
      }
      return true;
    },
    [refresh],
  );
  /** change 返回 null 表示点的那一条在当前内容里已经找不到了：不写，告诉作者。 */
  const changeNotes = useCallback(
    (
      change: (content: string) => string | null,
    ): Promise<{ before: string; written: string } | null> => {
      const project = activeProject;
      return enqueue(async () => {
        const source = notesSource.current;
        if (!project || !source || source.project !== project) {
          emitToast('灵感速记还没读出来，刷新一下再改。', { tone: 'error' });
          return null;
        }
        const before = source.content ?? '';
        const written = change(before);
        if (written === null) {
          emitToast('这条速记已经不在原处了，这次没有改动。', { tone: 'error' });
          return null;
        }
        return (await writeNotes(project, source.content, written)) ? { before, written } : null;
      });
    },
    [activeProject, enqueue, writeNotes],
  );

  const addNote = useCallback(
    async (text: string) =>
      (await changeNotes((content) => appendIdeaNote(content, text))) !== null,
    [changeNotes],
  );
  // 勾选 / 改字 / 删除都在轮到它写时按条目本身重新定位：排在前面的删除会让行号挪位。
  const toggleNote = useCallback(
    async (note: IdeaNote) => {
      await changeNotes((content) => {
        const line = locateIdeaNote(content, note);
        return line === null ? null : toggleIdeaNote(content, line, !note.done);
      });
    },
    [changeNotes],
  );
  const editNote = useCallback(
    async (note: IdeaNote, text: string) =>
      (await changeNotes((content) => {
        const line = locateIdeaNote(content, note);
        return line === null ? null : editIdeaNote(content, line, text);
      })) !== null,
    [changeNotes],
  );
  const removeNote = useCallback(
    async (note: IdeaNote) => {
      const project = activeProject;
      let line = -1;
      const result = await changeNotes((content) => {
        const found = locateIdeaNote(content, note);
        if (found === null) return null;
        line = found;
        return removeIdeaNote(content, found);
      });
      const raw = result?.before.split('\n')[line];
      if (result === null || raw === undefined || !project) return;
      const { written } = result;
      emitToast('已删除这条速记', {
        action: {
          label: '撤销',
          // 只认删除时那本书、删完的那一份：之后别处改过就拒写，换了作品也不拿当前作品的内容去写。
          run: async () => {
            await enqueue(() =>
              writeNotes(project, written, restoreIdeaNoteLine(written, line, raw)),
            );
          },
        },
      });
    },
    [activeProject, changeNotes, enqueue, writeNotes],
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
    profileError,
    outlineError,
    outlineLoading,
    saveError,
    outline: outline.shown,
    outlineDropped: outline.dropped,
    notes,
    addNote,
    toggleNote,
    removeNote,
    editNote,
    refreshing,
    refresh,
  };
}
