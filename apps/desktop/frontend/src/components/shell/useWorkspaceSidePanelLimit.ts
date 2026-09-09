import { useSyncExternalStore } from 'react';
import { workspaceSidePanelLimit } from '../../lib/workspace-layout';
import type { LayoutMode } from './useShellState';

function subscribe(onResize: () => void) {
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

const getViewportWidth = () => window.innerWidth;
const getServerWidth = () => null;

export function useWorkspaceSidePanelLimit(projectOpen: boolean, mode: LayoutMode) {
  const width = useSyncExternalStore<number | null>(subscribe, getViewportWidth, getServerWidth);
  return projectOpen && width !== null ? workspaceSidePanelLimit(width, mode) : undefined;
}
