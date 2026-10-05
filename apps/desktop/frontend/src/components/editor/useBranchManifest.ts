import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createBranch,
  emptyManifest,
  getActiveBranch,
  loadBranchManifest,
  saveBranchManifest,
  setActiveBranch,
  setBranchHead,
  type BranchInfo,
  type BranchManifest,
} from '../../lib/branches';
import { emitToast } from '../../lib/toast';

export function useBranchManifest(projectPath: string | null, filePath: string | null) {
  const [branchManifest, setBranchManifest] = useState<BranchManifest>(() => emptyManifest());
  const branchManifestRef = useRef<BranchManifest>(branchManifest);
  const projectPathRef = useRef<string | null>(projectPath);
  const filePathRef = useRef<string | null>(filePath);
  const manifestWriteMarkRef = useRef(new Map<string, number>());
  const manifestOwnerRef = useRef<string | null>(null);
  const manifestTaskChainRef = useRef(new Map<string, Promise<unknown>>());

  useEffect(() => {
    projectPathRef.current = projectPath;
    filePathRef.current = filePath;
    branchManifestRef.current = branchManifest;
  });

  useEffect(() => {
    if (!filePath) {
      const empty = emptyManifest();
      manifestOwnerRef.current = null;
      branchManifestRef.current = empty;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- filePath 清空时同步重置分支清单，React18 合法模式
      setBranchManifest(empty);
      return;
    }
    let cancelled = false;
    const key = `${projectPath}::${filePath}`;
    const writeMark = manifestWriteMarkRef.current.get(key) ?? 0;
    void (async () => {
      const manifest = await loadBranchManifest(projectPath, filePath);
      // 只淘汰同一文档写入之前的旧读；A 的迟到保存不能使 B 的有效加载失效。
      if (cancelled || (manifestWriteMarkRef.current.get(key) ?? 0) !== writeMark) return;
      manifestOwnerRef.current = key;
      branchManifestRef.current = manifest;
      setBranchManifest(manifest);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, filePath]);

  const runManifestTask = useCallback(
    (
      project: string,
      path: string,
      mutate: (base: BranchManifest) => BranchManifest,
      deliveryTicket?: string,
    ) => {
      const key = `${project}::${path}`;
      const previous = manifestTaskChainRef.current.get(key) ?? Promise.resolve();
      const run = previous
        .catch(() => undefined)
        .then(async () => {
          // 队列内做读-改-写：每次变更都落在最新真值上，并发推进与切分支彼此 rebase。
          // 当前页签路径相同不代表内存清单已加载到该文档；未就绪时必须取目标盘面。
          const sameFile =
            projectPathRef.current === project &&
            filePathRef.current === path &&
            manifestOwnerRef.current === key;
          const base = sameFile
            ? branchManifestRef.current
            : await loadBranchManifest(project, path);
          const next = mutate(base);
          await saveBranchManifest(
            project,
            path,
            next,
            ...(deliveryTicket ? [deliveryTicket] : []),
          );
          manifestWriteMarkRef.current.set(key, (manifestWriteMarkRef.current.get(key) ?? 0) + 1);
          // 迟到的结果仅在同一文档仍活动时投影，不得污染已切换的页签。
          if (projectPathRef.current === project && filePathRef.current === path) {
            manifestOwnerRef.current = key;
            branchManifestRef.current = next;
            setBranchManifest(next);
          }
          return next;
        });
      manifestTaskChainRef.current.set(
        key,
        run.catch(() => undefined),
      );
      return run;
    },
    [],
  );

  const runInteractiveTask = useCallback(
    async (mutate: (base: BranchManifest) => BranchManifest) => {
      const project = projectPathRef.current;
      const path = filePathRef.current;
      if (!project || !path) {
        const next = mutate(branchManifestRef.current);
        branchManifestRef.current = next;
        setBranchManifest(next);
        return;
      }
      try {
        await runManifestTask(project, path, mutate);
      } catch (err) {
        console.error('写入分支清单失败:', err);
        emitToast(`分支清单保存失败：${err instanceof Error ? err.message : String(err)}`, {
          tone: 'error',
        });
      }
    },
    [runManifestTask],
  );

  const getActiveBranchSnapshot = useCallback(
    (): BranchInfo => getActiveBranch(branchManifestRef.current),
    [],
  );

  const advanceBranchHead = useCallback(
    async (
      timestamp: number,
      target?: { projectPath: string; filePath: string; branchId: string; deliveryTicket?: string },
    ) => {
      const project = target?.projectPath ?? projectPathRef.current;
      const path = target?.filePath ?? filePathRef.current;
      if (!project || !path) return;
      const mutate = (base: BranchManifest) =>
        setBranchHead(base, target?.branchId ?? base.activeBranchId, timestamp);
      if (!target) {
        await runInteractiveTask(mutate);
        return;
      }
      // A snapshot may finish after navigating away; the caller names the document it belongs to.
      await runManifestTask(project, path, mutate, target.deliveryTicket);
    },
    [runInteractiveTask, runManifestTask],
  );

  const selectBranch = useCallback(
    async (branchId: string) => {
      await runInteractiveTask((base) => setActiveBranch(base, branchId));
    },
    [runInteractiveTask],
  );

  const createBranchFromNode = useCallback(
    async (nodeId: number, label: string) => {
      await runInteractiveTask((base) => createBranch(base, nodeId, label));
    },
    [runInteractiveTask],
  );

  return {
    branchManifest,
    advanceBranchHead,
    createBranchFromNode,
    getActiveBranchSnapshot,
    selectBranch,
  };
}
