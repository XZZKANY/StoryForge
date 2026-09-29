import type { LayoutMode } from '../components/shell/useShellState';
import { clampSidePanelWidth, SIDE_PANEL_WIDTH_MIN } from './side-panel-width';

export const ACTIVITY_BAR_WIDTH = 48;
export const WORKSPACE_PRIMARY_MIN_WIDTH = 420;
export const ASSISTANT_PANEL_MIN_WIDTH = 320;
export const ASSISTANT_PANEL_WIDTH = 384;
// Zoom reduces the CSS viewport too. Below this budget, editor and Agent take turns
// in the primary pane instead of clipping controls; saved preferences stay intact.
//
// P2-B：断点不得低于 Tauri minWidth（1024）。纯组件和（48+220+420+320=1008）会在
// 1024×768 最小窗口留下 16px 死区：此时不走 compact，但 balanced 预算（默认侧栏共享宽
// 48+300+384=732）仅剩 292px 给主区，若主区仍守 420 最小宽就会横向溢出。max() 把断点提到 1024。
export const WORKSPACE_COMPACT_BREAKPOINT = Math.max(
  ACTIVITY_BAR_WIDTH +
    SIDE_PANEL_WIDTH_MIN +
    WORKSPACE_PRIMARY_MIN_WIDTH +
    ASSISTANT_PANEL_MIN_WIDTH,
  1024,
);

/** 显示约束，不是用户偏好；收窄窗口不得覆盖作者保存的侧栏宽度。 */
export function workspaceSidePanelLimit(viewportWidth: number, mode: LayoutMode): number {
  return clampSidePanelWidth(
    viewportWidth -
      ACTIVITY_BAR_WIDTH -
      WORKSPACE_PRIMARY_MIN_WIDTH -
      (mode === 'balanced' ? ASSISTANT_PANEL_MIN_WIDTH : 0),
  );
}
