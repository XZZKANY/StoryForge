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

export function useBranchManifest(projectPath: string | null, filePath: string | null) {
  const [branchManifest, setBranchManifest] = useState<BranchManifest>(() => emptyManifest());
  const branchManifestRef = useRef<BranchManifest>(branchManifest);
  const projectPathRef = useRef<string | null>(projectPath);
  const filePathRef = useRef<string | null>(filePath);

  useEffect(() => {
    projectPathRef.current = projectPath;
    filePathRef.current = filePath;
    branchManifestRef.current = branchManifest;
  });

  useEffect(() => {
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

  const persistManifest = useCallback(async (manifest: BranchManifest) => {
    const project = projectPathRef.current;
    const path = filePathRef.current;
    if (!project || !path) return;
    try {
      await saveBranchManifest(project, path, manifest);
    } catch (err) {
      console.error('写入分支清单失败:', err);
    }
  }, []);

  const replaceManifest = useCallback(
    async (manifest: BranchManifest) => {
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
    async (timestamp: number) => {
      const current = branchManifestRef.current;
      const next = setBranchHead(current, current.activeBranchId, timestamp);
      await replaceManifest(next);
    },
    [replaceManifest],
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
