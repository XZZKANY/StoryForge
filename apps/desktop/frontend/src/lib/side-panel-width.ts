/**
 * 侧面板宽度。全左栏共享一份：切换活动栏图标只换面板内容，右边界不动，
 * 编辑区不跳。曾按视图各记一份（宽档 340 / 窄档 260），作者切视图时宽度反复横跳；
 * 旧格式在 user-settings 加载时一次性迁移成单值（见 migrateSidePanelWidths）。
 *
 * 这里只有纯函数与约束常量，拖拽手势在 SidePanel；窗口收窄的显示夹限由
 * useWorkspaceSidePanelLimit 提供，只约束显示，不回写这份偏好。
 */

export const SIDE_PANEL_WIDTH_DEFAULT = 300;
export const SIDE_PANEL_WIDTH_MIN = 220;
export const SIDE_PANEL_WIDTH_MAX = 800;

export function clampSidePanelWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDE_PANEL_WIDTH_DEFAULT;
  return Math.min(Math.max(Math.round(px), SIDE_PANEL_WIDTH_MIN), SIDE_PANEL_WIDTH_MAX);
}

/** 拖拽中的宽度：起始宽 + 指针位移，夹在上下限内。 */
export function draggedSidePanelWidth(startWidth: number, deltaX: number): number {
  return clampSidePanelWidth(startWidth + deltaX);
}
