import type { LayoutMode } from '../components/shell/useShellState';
import { clampSidePanelWidth, SIDE_PANEL_WIDTH_MIN } from './side-panel-width';

export const ACTIVITY_BAR_WIDTH = 48;
export const WORKSPACE_PRIMARY_MIN_WIDTH = 420;
export const ASSISTANT_PANEL_MIN_WIDTH = 320;
export const ASSISTANT_PANEL_WIDTH = 384;

/**
 * 三栏工作区在窄窗口中的中栏下限：侧栏和 Agent 栏先保留可用宽度，
 * 中栏再吃掉剩余空间；宽屏继续使用 420px，避免改变现有编辑手感。
 */
export function workspacePrimaryMinWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth)) return WORKSPACE_PRIMARY_MIN_WIDTH;
  return Math.min(
    WORKSPACE_PRIMARY_MIN_WIDTH,
    Math.max(
      0,
      viewportWidth - ACTIVITY_BAR_WIDTH - SIDE_PANEL_WIDTH_MIN - ASSISTANT_PANEL_MIN_WIDTH,
    ),
  );
}

/** 显示约束，不是用户偏好；收窄窗口不得覆盖作者保存的侧栏宽度。 */
export function workspaceSidePanelLimit(viewportWidth: number, mode: LayoutMode): number {
  const primaryMinWidth = workspacePrimaryMinWidth(viewportWidth);
  return clampSidePanelWidth(
    viewportWidth -
      ACTIVITY_BAR_WIDTH -
      primaryMinWidth -
      (mode === 'balanced' ? ASSISTANT_PANEL_MIN_WIDTH : 0),
  );
}
