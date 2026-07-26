import { useCallback, useEffect, useRef, useState } from 'react';

import { TauriFileSystem } from '../../lib/tauri-fs';
import {
  loadWorkspaceSession,
  pruneCursors,
  reconcileWorkspaceSession,
  saveWorkspaceSession,
  type FileCursor,
  type WorkspaceSession,
} from '../../lib/workspace-session';

/**
 * 写作时刻 01「恢复现场」的编排：启动读一次、校验磁盘、交还给页签层铺开；
 * 之后随现场变化持续回写。
 *
 * 三条纪律：
 *  1. 只在挂载时读一次会话。读到之后 pendingRestore 就固定下来，后续用户操作不再受它影响，
 *     否则「关掉一个页签」会被下一次 effect 重新恢复回来。
 *  2. 恢复完成前不回写。启动瞬间 openFiles 还是空的，这时候存盘等于把现场抹平 ——
 *     必须等 restorePhase 走到 done 才允许 save。
 *  3. 磁盘校验在写回之前。恢复一个已被删除 / 改名的页签会让编辑器停在「读取文件失败」，
 *     比不恢复更糟。
 */
export function useSessionRestore({
  enabled,
  selectProject,
}: {
  enabled: boolean;
  selectProject: (path: string) => void;
}) {
  const [pendingRestore, setPendingRestore] = useState<WorkspaceSession | null>(null);
  // idle = 还没决定；restoring = 已发起 selectProject，等页签层铺完；done = 可以开始回写了
  const [phase, setPhase] = useState<'idle' | 'restoring' | 'done'>('idle');
  const cursorsRef = useRef<Record<string, FileCursor>>({});
  const selectProjectRef = useRef(selectProject);
  useEffect(() => {
    selectProjectRef.current = selectProject;
  });

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- 启动时一次性判定要不要恢复：
       没开开关 / 没有存档就直接放行回写（phase=done），属挂载期同步决策，React18 合法模式。 */
    if (!enabled) {
      setPhase('done');
      return;
    }
    const session = loadWorkspaceSession();
    if (!session) {
      setPhase('done');
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    void (async () => {
      const [projectExists, fileChecks] = await Promise.all([
        TauriFileSystem.pathExists(session.project).catch(() => true),
        Promise.all(
          session.openFiles.map(async (path) => {
            // 校验出错时保守保留：一次瞬时 IO 失败不该吃掉作者的现场。
            try {
              return (await TauriFileSystem.pathExists(path)) ? path : null;
            } catch {
              return path;
            }
          }),
        ),
      ]);
      if (cancelled) return;

      const existing = new Set(fileChecks.filter((path): path is string => path !== null));
      const reconciled = reconcileWorkspaceSession(session, projectExists, existing);
      if (!reconciled || reconciled.openFiles.length === 0) {
        setPhase('done');
        return;
      }

      cursorsRef.current = reconciled.cursors;
      setPendingRestore(reconciled);
      setPhase('restoring');
      selectProjectRef.current(reconciled.project);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const handleRestoreApplied = useCallback(() => setPhase('done'), []);

  /** 编辑器光标去抖回调；只记内存，落盘由下面的持久化 effect 统一做。 */
  const recordCursor = useCallback((filePath: string, cursor: FileCursor) => {
    cursorsRef.current = { ...cursorsRef.current, [filePath]: cursor };
  }, []);

  /**
   * 回写现场。由 App 在 effect 里调用（openFiles 属于页签层，而页签层反过来依赖
   * 本 hook 的 pendingRestore，故不能把它作为入参绕回来形成环）。
   * 恢复未完成（phase !== 'done'）时一律不写：启动瞬间 openFiles 还是空的，此刻落盘等于抹平现场。
   */
  const persistSession = useCallback(
    (activeProject: string | null, openFiles: string[], currentFile: string | null) => {
      if (phase !== 'done') return;
      if (!enabled || !activeProject) {
        saveWorkspaceSession(null);
        return;
      }
      saveWorkspaceSession({
        project: activeProject,
        openFiles,
        activeFile: currentFile,
        cursors: pruneCursors(cursorsRef.current, openFiles),
      });
    },
    [enabled, phase],
  );

  return {
    pendingRestore: phase === 'restoring' ? pendingRestore : null,
    initialCursors: pendingRestore?.cursors ?? null,
    handleRestoreApplied,
    recordCursor,
    persistSession,
    /** 恢复出了现场就别再弹欢迎页——作者要的是接着写，不是先看一眼首页。 */
    restoredWorkspace: pendingRestore !== null,
  };
}
