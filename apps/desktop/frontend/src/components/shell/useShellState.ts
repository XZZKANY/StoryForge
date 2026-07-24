/**
 * 壳子布局状态：取代旧 useShellLayout 的 5 个耦合 focus 模式，改为正交状态。
 * - view：活动栏当前视图（文件 / 搜索；会话在右栏，质检在状态栏）
 * - sidebarHidden：侧面板整体折叠（Ctrl+B 或点当前激活图标）
 * - layoutMode（Q4 布局三态）：editor 编辑聚焦（右栏隐藏，编辑占满）/ balanced 平衡（编辑 + 384 右栏）
 *   / chat 对话聚焦（编辑隐藏，右栏占满中右）。Ctrl+1/2/3 与对话头就地控件切换。
 * - rightView：右栏当前视图（chat 对话 / observatory 世界线观测镜，Ctrl+4 或头部图标切换）。
 *   两视图 CSS 互斥不卸载（对话在途 run 状态不能因切视图丢失）。
 * rightCollapsed 由 layoutMode 派生（= editor），供顶栏收起键与右栏挂载判定复用。
 */
import { useCallback, useState } from 'react';

export type SidePanelView = 'explorer' | 'search';
export type LayoutMode = 'editor' | 'balanced' | 'chat';
export type RightPanelView = 'chat' | 'observatory';

export const SIDE_PANEL_VIEWS: SidePanelView[] = ['explorer', 'search'];

export function useShellState() {
  const [view, setView] = useState<SidePanelView>('explorer');
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('balanced');
  const [rightView, setRightView] = useState<RightPanelView>('chat');

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

  // Ctrl+4 / 头部雷达图标：右栏隐藏时先展开并直落观测镜；可见时在对话↔观测镜间切换。
  const toggleObservatory = useCallback(() => {
    if (layoutMode === 'editor') {
      setLayoutMode('balanced');
      setRightView('observatory');
      return;
    }
    setRightView((current) => (current === 'observatory' ? 'chat' : 'observatory'));
  }, [layoutMode]);

  const showChatView = useCallback(() => setRightView('chat'), []);

  return {
    view,
    sidebarHidden,
    layoutMode,
    rightCollapsed,
    rightView,
    switchView,
    toggleSidebar,
    showSidebar,
    setLayoutMode,
    toggleRight,
    showRight,
    showCenter,
    toggleObservatory,
    showChatView,
  };
}
