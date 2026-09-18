import { useCallback, useState } from 'react';
import type { MainSurface } from './app-shell-types';
import type { SidePanelView, useShellState } from '../shell/useShellState';

/** 主区导航只改变可见性，Editor/Chat 的挂载和缓冲仍归现有工作台。 */
export function useMainSurface(
  shell: ReturnType<typeof useShellState>,
  closeSettings: (visible: boolean) => void,
) {
  const { showCenter, showSidebar, switchView } = shell;
  const [mainSurface, setMainSurface] = useState<MainSurface>('overview');
  const showEditor = useCallback(() => {
    closeSettings(false);
    setMainSurface('workspace');
    showCenter();
  }, [closeSettings, showCenter]);
  const showOverview = useCallback(() => {
    closeSettings(false);
    setMainSurface('overview');
  }, [closeSettings]);
  const navigateView = useCallback(
    (view: SidePanelView, projectOpen: boolean) => {
      if (view === 'book' && projectOpen) showOverview();
      else {
        setMainSurface('workspace');
        switchView(view);
        if (mainSurface === 'overview') showSidebar();
      }
    },
    [mainSurface, showOverview, showSidebar, switchView],
  );
  return { mainSurface, setMainSurface, showEditor, showOverview, navigateView };
}
