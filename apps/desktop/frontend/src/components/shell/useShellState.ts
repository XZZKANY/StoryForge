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
import { useCallback, useEffect, useState } from 'react';

export type SidePanelView =
  | 'book'
  | 'manuscript'
  | 'explorer'
  | 'knowledge'
  | 'search'
  | 'observatory';
export type LayoutMode = 'editor' | 'balanced' | 'chat';

const STORAGE_KEY_VIEW = 'storyforge:shell:view';
const STORAGE_KEY_LAYOUT = 'storyforge:shell:layoutMode';
const STORAGE_KEY_SIDEBAR = 'storyforge:shell:sidebarHidden';

function readStoredView(): SidePanelView {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_VIEW);
    if (stored && SIDE_PANEL_VIEWS.includes(stored as SidePanelView)) {
      return stored as SidePanelView;
    }
  } catch {
    // localStorage 不可用时静默回退
  }
  return 'explorer';
}

function readStoredLayoutMode(): LayoutMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_LAYOUT);
    if (stored === 'editor' || stored === 'balanced' || stored === 'chat') {
      return stored;
    }
  } catch {
    // localStorage 不可用时静默回退
  }
  return 'balanced';
}

function readStoredSidebarHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_SIDEBAR) === 'true';
  } catch {
    return false;
  }
}

/** 测试与首启重置用：清掉持久化的壳子视图偏好，回到出厂默认。 */
export function resetShellStateStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_VIEW);
    localStorage.removeItem(STORAGE_KEY_LAYOUT);
    localStorage.removeItem(STORAGE_KEY_SIDEBAR);
  } catch {
    // localStorage 不可用时静默回退
  }
}

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
  const [view, setView] = useState<SidePanelView>(readStoredView);
  const [sidebarHidden, setSidebarHidden] = useState(readStoredSidebarHidden);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(readStoredLayoutMode);

  // 持久化状态变化
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_VIEW, view);
    } catch {
      // 静默失败
    }
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_LAYOUT, layoutMode);
    } catch {
      // 静默失败
    }
  }, [layoutMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SIDEBAR, String(sidebarHidden));
    } catch {
      // 静默失败
    }
  }, [sidebarHidden]);

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

  // Ctrl Shift O / 对话头雷达图标：切左栏观测镜视图。左栏折叠时先展开并直落观测镜；
  // 已在观测镜且面板可见则收起（与 switchView 同一 VS Code 语义）。
  const toggleObservatory = useCallback(() => {
    switchView('observatory');
  }, [switchView]);

  // 从观测镜回资源管理器（观测镜头部「回到文件」）。
  const showExplorerView = useCallback(() => {
    setSidebarHidden(false);
    setView('explorer');
  }, []);

  return {
    view,
    sidebarHidden,
    layoutMode,
    rightCollapsed,
    switchView,
    toggleSidebar,
    showSidebar,
    setLayoutMode,
    toggleRight,
    showRight,
    showCenter,
    toggleObservatory,
    showExplorerView,
  };
}
