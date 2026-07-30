/**
 * 侧面板宽度。改前按视图两档写死（explorer/search 236px，book/manuscript/observatory 300px），
 * 作者的实际反馈是「作品栏占的位置太少了」——宽度该由作者拖，不该由我猜。
 *
 * 拖过的宽度按视图各记一份：作品要宽（封面 + 简介 + 进度 + 大纲），资源管理器要窄，
 * 一个全局宽度会让两边都别扭。没拖过的视图仍吃档位默认。
 * 这里只有纯函数与档位常量，拖拽手势在 SidePanel。
 */

export const SIDE_PANEL_WIDTH_MIN = 200;
export const SIDE_PANEL_WIDTH_MAX = 720;

/** 信息密度高的视图（封面行 / 章节行 / 台账行）默认给宽档。 */
const WIDE_DEFAULT_VIEWS: ReadonlySet<string> = new Set(['book', 'manuscript', 'observatory']);
const WIDE_DEFAULT_PX = 340;
const NARROW_DEFAULT_PX = 236;

export function defaultSidePanelWidth(view: string): number {
  return WIDE_DEFAULT_VIEWS.has(view) ? WIDE_DEFAULT_PX : NARROW_DEFAULT_PX;
}

export function clampSidePanelWidth(px: number): number {
  if (!Number.isFinite(px)) return NARROW_DEFAULT_PX;
  return Math.min(Math.max(Math.round(px), SIDE_PANEL_WIDTH_MIN), SIDE_PANEL_WIDTH_MAX);
}

export function resolveSidePanelWidth(view: string, widths: Record<string, number>): number {
  const saved = widths[view];
  return typeof saved === 'number' ? clampSidePanelWidth(saved) : defaultSidePanelWidth(view);
}

/** 拖拽中的宽度：起始宽 + 指针位移，夹在上下限内。 */
export function draggedSidePanelWidth(startWidth: number, deltaX: number): number {
  return clampSidePanelWidth(startWidth + deltaX);
}
