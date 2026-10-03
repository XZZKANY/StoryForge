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
  const manifestGenerationRef = useRef(0);
  const manifestSaveChainRef = useRef(new Map<string, Promise<unknown>>());

  useEffect(() => {
    projectPathRef.current = projectPath;
    filePathRef.current = filePath;
    branchManifestRef.current = branchManifest;
  });

  useEffect(() => {
    manifestGenerationRef.current += 1;
    if (!filePath) {
      const empty = emptyManifest();
      branchManifestRef.current = empty;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- filePath 清空时同步重置分支清单，React18 合法模式
      setBranchManifest(empty);
      return;
    }
    let cancelled = false;
    void (async () => {
      const manifest = await loadBranchManifest(projectPath, filePath);
      if (cancelled) return;
      branchManifestRef.current = manifest;
      setBranchManifest(manifest);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, filePath]);

  const queueManifestSave = useCallback(
    (project: string, path: string, manifest: BranchManifest, deliveryTicket?: string) => {
      const key = `${project}::${path}`;
      const previous = manifestSaveChainRef.current.get(key) ?? Promise.resolve();
      const save = previous
        .catch(() => undefined)
        .then(() =>
          saveBranchManifest(project, path, manifest, ...(deliveryTicket ? [deliveryTicket] : [])),
        );
      manifestSaveChainRef.current.set(
        key,
        save.catch(() => undefined),
      );
      return save;
    },
    [],
  );

  const persistManifest = useCallback(
    async (manifest: BranchManifest) => {
      const project = projectPathRef.current;
      const path = filePathRef.current;
      if (!project || !path) return;
      try {
        await queueManifestSave(project, path, manifest);
      } catch (err) {
        console.error('写入分支清单失败:', err);
        emitToast(`分支清单保存失败：${err instanceof Error ? err.message : String(err)}`, {
          tone: 'error',
        });
      }
    },
    [queueManifestSave],
  );

  const replaceManifest = useCallback(
    async (manifest: BranchManifest) => {
      manifestGenerationRef.current += 1;
      branchManifestRef.current = manifest;
      setBranchManifest(manifest);
      await persistManifest(manifest);
    },
    [persistManifest],
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
      if (
        target &&
        (target.projectPath !== projectPathRef.current || target.filePath !== filePathRef.current)
      ) {
        // A snapshot may finish after navigating away; its checkpoint belongs to the original file.
        const manifest = await loadBranchManifest(target.projectPath, target.filePath);
        await queueManifestSave(
          target.projectPath,
          target.filePath,
          setBranchHead(manifest, target.branchId, timestamp),
          target.deliveryTicket,
        );
        return;
      }
      const generationAtStart = (manifestGenerationRef.current += 1);
      const current = branchManifestRef.current;
      const next = setBranchHead(current, target?.branchId ?? current.activeBranchId, timestamp);
      if (target) {
        await queueManifestSave(target.projectPath, target.filePath, next, target.deliveryTicket);
        // 落盘已结算；仅当文档与代际都没变时才投影，迟到的结果不得污染已切换的页签。
        if (
          manifestGenerationRef.current !== generationAtStart ||
          projectPathRef.current !== target.projectPath ||
          filePathRef.current !== target.filePath
        ) {
          return;
        }
        branchManifestRef.current = next;
        setBranchManifest(next);
      } else await replaceManifest(next);
    },
    [queueManifestSave, replaceManifest],
  );

  const selectBranch = useCallback(
    async (branchId: string) => {
      const next = setActiveBranch(branchManifestRef.current, branchId);
      await replaceManifest(next);
    },
    [replaceManifest],
  );

  const createBranchFromNode = useCallback(
    async (nodeId: number, label: string) => {
      const next = createBranch(branchManifestRef.current, nodeId, label);
      await replaceManifest(next);
    },
    [replaceManifest],
  );

  return {
    branchManifest,
    advanceBranchHead,
    createBranchFromNode,
    getActiveBranchSnapshot,
    selectBranch,
  };
}
