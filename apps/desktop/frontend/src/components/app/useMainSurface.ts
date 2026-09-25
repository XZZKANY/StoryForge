import { useCallback, useRef, useState } from 'react';
import type { MainSurface } from './app-shell-types';
import type { SidePanelView, useShellState } from '../shell/useShellState';

/** 主区导航只改变可见性，Editor/Chat 的挂载和缓冲仍归现有工作台。 */
export function useMainSurface(
  shell: ReturnType<typeof useShellState>,
  closeSettings: (visible: boolean) => void,
) {
  const { showCenter, showSidebar, switchView } = shell;
  const [mainSurface, setSurface] = useState<MainSurface>('library');
  const previousSurface = useRef<Exclude<MainSurface, 'library'>>('overview');
  const setMainSurface = useCallback(
    (next: MainSurface) => {
      if (next === 'library' && mainSurface !== 'library') previousSurface.current = mainSurface;
      setSurface(next);
    },
    [mainSurface],
  );
  const showLibrary = useCallback(() => {
    closeSettings(false);
    setMainSurface('library');
  }, [closeSettings, setMainSurface]);
  const resumeProject = useCallback(() => {
    closeSettings(false);
    setMainSurface(previousSurface.current);
  }, [closeSettings, setMainSurface]);
  const showEditor = useCallback(() => {
    closeSettings(false);
    setMainSurface('workspace');
    showCenter();
  }, [closeSettings, setMainSurface, showCenter]);
  const showOverview = useCallback(() => {
    closeSettings(false);
    setMainSurface('overview');
  }, [closeSettings, setMainSurface]);
  const navigateView = useCallback(
    (view: SidePanelView, projectOpen: boolean) => {
      if (view === 'book' && projectOpen) showOverview();
      else {
        setMainSurface('workspace');
        switchView(view);
        if (mainSurface !== 'workspace') showSidebar();
      }
    },
    [mainSurface, setMainSurface, showOverview, showSidebar, switchView],
  );
  const openAllChapters = useCallback(() => {
    showEditor();
    switchView('manuscript');
    // switchView follows VS Code semantics and may collapse an already active view;
    // this entry point must always leave the complete chapter list visible.
    showSidebar();
  }, [showEditor, showSidebar, switchView]);
  return {
    mainSurface,
    setMainSurface,
    showEditor,
    showOverview,
    showLibrary,
    resumeProject,
    navigateView,
    openAllChapters,
  };
}
