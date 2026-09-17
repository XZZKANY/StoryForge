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
import { relativePathInsideProject } from '../../lib/project/path';
import { classifyRelativePath } from '../../lib/project/semantics';

export type SessionRestoreIssue = {
  kind: 'missing-project' | 'check-failed';
  project: string;
  message: string;
};

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
  const [restoreIssue, setRestoreIssue] = useState<SessionRestoreIssue | null>(null);
  // idle = 还没决定；restoring = 已发起 selectProject，等页签层铺完；done = 可以开始回写了
  const [phase, setPhase] = useState<'idle' | 'restoring' | 'done'>('idle');
  const cursorsRef = useRef<Record<string, FileCursor>>({});
  // 自动恢复是一次异步流程；手动打开项目一旦发生，立即夺取导航权。
  // 不能等 React 提交 activeProject 后再失效，否则旧 pathExists 结果可能迟到覆盖新现场。
  const restoreGenerationRef = useRef(0);
  const selectProjectRef = useRef(selectProject);
  useEffect(() => {
    selectProjectRef.current = selectProject;
  });

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- 启动时一次性判定要不要恢复：
       没开开关 / 没有存档就直接放行回写（phase=done），属挂载期同步决策，React18 合法模式。 */
    if (!enabled) {
      setRestoreIssue(null);
      setPhase('done');
      return;
    }
    const session = loadWorkspaceSession();
    if (!session) {
      setRestoreIssue(null);
      setPhase('done');
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    void (async () => {
      const generation = restoreGenerationRef.current;
      const [projectCheck, fileChecks] = await Promise.all([
        TauriFileSystem.pathExists(session.project)
          .then((exists) => ({ exists, failed: false }))
          .catch(() => ({ exists: true, failed: true })),
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
      if (cancelled || generation !== restoreGenerationRef.current) return;

      const existing = new Set(fileChecks.filter((path): path is string => path !== null));
      if (projectCheck.failed) {
        setRestoreIssue({
          kind: 'check-failed',
          project: session.project,
          message: `无法验证上次作品是否仍存在：${session.project}`,
        });
        setPhase('done');
        return;
      }
      const reconciled = reconcileWorkspaceSession(session, projectCheck.exists, existing);
      if (!projectCheck.exists || !reconciled) {
        // 项目目录已不存在时不能切入 overview：保留当前欢迎态，避免把死路径写回最近项目。
        setRestoreIssue({
          kind: 'missing-project',
          project: session.project,
          message: `上次打开的作品已不存在：${session.project}`,
        });
        setPhase('done');
        return;
      }

      // 项目仍在，但所有存档页签均已删除/改名：仍恢复项目本身，交给 App
      // 的 onProjectSelected 进入作品总览；不要把「无文件」误判为「无项目」。
      // 页签集合保留全部仍存在的文件，但只有「存档时原本的 activeFile」且它仍是
      // 正文章节，才能直达工作台。activeFile 失效、落在大纲/人物卡等非正文时回总览，
      // 绝不把 openFiles[0] 冒充作者上次正在写的章节。
      const restoredActiveFile = (() => {
        const activeFile = session.activeFile;
        if (!activeFile || !reconciled.openFiles.includes(activeFile)) return null;
        const relative = relativePathInsideProject(session.project, activeFile);
        if (!relative || classifyRelativePath(relative) !== 'draft') return null;
        return activeFile;
      })();
      const restoreTarget = {
        ...reconciled,
        activeFile: restoredActiveFile,
        cursors: reconciled.cursors,
      };
      cursorsRef.current = restoreTarget.cursors;
      setPendingRestore(restoreTarget);
      setPhase('restoring');
      selectProjectRef.current(restoreTarget.project);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const handleRestoreApplied = useCallback(() => setPhase('done'), []);

  /**
   * App 在用户确认过目录/脏稿后调用的手动导航入口。
   * 同步使本轮自动恢复失效、清掉旧光标并开放现场回写；取消操作不得调用此函数。
   */
  const selectProjectManually = useCallback((path: string) => {
    restoreGenerationRef.current += 1;
    cursorsRef.current = {};
    setPendingRestore(null);
    setRestoreIssue(null);
    setPhase('done');
    selectProjectRef.current(path);
  }, []);

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
    restoreIssue,
    initialCursors: pendingRestore?.cursors ?? null,
    handleRestoreApplied,
    selectProjectManually,
    recordCursor,
    persistSession,
    /** 恢复出了现场就别再弹欢迎页——作者要的是接着写，不是先看一眼首页。 */
    restoredWorkspace: pendingRestore !== null,
  };
}
