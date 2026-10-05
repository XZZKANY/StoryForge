import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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

type RestorePhase = 'idle' | 'awaiting-selection' | 'restoring' | 'done';

/**
 * 会话只在启动（或重新启用恢复）时读取。作品库模式先留存快照，作者选择同一作品后
 * 才校验并交给真实页签 owner 恢复；未选择、校验中和页签落地前均不能用空现场回写。
 */
export function useSessionRestore({
  enabled,
  selectProject,
  deferUntilProjectSelected = false,
}: {
  enabled: boolean;
  selectProject: (path: string) => void;
  deferUntilProjectSelected?: boolean;
}) {
  const [pendingRestore, setPendingRestore] = useState<WorkspaceSession | null>(null);
  const [restoreIssue, setRestoreIssue] = useState<SessionRestoreIssue | null>(null);
  const [openingProject, setOpeningProject] = useState<string | null>(null);
  const [phase, setPhase] = useState<RestorePhase>('idle');
  const cursorsRef = useRef<Record<string, FileCursor>>({});
  const workspaceSnapshotRef = useRef<WorkspaceSession | null>(null);
  const deferredSessionRef = useRef<WorkspaceSession | null>(null);
  const pendingApplyRef = useRef<WorkspaceSession | null>(null);
  const openingRef = useRef<string | null>(null);
  const restoreGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const canPersistRef = useRef(false);
  const selectProjectRef = useRef(selectProject);

  useLayoutEffect(() => {
    selectProjectRef.current = selectProject;
  });
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      restoreGenerationRef.current += 1;
      canPersistRef.current = false;
      workspaceSnapshotRef.current = null;
    };
  }, []);

  const changePhase = useCallback((next: RestorePhase) => {
    // 同步闸门也保护本帧旧的 persistSession callback；不能仅依赖下一次 render。
    canPersistRef.current = next === 'done';
    // 导航/恢复移交后，只有下一次真实页签快照能重新授权光标持久化。
    workspaceSnapshotRef.current = null;
    setPhase(next);
  }, []);

  const restoreSession = useCallback(
    (session: WorkspaceSession, deferred: boolean) => {
      if (!mountedRef.current || openingRef.current === session.project) return;
      const generation = ++restoreGenerationRef.current;
      openingRef.current = session.project;
      setOpeningProject(session.project);
      setRestoreIssue(null);
      changePhase('idle');
      void (async () => {
        const [projectCheck, fileChecks] = await Promise.all([
          TauriFileSystem.pathExists(session.project)
            .then((exists) => ({ exists, failed: false }))
            .catch(() => ({ exists: true, failed: true })),
          Promise.all(
            session.openFiles.map(async (path) => {
              try {
                return (await TauriFileSystem.pathExists(path)) ? path : null;
              } catch {
                // 瞬时文件 IO 失败不应吃掉作者的页签与光标。
                return path;
              }
            }),
          ),
        ]);
        if (!mountedRef.current || generation !== restoreGenerationRef.current) return;
        openingRef.current = null;
        setOpeningProject(null);
        const existing = new Set(fileChecks.filter((path): path is string => path !== null));
        const reconciled = reconcileWorkspaceSession(session, projectCheck.exists, existing);
        if (projectCheck.failed || !reconciled) {
          setRestoreIssue({
            kind: projectCheck.failed ? 'check-failed' : 'missing-project',
            project: session.project,
            message: projectCheck.failed
              ? `无法验证上次作品是否仍存在：${session.project}`
              : `上次打开的作品已不存在：${session.project}`,
          });
          // 从作品库重试仍使用原快照，不让 persistSession(null) 抹掉可恢复数据。
          changePhase(deferred ? 'awaiting-selection' : 'done');
          return;
        }

        // 保留全部有效页签；只有原 activeFile 仍是正文章节才直接进入工作台。
        // 项目存在但无页签、active 失效或为大纲时仍开作品总览，不伪造第一章。
        const activeFile = session.activeFile;
        const relative = activeFile && relativePathInsideProject(session.project, activeFile);
        const restoreTarget: WorkspaceSession = {
          ...reconciled,
          activeFile:
            activeFile &&
            reconciled.openFiles.includes(activeFile) &&
            relative &&
            classifyRelativePath(relative) === 'draft'
              ? activeFile
              : null,
        };
        deferredSessionRef.current = null;
        pendingApplyRef.current = restoreTarget;
        cursorsRef.current = restoreTarget.cursors;
        setPendingRestore(restoreTarget);
        changePhase('restoring');
        selectProjectRef.current(restoreTarget.project);
      })();
    },
    [changePhase],
  );

  useEffect(() => {
    const session = enabled ? loadWorkspaceSession() : null;
    deferredSessionRef.current = deferUntilProjectSelected ? session : null;
    openingRef.current = null;
    /* eslint-disable react-hooks/set-state-in-effect -- 启动/恢复开关变化的一次性决策，不从渲染中的空现场推导存档。 */
    setOpeningProject(null);
    setRestoreIssue(null);
    if (!session) changePhase('done');
    else if (deferUntilProjectSelected) changePhase('awaiting-selection');
    else restoreSession(session, false);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      restoreGenerationRef.current += 1;
      openingRef.current = null;
      canPersistRef.current = false;
    };
  }, [enabled, deferUntilProjectSelected, changePhase, restoreSession]);

  const handleRestoreApplied = useCallback(() => {
    if (!mountedRef.current || !pendingRestore || pendingApplyRef.current !== pendingRestore)
      return;
    pendingApplyRef.current = null;
    changePhase('done');
  }, [changePhase, pendingRestore]);

  /** 显式回库/打开新建流程只撤销在途导航；保留快照供后续重试，不触碰已恢复现场。 */
  const cancelPendingNavigation = useCallback(() => {
    if (!mountedRef.current || openingRef.current === null) return;
    restoreGenerationRef.current += 1;
    openingRef.current = null;
    setOpeningProject(null);
    changePhase('awaiting-selection');
  }, [changePhase]);

  /** 仅在目录/脏稿确认通过后调用；取消目录选择不能消耗存档快照。 */
  const selectProjectManually = useCallback(
    (path: string) => {
      if (!mountedRef.current) return;
      const saved = deferredSessionRef.current;
      if (saved?.project === path) {
        restoreSession(saved, true);
        return;
      }
      // 选另一作品立即接管，不等旧 IO；A→B→A 也不能复用第一次 A 的恢复资格。
      restoreGenerationRef.current += 1;
      deferredSessionRef.current = null;
      pendingApplyRef.current = null;
      openingRef.current = null;
      cursorsRef.current = {};
      setOpeningProject(null);
      setPendingRestore(null);
      setRestoreIssue(null);
      changePhase('done');
      selectProjectRef.current(path);
    },
    [changePhase, restoreSession],
  );

  const recordCursor = useCallback((filePath: string, cursor: FileCursor) => {
    const snapshot = workspaceSnapshotRef.current;
    if (!mountedRef.current || !canPersistRef.current || !snapshot?.openFiles.includes(filePath)) {
      return;
    }
    cursorsRef.current = { ...cursorsRef.current, [filePath]: cursor };
    // Editor 已去抖；不等文件/页签变化，也不为光标移动重渲染整个 App。
    const next = { ...snapshot, cursors: pruneCursors(cursorsRef.current, snapshot.openFiles) };
    workspaceSnapshotRef.current = next;
    saveWorkspaceSession(next);
  }, []);

  /** 页签归独立 owner，App 在其落地后回写；phase 与同步闸门共同防止空现场覆盖。 */
  const persistSession = useCallback(
    (activeProject: string | null, openFiles: string[], currentFile: string | null) => {
      if (phase !== 'done' || !canPersistRef.current) return;
      if (!enabled || !activeProject) {
        workspaceSnapshotRef.current = null;
        saveWorkspaceSession(null);
        return;
      }
      const snapshot: WorkspaceSession = {
        project: activeProject,
        openFiles,
        activeFile: currentFile,
        cursors: pruneCursors(cursorsRef.current, openFiles),
      };
      workspaceSnapshotRef.current = snapshot;
      saveWorkspaceSession(snapshot);
    },
    [enabled, phase],
  );

  return {
    pendingRestore: phase === 'restoring' ? pendingRestore : null,
    restoreIssue,
    openingProject,
    initialCursors: pendingRestore?.cursors ?? null,
    handleRestoreApplied,
    selectProjectManually,
    cancelPendingNavigation,
    recordCursor,
    persistSession,
    restoredWorkspace: pendingRestore !== null,
  };
}
