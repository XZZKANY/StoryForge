/**
 * 活动栏：48px 图标 rail。
 * 上排：视图图标（文件 …）；底部：设置齿轮——点开小菜单（命令面板 / 设置 / 快捷键 / 主题 / 关于，#15）。
 * 会话在右栏，质检在状态栏；文件搜索走顶栏命令面板 Ctrl+P。
 * 激活指示条贴 rail 左缘。
 */
import { useState } from 'react';
import type { SidePanelView } from './useShellState';
import { FileText, Settings } from '../icons/shell-icons';
import type { LucideIcon } from '../icons/shell-icons';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

type ViewEntry = {
  view: SidePanelView;
  icon: LucideIcon;
  title: string;
  projectOnly?: boolean;
};

const VIEW_ENTRIES: ViewEntry[] = [
  { view: 'explorer', icon: FileText, title: '资源管理器 · Ctrl+Shift+E' },
];

export function ActivityBar({
  view,
  sidebarHidden,
  noProject,
  onSwitchView,
  onOpenSettings,
  settingsMenu,
}: {
  view: SidePanelView;
  sidebarHidden: boolean;
  noProject: boolean;
  onSwitchView: (view: SidePanelView) => void;
  onOpenSettings: () => void;
  // 齿轮小菜单项；不传则齿轮直接开设置（回退）。
  settingsMenu?: ContextMenuItem[];
}) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  return (
    <nav
      className="flex w-12 flex-shrink-0 flex-col items-center gap-0.5 border-r border-border bg-background py-1.5"
      data-testid="shell-activity-bar"
    >
      {VIEW_ENTRIES.map((entry) => {
        const active = view === entry.view && !sidebarHidden;
        const dimmed = noProject && entry.projectOnly;
        const Icon = entry.icon;
        return (
          <button
            key={entry.view}
            data-testid={`activity-${entry.view}`}
            data-active={active}
            className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-elevated ${
              active ? 'text-foreground' : 'text-subtle hover:text-foreground'
            } ${dimmed ? 'opacity-30' : ''}`}
            title={entry.title}
            onClick={() => {
              if (dimmed) return;
              onSwitchView(entry.view);
            }}
          >
            {active && (
              <span className="absolute -left-1 bottom-2 top-2 w-0.5 rounded-r bg-foreground" />
            )}
            <Icon size={19} strokeWidth={1.6} />
          </button>
        );
      })}

      <div className="flex-1" />

      <button
        data-testid="activity-settings"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-elevated hover:text-foreground"
        title="设置 · Ctrl+,"
        aria-haspopup="menu"
        onClick={(event) => {
          if (settingsMenu && settingsMenu.length > 0) {
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
        />
      )}
    </nav>
  );
}
