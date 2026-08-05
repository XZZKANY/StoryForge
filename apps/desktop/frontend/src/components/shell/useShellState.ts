/**
 * 壳子布局状态：正交状态，不用耦合 focus 模式。
 * - view：活动栏当前视图（book 作品 / manuscript 手稿 / explorer 资源管理器 / search 全文搜索
 *   / observatory 世界线观测镜），顺序即写作顺序，见 SIDE_PANEL_VIEWS
 * - sidebarHidden：侧面板整体折叠（Ctrl+B 或点当前激活图标）
 * - layoutMode（Q4 布局三态）：editor 编辑聚焦（右栏隐藏，编辑占满）/ balanced 平衡（编辑 + 384 右栏）
 *   / chat 对话聚焦（编辑隐藏，右栏占满中右）。Ctrl+1/2/3 与对话头就地控件切换。
 * 右栏现在只有对话（观测镜已迁左栏），故不再有 rightView。
 * rightCollapsed 由 layoutMode 派生（= editor），供顶栏收起键与右栏挂载判定复用。
 */
import { useCallback, useState } from 'react';

export type SidePanelView =
  | 'book'
  | 'manuscript'
  | 'explorer'
  | 'knowledge'
  | 'search'
  | 'observatory';
export type LayoutMode = 'editor' | 'balanced' | 'chat';

/**
 * 左栏视图顺序 = 写作顺序：立项（作品）→ 写哪一章（手稿）→ 翻文件（资源管理器）
 * → 回头查（搜索）→ 校事实（观测镜）。此前是按工具类型排的，作者从「我要开一本书」
 * 到「我在写第 40 章」这条线在左栏读不出来。
 *
 * 活动栏图标顺序必须与此一致，由 tests/shell-panel-views.test.tsx 护住。
 */
export const SIDE_PANEL_VIEWS: SidePanelView[] = [
  'book',
  'manuscript',
  'explorer',
  'knowledge',
  'search',
  'observatory',
];

export function useShellState() {
  const [view, setView] = useState<SidePanelView>('explorer');
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('balanced');
  // 项目仪表盘：打开项目时默认显示，点"开始写作"后隐藏进入编辑器。
  const [dashboardVisible, setDashboardVisible] = useState(false);

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

  // 右栏在 editor 布局被隐藏；chat 布局下右栏其实占满，不算折叠。
  const rightCollapsed = layoutMode === 'editor';
  // 顶栏「收起/展开 Agent 面板」在 编辑↔平衡 之间切；从 chat 收起也落回 editor。
  const toggleRight = useCallback(
    () => setLayoutMode((mode) => (mode === 'editor' ? 'balanced' : 'editor')),
    [],
  );
  // 「确保右栏可见」：editor→balanced；balanced/chat 保持（右栏已在场）。
  const showRight = useCallback(
    () => setLayoutMode((mode) => (mode === 'editor' ? 'balanced' : mode)),
    [],
  );
  // 「确保中栏（编辑 / 补丁面板）可见」：chat 聚焦态隐藏中栏 → 落回 balanced；editor/balanced 保持。
  const showCenter = useCallback(
    () => setLayoutMode((mode) => (mode === 'chat' ? 'balanced' : mode)),
    [],
  );

  // Ctrl+4 / 对话头雷达图标：切左栏观测镜视图。左栏折叠时先展开并直落观测镜；
  // 已在观测镜且面板可见则收起（与 switchView 同一 VS Code 语义）。
  const toggleObservatory = useCallback(() => {
    switchView('observatory');
  }, [switchView]);

  // 从观测镜回资源管理器（观测镜头部「回到文件」）。
  const showExplorerView = useCallback(() => {
    setSidebarHidden(false);
    setView('explorer');
  }, []);

  // 显示项目仪表盘：打开项目时自动调用。
  const showDashboard = useCallback(() => {
    setDashboardVisible(true);
  }, []);

  // 隐藏仪表盘进入编辑器：点"开始写作"时调用。
  const hideDashboard = useCallback(() => {
    setDashboardVisible(false);
  }, []);

  return {
    view,
    sidebarHidden,
    layoutMode,
    rightCollapsed,
    dashboardVisible,
    switchView,
    toggleSidebar,
    showSidebar,
    setLayoutMode,
    toggleRight,
    showRight,
    showCenter,
    toggleObservatory,
    showExplorerView,
    showDashboard,
    hideDashboard,
  };
}
