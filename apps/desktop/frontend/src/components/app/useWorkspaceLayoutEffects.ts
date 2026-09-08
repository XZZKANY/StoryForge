import { useEffect, useRef } from 'react';

import type { useShellState } from '../shell/useShellState';
import {
  COMPACT_WORKSPACE_MAX_WIDTH,
  useCompactWorkspaceViewport,
} from '../shell/useWorkspaceSidePanelLimit';

type WorkspaceLayoutState = Pick<
  ReturnType<typeof useShellState>,
  'layoutMode' | 'setLayoutMode' | 'sidebarHidden' | 'toggleSidebar'
>;

/** 保留项目进入与窄屏临时布局的副作用顺序，不改变偏好或子组件挂载。 */
export function useWorkspaceLayoutEffects(projectOpen: boolean, shell: WorkspaceLayoutState) {
  const wasProjectOpenRef = useRef(projectOpen);
  const compactWorkspace = useCompactWorkspaceViewport();
  const { layoutMode, setLayoutMode, sidebarHidden, toggleSidebar } = shell;

  useEffect(() => {
    const opened = !wasProjectOpenRef.current && projectOpen;
    wasProjectOpenRef.current = projectOpen;
    if (!opened) return;
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      document.querySelector<HTMLElement>('[data-current-view="true"]')?.focus({
        preventScroll: true,
      });
    });
  }, [projectOpen]);
  const layoutBeforeCompactRef = useRef<{
    /** Values before compact mode temporarily narrows the workspace. */
    sidebarHidden: boolean;
    layoutMode: ReturnType<typeof useShellState>['layoutMode'];
    /** The values written by the compact transition, used to detect user overrides. */
    expectedSidebarHidden: boolean;
    expectedLayoutMode: ReturnType<typeof useShellState>['layoutMode'];
    sidebarOverridden: boolean;
    layoutOverridden: boolean;
    sidebarSyncPending: boolean;
    layoutSyncPending: boolean;
  } | null>(null);
  const compactFocusOriginRef = useRef<'sidebar' | 'assistant' | null>(null);

  useEffect(() => {
    const captureCompactFocus = () => {
      if (
        window.innerWidth > COMPACT_WORKSPACE_MAX_WIDTH ||
        layoutBeforeCompactRef.current ||
        compactFocusOriginRef.current
      ) {
        return;
      }
      const activeElement = document.activeElement;
      compactFocusOriginRef.current = activeElement?.closest('[data-testid="shell-side-panel"]')
        ? 'sidebar'
        : activeElement?.closest('[data-testid="assistant-panel"]')
          ? 'assistant'
          : null;
    };
    // Capture before useSyncExternalStore commits the compact layout and hidden panels.
    window.addEventListener('resize', captureCompactFocus, true);
    return () => window.removeEventListener('resize', captureCompactFocus, true);
  }, []);

  useEffect(() => {
    if (!compactWorkspace) {
      const previous = layoutBeforeCompactRef.current;
      if (!previous) return;
      layoutBeforeCompactRef.current = null;
      compactFocusOriginRef.current = null;
      // Restore only dimensions that stayed under the responsive override. A deliberate
      // activity/titlebar action while compact must survive the return to the desktop width.
      if (!previous.sidebarOverridden && sidebarHidden !== previous.sidebarHidden) toggleSidebar();
      if (!previous.layoutOverridden && layoutMode !== previous.layoutMode) {
        setLayoutMode(previous.layoutMode);
      }
      return;
    }

    const previous = layoutBeforeCompactRef.current;
    if (!previous) {
      if (!compactFocusOriginRef.current) {
        const activeElement = document.activeElement;
        compactFocusOriginRef.current = activeElement?.closest('[data-testid="shell-side-panel"]')
          ? 'sidebar'
          : activeElement?.closest('[data-testid="assistant-panel"]')
            ? 'assistant'
            : null;
      }
      layoutBeforeCompactRef.current = {
        sidebarHidden,
        layoutMode,
        expectedSidebarHidden: true,
        expectedLayoutMode: 'editor',
        sidebarOverridden: false,
        layoutOverridden: false,
        sidebarSyncPending: sidebarHidden !== true,
        layoutSyncPending: layoutMode !== 'editor',
      };
      if (!sidebarHidden) toggleSidebar();
      if (layoutMode !== 'editor') setLayoutMode('editor');
      const focusOrigin = compactFocusOriginRef.current;
      if (focusOrigin) {
        requestAnimationFrame(() => {
          const target =
            focusOrigin === 'sidebar'
              ? document.querySelector<HTMLElement>('[data-current-view="true"]')
              : document.querySelector<HTMLElement>('[data-testid="titlebar-toggle-right"]');
          target?.focus({ preventScroll: true });
        });
      }
      return;
    }

    // State changes caused by the transition itself match the expected values. Any later
    // mismatch came from a user action (activity rail, command palette, or titlebar).
    if (previous.sidebarSyncPending) {
      if (sidebarHidden === previous.expectedSidebarHidden) {
        previous.sidebarSyncPending = false;
      } else if (sidebarHidden !== previous.sidebarHidden) {
        previous.sidebarSyncPending = false;
        previous.sidebarOverridden = true;
        previous.expectedSidebarHidden = sidebarHidden;
      }
    } else if (sidebarHidden !== previous.expectedSidebarHidden) {
      previous.sidebarOverridden = true;
      previous.expectedSidebarHidden = sidebarHidden;
    }
    if (previous.layoutSyncPending) {
      if (layoutMode === previous.expectedLayoutMode) {
        previous.layoutSyncPending = false;
      } else if (layoutMode !== previous.layoutMode) {
        previous.layoutSyncPending = false;
        previous.layoutOverridden = true;
        previous.expectedLayoutMode = layoutMode;
      }
    } else if (layoutMode !== previous.expectedLayoutMode) {
      previous.layoutOverridden = true;
      previous.expectedLayoutMode = layoutMode;
    }
  }, [compactWorkspace, layoutMode, setLayoutMode, sidebarHidden, toggleSidebar]);

  return compactWorkspace;
}
