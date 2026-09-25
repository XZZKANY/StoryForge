import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createBlankStoryProject } from '../../lib/project-context';
import { blankStoryProjectPath } from '../../lib/project/create';

type NewProjectOptions = {
  activeProject: string | null;
  openFiles: string[];
  confirmDiscardFiles: (paths: string[], actionLabel: string) => Promise<boolean>;
  onCreated: (projectPath: string) => void;
};

export function useNewProject({
  activeProject,
  openFiles,
  confirmDiscardFiles,
  onCreated,
}: NewProjectOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitleValue] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosingDirectory, setChoosingDirectory] = useState(false);
  const mounted = useRef(true);
  const opened = useRef(false);
  const claim = useRef<'create' | 'picker' | null>(null);
  const created = useRef(false);
  const shouldRestoreOpener = useCallback(() => !created.current, []);
  const scope = useRef(0);
  useLayoutEffect(() => {
    scope.current += 1;
  }, [activeProject]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const open = useCallback(() => {
    if (claim.current || opened.current) return;
    opened.current = true;
    created.current = false;
    setTitleValue('');
    setError(null);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    if (claim.current) return;
    opened.current = false;
    setIsOpen(false);
  }, []);
  const setTitle = useCallback((value: string) => {
    if (claim.current) return;
    setTitleValue(value);
    setError(null);
  }, []);

  const chooseDirectory = useCallback(async () => {
    if (claim.current || !opened.current) return;
    claim.current = 'picker';
    setChoosingDirectory(true);
    setError(null);
    try {
      const { open: choose } = await import('@tauri-apps/plugin-dialog');
      const selected = await choose({
        directory: true,
        multiple: false,
        title: '选择作品保存位置',
      });
      if (mounted.current && typeof selected === 'string') setParentPath(selected);
    } catch (reason) {
      if (mounted.current)
        setError(`无法选择保存位置：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      claim.current = null;
      if (mounted.current) setChoosingDirectory(false);
    }
  }, []);

  const create = useCallback(async () => {
    if (claim.current || !opened.current) return;
    try {
      blankStoryProjectPath(parentPath, title);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    claim.current = 'create';
    const requestScope = scope.current;
    setBusy(true);
    setError(null);
    try {
      if (!(await confirmDiscardFiles(openFiles, '新建作品'))) return;
      if (!mounted.current) return;
      if (scope.current !== requestScope)
        throw new Error('当前作品已切换，请确认新建作品信息后重试。');
      const projectPath = await createBlankStoryProject(parentPath, title);
      if (!mounted.current) return;
      if (scope.current !== requestScope)
        throw new Error(`作品已创建于 ${projectPath}，但当前作品已切换。请从作品库打开新作品。`);
      created.current = true;
      onCreated(projectPath);
      opened.current = false;
      setIsOpen(false);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      claim.current = null;
      if (mounted.current) setBusy(false);
    }
  }, [confirmDiscardFiles, onCreated, openFiles, parentPath, title]);

  let targetPath = '';
  try {
    targetPath = blankStoryProjectPath(parentPath, title);
  } catch {
    /* Preview only valid paths. */
  }
  return {
    isOpen,
    title,
    parentPath,
    targetPath,
    error,
    busy,
    choosingDirectory,
    open,
    close,
    setTitle,
    chooseDirectory,
    create,
    shouldRestoreOpener,
  };
}

export type NewProjectController = ReturnType<typeof useNewProject>;
