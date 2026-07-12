/**
 * 壳子布局状态：取代旧 useShellLayout 的 5 个耦合 focus 模式，改为正交状态。
 * - view：活动栏当前视图（Q8 精简后只剩 文件 / 搜索；会话已移入右栏对话头，质检收到状态栏观测芯片）
 * - sidebarHidden：侧面板整体折叠（Ctrl+B 或点当前激活图标）
 * - rightCollapsed：右栏 Agent 面板折叠
 * 三者互不耦合，直接映射原型的 VS Code 式两层左栏 + 固定三栏。
 */
import { useCallback, useState } from 'react';

export type SidePanelView = 'explorer' | 'search';

export const SIDE_PANEL_VIEWS: SidePanelView[] = ['explorer', 'search'];

export function useShellState() {
  const [view, setView] = useState<SidePanelView>('explorer');
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  // 点活动栏图标：切到该视图；若点的正是当前视图且面板可见，则收起（VS Code 行为）。
  const switchView = useCallback(
    (next: SidePanelView) => {
      setSidebarHidden((hidden) => {
        if (next === view && !hidden) return true;
        return false;
      });
      setView(next);
    },
    [view],
  );

  const toggleSidebar = useCallback(() => setSidebarHidden((hidden) => !hidden), []);
  const showSidebar = useCallback(() => setSidebarHidden(false), []);
  const toggleRight = useCallback(() => setRightCollapsed((collapsed) => !collapsed), []);
  const showRight = useCallback(() => setRightCollapsed(false), []);

  return {
    view,
    sidebarHidden,
    rightCollapsed,
    switchView,
    toggleSidebar,
    showSidebar,
    toggleRight,
    showRight,
  };
}
