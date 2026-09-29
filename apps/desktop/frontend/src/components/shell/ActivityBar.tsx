/**
 * 活动栏：48px 图标 rail，三段层级一眼可读——
 *   主入口（作品 / 手稿，写作动线的起点）→ 组间大留白 →
 *   功能入口（资源 / 收件箱 / 搜索 / 观测镜）→ 弹性留白 → 底部设置。
 * 组内图标等距（gap-0.5），组间用留白分隔（不画线，与三栏去线同色台阶策略一致）。
 * 当前视图：克制满底色高亮（bg-elevated）；非当前 hover 只到 60% 同档色，
 * 使「当前页」与「手滑过」在视觉上永远可区分。
 * rail 本体是一级导航、贯穿全高的底层背景：画布档底色（bg-background），自身无圆角、
 * 无凸出；右侧二级面板以上层圆角（左缘 rounded-l-xl + 横向软影）覆盖在它上方，
 * 分区靠「面板收进圆角、切口露出 rail 底色」表达，不画竖线。
 * 会话在右栏，质检在状态栏；文件名搜索走顶栏命令面板 Ctrl+P，正文内容搜索走这里的搜索视图。
 */
import { useState, type ReactNode, type RefObject } from 'react';
import { ACTIVITY_BAR_WIDTH } from '../../lib/workspace-layout';
import type { SidePanelView } from './useShellState';
import { BookOpen, FileText, Inbox, Library, Radar, Search, Settings } from '../icons/shell-icons';
import type { LucideIcon } from '../icons/shell-icons';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

type ViewEntry = {
  view: SidePanelView;
  icon: LucideIcon;
  title: string;
  /** 屏幕阅读器读的名字：不含快捷键，快捷键留在视觉 tooltip（title）里，否则会被念成名字。 */
  label: string;
  /** 主入口：写作动线起点，与其余功能入口之间用大留白分组。 */
  primary?: boolean;
  projectOnly?: boolean;
};

/** 顺序 = 写作顺序，与 useShellState 的 SIDE_PANEL_VIEWS 逐项对齐（有护栏）。 */
export const VIEW_ENTRIES: ViewEntry[] = [
  {
    view: 'book',
    icon: Library,
    title: '作品（封面 / 简介 / 进度）· Ctrl Shift B',
    label: '作品',
    primary: true,
    projectOnly: true,
  },
  {
    view: 'manuscript',
    icon: BookOpen,
    title: '手稿（阅读序 / 作品底座）· Ctrl Shift M',
    label: '手稿',
    primary: true,
    projectOnly: true,
  },
  { view: 'explorer', icon: FileText, title: '资源管理器 · Ctrl Shift E', label: '资源管理器' },
  {
    view: 'knowledge',
    icon: Inbox,
    title: '知识收件箱 · Ctrl Shift I',
    label: '知识库收件箱',
    projectOnly: true,
  },
  {
    view: 'search',
    icon: Search,
    title: '在正文中搜索 · Ctrl Shift F',
    label: '搜索',
    projectOnly: true,
  },
  {
    view: 'observatory',
    icon: Radar,
    title: '世界线观测镜 · Ctrl Shift O',
    label: '观测镜',
    projectOnly: true,
  },
];

export function ActivityBar({
  view,
  sidebarHidden,
  onSwitchView,
  onOpenSettings,
  settingsMenu,
  settingsButtonRef,
  observatoryAttention = false,
  knowledgePendingCount = 0,
}: {
  view: SidePanelView;
  sidebarHidden: boolean;
  onSwitchView: (view: SidePanelView) => void;
  onOpenSettings: () => void;
  // 齿轮小菜单项；不传则齿轮直接开设置（回退）。
  settingsMenu?: ContextMenuItem[];
  settingsButtonRef?: RefObject<HTMLButtonElement>;
  // 光标行提到 canon 实体时观测镜图标亮小紫点。
  observatoryAttention?: boolean;
  knowledgePendingCount?: number;
}) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const renderViewButton = (entry: ViewEntry): ReactNode => {
    const active = view === entry.view && !sidebarHidden;
    const Icon = entry.icon;
    return (
      <button
        key={entry.view}
        data-testid={`activity-${entry.view}`}
        data-active={active}
        className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
          active
            ? 'bg-elevated text-foreground'
            : 'text-subtle hover:bg-elevated/60 hover:text-foreground active:bg-border-strong/40'
        }`}
        aria-label={entry.label}
        // 视图图标是互斥选择（同时只有一个是当前视图），不是各自独立的开关：
        // aria-pressed 表达不了「按下这个就松开那个」，aria-current 的「集合中的当前项」才准确。
        aria-current={active ? 'true' : undefined}
        title={entry.title}
        onClick={() => {
          onSwitchView(entry.view);
        }}
      >
        <Icon size={19} strokeWidth={1.6} />
        {entry.view === 'observatory' && observatoryAttention && (
          <span
            className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-agent"
            data-testid="activity-observatory-attention"
          />
        )}
        {entry.view === 'knowledge' && knowledgePendingCount > 0 && (
          <span
            className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-agent px-1 text-center font-mono text-3xs leading-4 text-agent-foreground"
            data-testid="activity-knowledge-badge"
          >
            {knowledgePendingCount > 99 ? '99+' : knowledgePendingCount}
          </span>
        )}
      </button>
    );
  };

  const mainEntries = VIEW_ENTRIES.filter((entry) => entry.primary);
  const toolEntries = VIEW_ENTRIES.filter((entry) => !entry.primary);

  return (
    <nav
      className="flex flex-shrink-0 flex-col items-center gap-0.5 bg-background py-1.5"
      style={{ width: ACTIVITY_BAR_WIDTH }}
      data-testid="shell-activity-bar"
    >
      {mainEntries.map(renderViewButton)}

      {/* 组间留白：主入口 ↔ 功能入口，不靠分隔线（与三栏去线策略一致）。 */}
      <div className="h-2.5" aria-hidden="true" data-testid="activity-group-gap" />

      {toolEntries.map(renderViewButton)}

      <div className="flex-1" />

      <button
        ref={settingsButtonRef}
        data-testid="activity-settings"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-elevated/60 hover:text-foreground active:bg-border-strong/40"
        title="设置 · Ctrl ,"
        aria-label="设置"
        aria-haspopup="menu"
        onClick={(event) => {
          if (settingsMenu && settingsMenu.length > 0) {
            // 菜单开着时再点齿轮是「关」：pointerdown 落在 trigger 上不算 outside-dismiss，
            // 必须由 click 自己 toggle，否则永远无法点齿轮关菜单。
            if (menuPos) {
              setMenuPos(null);
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            setMenuPos({ x: rect.right + 6, y: rect.top });
          } else {
            onOpenSettings();
          }
        }}
      >
        <Settings size={18} strokeWidth={1.6} />
      </button>

      {menuPos && settingsMenu && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={settingsMenu}
          onClose={() => setMenuPos(null)}
          triggerRef={settingsButtonRef}
        />
      )}
    </nav>
  );
}
