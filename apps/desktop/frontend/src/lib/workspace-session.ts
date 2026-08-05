/**
 * 工作现场（写作时刻 01「恢复现场」）。
 *
 * 此前重启一次就得重走：欢迎页 → 打开项目 → 在文件树里找到那一章 → 滚回昨天停笔的地方。
 * 最近项目 / 最近文件两个列表都只是「入口」，不是现场：页签集合、当前文件、光标位置全丢。
 *
 * 这里只负责纯粹的读写与校验，不碰 React：
 *   - parse / serialize 容错到底，任何脏值都退化成 null 而不是抛异常（localStorage 会被手改、
 *     会被上个版本写脏，启动路径上不允许因此白屏）；
 *   - reconcile 用磁盘实际存在的文件过滤掉已删 / 已改名的路径 —— 恢复一个不存在的页签
 *     会让编辑器停在「读取文件失败」，比不恢复更糟；
 *   - 光标表只保留仍然打开的文件，否则一个长期项目会把几百个死路径攒在 localStorage 里。
 */

const SESSION_KEY = 'storyforge:workspace-session';

/** 1-based 行列，与 Monaco 的 Position 同惯例。 */
export type FileCursor = { line: number; column: number };

export type WorkspaceSession = {
  project: string;
  openFiles: string[];
  activeFile: string | null;
  cursors: Record<string, FileCursor>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sanitizeCursor(value: unknown): FileCursor | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<FileCursor>;
  const line = Number(candidate.line);
  const column = Number(candidate.column);
  if (!Number.isFinite(line) || !Number.isFinite(column)) return null;
  if (line < 1 || column < 1) return null;
  return { line: Math.floor(line), column: Math.floor(column) };
}

/** 任何解析失败都返回 null：启动路径上不允许因为一段脏 JSON 就打不开编辑器。 */
export function parseWorkspaceSession(raw: string | null): WorkspaceSession | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate = parsed as Partial<WorkspaceSession>;
  if (!isNonEmptyString(candidate.project)) return null;

  const openFiles = Array.isArray(candidate.openFiles)
    ? candidate.openFiles.filter(isNonEmptyString)
    : [];
  const activeFile = isNonEmptyString(candidate.activeFile) ? candidate.activeFile : null;

  const cursors: Record<string, FileCursor> = {};
  if (candidate.cursors && typeof candidate.cursors === 'object') {
    for (const [path, value] of Object.entries(candidate.cursors)) {
      const cursor = sanitizeCursor(value);
      if (isNonEmptyString(path) && cursor) cursors[path] = cursor;
    }
  }

  return { project: candidate.project, openFiles, activeFile, cursors };
}

/**
 * 用磁盘实际存在的路径过滤会话。
 * 项目本身不在了就整份作废（返回 null）；个别文件不在了只摘掉那一条。
 * activeFile 若被摘掉，回落到剩余页签的第一条，避免恢复出一个「有页签但没内容」的现场。
 */
export function reconcileWorkspaceSession(
  session: WorkspaceSession | null,
  projectExists: boolean,
  existingFiles: ReadonlySet<string>,
): WorkspaceSession | null {
  if (!session || !projectExists) return null;

  const openFiles = session.openFiles.filter((path) => existingFiles.has(path));
  // 项目在但没有可恢复的文件时，整个会话作废，避免恢复出空壳 + 误判 restoredWorkspace
  if (openFiles.length === 0) return null;

  const activeFile =
    session.activeFile && existingFiles.has(session.activeFile)
      ? session.activeFile
      : (openFiles[0] ?? null);

  return { ...session, openFiles, activeFile, cursors: pruneCursors(session.cursors, openFiles) };
}

/** 只留仍然打开的文件的光标，防止长期项目把死路径攒成一大坨。 */
export function pruneCursors(
  cursors: Record<string, FileCursor>,
  keepPaths: readonly string[],
): Record<string, FileCursor> {
  const keep = new Set(keepPaths);
  const next: Record<string, FileCursor> = {};
  for (const [path, cursor] of Object.entries(cursors)) {
    if (keep.has(path)) next[path] = cursor;
  }
  return next;
}

/** 没有项目、也没有任何打开的文件时不值得存 —— 存了只会在下次启动恢复出一个空壳。 */
export function isWorthPersisting(session: WorkspaceSession | null): session is WorkspaceSession {
  return Boolean(session && session.project && session.openFiles.length > 0);
}

export function loadWorkspaceSession(): WorkspaceSession | null {
  try {
    return parseWorkspaceSession(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function saveWorkspaceSession(session: WorkspaceSession | null): void {
  try {
    if (!isWorthPersisting(session)) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // localStorage 不可用（隐私模式 / 配额满）时放弃持久化，不影响本次写作。
  }
}
