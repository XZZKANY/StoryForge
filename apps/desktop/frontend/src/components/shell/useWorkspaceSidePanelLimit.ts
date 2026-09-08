import { useSyncExternalStore } from 'react';
import {
  workspacePrimaryMinWidth,
  workspaceSidePanelLimit,
  WORKSPACE_PRIMARY_MIN_WIDTH,
} from '../../lib/workspace-layout';
import type { LayoutMode } from './useShellState';

function subscribe(onResize: () => void) {
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

const getViewportWidth = () => window.innerWidth;
const getServerWidth = () => null;

// The native window is wider than this boundary. It only applies to browser previews and
// other embedded surfaces where keeping all three columns visible would leave the editor unusable.
// 900px is the narrowest supported three-column workspace; below it, editor focus wins.
export const COMPACT_WORKSPACE_MAX_WIDTH = 899;

export function useCompactWorkspaceViewport() {
  const width = useSyncExternalStore<number | null>(subscribe, getViewportWidth, getServerWidth);
  return width !== null && width <= COMPACT_WORKSPACE_MAX_WIDTH;
}

export function useWorkspaceSidePanelLimit(projectOpen: boolean, mode: LayoutMode) {
  const width = useSyncExternalStore<number | null>(subscribe, getViewportWidth, getServerWidth);
  return projectOpen && width !== null ? workspaceSidePanelLimit(width, mode) : undefined;
}

export function useWorkspacePrimaryMinWidth(projectOpen: boolean) {
  const width = useSyncExternalStore<number | null>(subscribe, getViewportWidth, getServerWidth);
  if (projectOpen && width !== null && width <= COMPACT_WORKSPACE_MAX_WIDTH) return 0;
  return projectOpen && width !== null
    ? workspacePrimaryMinWidth(width)
    : WORKSPACE_PRIMARY_MIN_WIDTH;
}
