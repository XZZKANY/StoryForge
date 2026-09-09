import type { LayoutMode } from '../components/shell/useShellState';
import { clampSidePanelWidth } from './side-panel-width';

export const ACTIVITY_BAR_WIDTH = 48;
export const WORKSPACE_PRIMARY_MIN_WIDTH = 420;
export const ASSISTANT_PANEL_MIN_WIDTH = 320;
export const ASSISTANT_PANEL_WIDTH = 384;

/** 显示约束，不是用户偏好；收窄窗口不得覆盖作者保存的侧栏宽度。 */
export function workspaceSidePanelLimit(viewportWidth: number, mode: LayoutMode): number {
  return clampSidePanelWidth(
    viewportWidth -
      ACTIVITY_BAR_WIDTH -
      WORKSPACE_PRIMARY_MIN_WIDTH -
      (mode === 'balanced' ? ASSISTANT_PANEL_MIN_WIDTH : 0),
  );
}
