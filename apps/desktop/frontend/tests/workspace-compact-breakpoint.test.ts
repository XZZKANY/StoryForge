import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  ACTIVITY_BAR_WIDTH,
  ASSISTANT_PANEL_MIN_WIDTH,
  resolveWorkspaceColumns,
  WORKSPACE_COMPACT_BREAKPOINT,
  WORKSPACE_PRIMARY_MIN_WIDTH,
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

test('不走 compact 的任何窗口宽，平衡态两栏加编辑区硬下限都放得下（不横向溢出）', () => {
  // 早先对话栏死宽 384，1024 平衡态要 48+236+420+384=1088 > 1024，只能靠 compact 绕开；
  // 三栏改成按比例换算 + 编辑区保底后，任何宽度、连手改设置的极端比例都必须放得下。
  const prefsList = [
    { sideRatio: null, assistantRatio: null },
    { sideRatio: 0.9, assistantRatio: 0.9 },
    { sideRatio: 0.01, assistantRatio: 0.01 },
  ];
  for (let viewport = WORKSPACE_COMPACT_BREAKPOINT; viewport <= 3840; viewport += 7) {
    for (const prefs of prefsList) {
      for (const sidebar of [true, false]) {
        const { side, assistant } = resolveWorkspaceColumns(viewport, 'balanced', sidebar, prefs);
        const total = ACTIVITY_BAR_WIDTH + side + assistant + WORKSPACE_PRIMARY_MIN_WIDTH;
        assert.ok(
          total <= viewport,
          `${viewport}px 平衡态占用 ${total}px 溢出（side=${side} assistant=${assistant} ${JSON.stringify(prefs)}）`,
        );
      }
    }
  }
});
