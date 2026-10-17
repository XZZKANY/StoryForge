import { useSyncExternalStore } from 'react';
import {
  resolveWorkspaceColumns,
  type WorkspaceColumnPrefs,
  type WorkspaceColumns,
} from '../../lib/workspace-layout';
import type { LayoutMode } from './useShellState';

function subscribe(onResize: () => void) {
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

const getViewportWidth = () => window.innerWidth;
const getServerWidth = () => null;

export function useWorkspaceViewportWidth() {
  return useSyncExternalStore<number | null>(subscribe, getViewportWidth, getServerWidth);
}

/** 三栏显示宽度随窗口实时换算；拿不到窗口宽（服务端渲染）时为 null，调用方用默认摆放。 */
export function useWorkspaceColumns(
  mode: LayoutMode,
  sidebarVisible: boolean,
  prefs: WorkspaceColumnPrefs,
): { viewportWidth: number | null; columns: WorkspaceColumns | null } {
  const viewportWidth = useWorkspaceViewportWidth();
  return {
    viewportWidth,
    columns:
      viewportWidth === null
        ? null
        : resolveWorkspaceColumns(viewportWidth, mode, sidebarVisible, prefs),
  };
}
