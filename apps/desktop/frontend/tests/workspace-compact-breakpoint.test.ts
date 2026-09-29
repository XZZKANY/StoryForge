import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  ACTIVITY_BAR_WIDTH,
  ASSISTANT_PANEL_MIN_WIDTH,
  ASSISTANT_PANEL_WIDTH,
  WORKSPACE_COMPACT_BREAKPOINT,
  WORKSPACE_PRIMARY_MIN_WIDTH,
  workspaceSidePanelLimit,
} from '../src/lib/workspace-layout';
import { SIDE_PANEL_WIDTH_MIN } from '../src/lib/side-panel-width';

/**
 * P2-B 回归：1024×768 最小窗口不走 compact 时，balanced 布局预算会横向溢出。
 *
 * 背景：早期 WORKSPACE_COMPACT_BREAKPOINT = 48+220+420+320 = 1008。这意味着
 * [1008, 1024) 区间（含 Tauri `minWidth: 1024` 这个真实存在）不会触发 compact，
 * 但 balanced 布局此时：48(活动栏) + 236(侧栏被 clamp) + 384(Agent) = 668，
 * 剩给主区 356px < WORKSPACE_PRIMARY_MIN_WIDTH(420)。若主区仍守 420 最小宽，
 * 整行 48+236+420+384 = 1088 > 1024，就是横向溢出。
 *
 * 修复：把断点提到 >= 1024，确保 1024×768 最小窗口必定走 compact，
 * 由 compact 派生 editor/chat 直接绕开 balanced 溢出路径。
 */
test('compact 断点不得低于 Tauri 窗口 minWidth 1024', () => {
  // 若未来有人把断点改回纯组件和（1008），1024×768 最小窗口又会回到溢出路径。
  assert.ok(
    WORKSPACE_COMPACT_BREAKPOINT >= 1024,
    `断点 ${WORKSPACE_COMPACT_BREAKPOINT} 低于 1024，会在最小窗口留下横向溢出死区`,
  );
});

test('compact 断点应等于组件最小和与 1024 的较大者', () => {
  const componentsSum =
    ACTIVITY_BAR_WIDTH +
    SIDE_PANEL_WIDTH_MIN +
    WORKSPACE_PRIMARY_MIN_WIDTH +
    ASSISTANT_PANEL_MIN_WIDTH;
  assert.strictEqual(WORKSPACE_COMPACT_BREAKPOINT, Math.max(componentsSum, 1024));
});

test('1024px 视口 balanced 实际占用会超过视口，必须走 compact', () => {
  // 这条断言揭示「为何 1024 必须走 compact」：
  // workspaceSidePanelLimit 只保证「活动栏 + 侧栏 + 主区最小 + Agent 最小」四项之和 <= 视口，
  // 但真实渲染用 ASSISTANT_PANEL_WIDTH(384) 而非其最小宽(320)，两者差 64px。
  // 于是 1024 下：48 + sidebarLimit(236) + 420(主区最小) + 384(Agent 实际) = 1088 > 1024。
  const viewport = 1024;
  const sidebar = workspaceSidePanelLimit(viewport, 'balanced');
  const actualTotal =
    ACTIVITY_BAR_WIDTH + sidebar + WORKSPACE_PRIMARY_MIN_WIDTH + ASSISTANT_PANEL_WIDTH;
  assert.ok(
    actualTotal > viewport,
    `1024px 视口 balanced 实际占用 ${actualTotal}px 未超过 ${viewport}px，这条测试的前提已变`,
  );
  // 因此断点必须 >= 1024，确保最大窗口也走 compact 绕开这条溢出路径。
  assert.ok(
    WORKSPACE_COMPACT_BREAKPOINT >= viewport,
    `断点必须 >= ${viewport}，否则 1024×768 最小窗口会落进溢出路径`,
  );
});
