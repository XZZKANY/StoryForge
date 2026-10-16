import type { LayoutMode } from '../components/shell/useShellState';
import { SIDE_PANEL_WIDTH_MAX, SIDE_PANEL_WIDTH_MIN } from './side-panel-width';

export const ACTIVITY_BAR_WIDTH = 48;
export const WORKSPACE_PRIMARY_MIN_WIDTH = 420;
export const ASSISTANT_PANEL_MIN_WIDTH = 320;
export const ASSISTANT_PANEL_MAX_WIDTH = 960;
// Zoom reduces the CSS viewport too. Below this budget, editor and Agent take turns
// in the primary pane instead of clipping controls; saved preferences stay intact.
//
// P2-B：断点不得低于 Tauri minWidth（1024）。纯组件和（48+220+420+320=1008）会在
// 1024×768 最小窗口留下 16px 死区，max() 把断点提到 1024。
export const WORKSPACE_COMPACT_BREAKPOINT = Math.max(
  ACTIVITY_BAR_WIDTH +
    SIDE_PANEL_WIDTH_MIN +
    WORKSPACE_PRIMARY_MIN_WIDTH +
    ASSISTANT_PANEL_MIN_WIDTH,
  1024,
);

/**
 * 三栏跟着窗口走（作者 10-16：「不要只修好一个固定尺寸，而要让三栏布局能够自适应」）。
 * 侧栏、对话栏的偏好是「占窗口宽的比例」：拖过用作者的比例，没拖过用默认比例；换算成像素
 * 再夹进各自上下限，所以窗口从 1400 拉到 2560 时三栏一起变宽，而不是只有编辑区变宽。
 * 没拖过时另有一道默认上限：大屏上文件树和对话栏不必无限变宽。
 */
export const SIDE_PANEL_DEFAULT_RATIO = 0.16;
export const SIDE_PANEL_DEFAULT_MAX_WIDTH = 360;
export const ASSISTANT_PANEL_DEFAULT_RATIO = 0.27;
export const ASSISTANT_PANEL_DEFAULT_MAX_WIDTH = 640;
/** 编辑区保底：剩下的不够这么宽时，先收对话栏、再收侧栏，各自收到下限为止。 */
export const WORKSPACE_PRIMARY_COMFORT_WIDTH = 560;

export type WorkspaceColumnPrefs = {
  /** 侧栏占窗口宽的比例；null = 作者没拖过，用默认比例。 */
  sideRatio: number | null;
  /** 对话栏（平衡态）占窗口宽的比例；null = 用默认比例。 */
  assistantRatio: number | null;
};

export type WorkspaceColumns = {
  /** 侧栏显示宽度；侧栏不显示时为 0。 */
  side: number;
  /** 对话栏显示宽度；只在平衡态有意义，其余布局为 0（对话聚焦时它占满剩余空间）。 */
  assistant: number;
  /** 此刻拖动侧栏最多能拖到多宽（不挤破编辑区保底）。 */
  sideMax: number;
  /** 此刻拖动对话栏最多能拖到多宽。 */
  assistantMax: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), Math.max(min, max));
}

function preferredWidth(
  viewport: number,
  ratio: number | null,
  defaults: { ratio: number; max: number },
  limits: { min: number; max: number },
): number {
  return ratio === null
    ? clamp(viewport * defaults.ratio, limits.min, defaults.max)
    : clamp(viewport * ratio, limits.min, limits.max);
}

/** 显示约束，不是偏好：窗口变窄只改这一次的显示宽度，作者存下的比例不变。 */
export function resolveWorkspaceColumns(
  viewport: number,
  mode: LayoutMode,
  sidebarVisible: boolean,
  prefs: WorkspaceColumnPrefs,
): WorkspaceColumns {
  const sideLimits = { min: SIDE_PANEL_WIDTH_MIN, max: SIDE_PANEL_WIDTH_MAX };
  const assistantLimits = { min: ASSISTANT_PANEL_MIN_WIDTH, max: ASSISTANT_PANEL_MAX_WIDTH };
  let side = sidebarVisible
    ? preferredWidth(
        viewport,
        prefs.sideRatio,
        { ratio: SIDE_PANEL_DEFAULT_RATIO, max: SIDE_PANEL_DEFAULT_MAX_WIDTH },
        sideLimits,
      )
    : 0;
  let assistant =
    mode === 'balanced'
      ? preferredWidth(
          viewport,
          prefs.assistantRatio,
          { ratio: ASSISTANT_PANEL_DEFAULT_RATIO, max: ASSISTANT_PANEL_DEFAULT_MAX_WIDTH },
          assistantLimits,
        )
      : 0;
  // 对话聚焦时主区就是对话本身，只守住它的硬下限；编辑区在场时守写作保底。
  const floor = mode === 'chat' ? WORKSPACE_PRIMARY_MIN_WIDTH : WORKSPACE_PRIMARY_COMFORT_WIDTH;
  let deficit = floor - (viewport - ACTIVITY_BAR_WIDTH - side - assistant);
  if (deficit > 0 && assistant > 0) {
    const cut = Math.min(deficit, assistant - ASSISTANT_PANEL_MIN_WIDTH);
    assistant -= cut;
    deficit -= cut;
  }
  if (deficit > 0 && side > 0) side -= Math.min(deficit, side - SIDE_PANEL_WIDTH_MIN);
  return {
    side,
    assistant,
    sideMax: clamp(
      viewport - ACTIVITY_BAR_WIDTH - assistant - floor,
      sideLimits.min,
      sideLimits.max,
    ),
    assistantMax: clamp(
      viewport - ACTIVITY_BAR_WIDTH - side - WORKSPACE_PRIMARY_COMFORT_WIDTH,
      assistantLimits.min,
      assistantLimits.max,
    ),
  };
}

/** 拖完的像素宽度记成比例；窗口宽未知时不记，避免存进一个算不回去的值。 */
export function widthToRatio(width: number, viewport: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(viewport) || viewport <= 0) return null;
  return Math.round((width / viewport) * 10000) / 10000;
}

/** 版本记录抽屉没有对话栏可盖时（编辑聚焦 / 窄窗轮流）的宽度。 */
export const HISTORY_DRAWER_DEFAULT_WIDTH = 360;

/**
 * 版本记录抽屉压在右栏的位置上（作者 10-16 ④：此前是编辑区里一条 320px 竖栏，把正文拦腰盖住）：
 * 平衡态正好盖住对话栏、与它同宽；编辑聚焦时没有对话栏，落在编辑区右侧（正文按行宽折行，右边多半是空的）。
 */
export function historyDrawerWidth(
  mode: LayoutMode,
  rightPanelVisible: boolean,
  assistant: number,
) {
  return mode === 'balanced' && rightPanelVisible && assistant > 0
    ? assistant
    : HISTORY_DRAWER_DEFAULT_WIDTH;
}
