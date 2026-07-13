/**
 * 活动栏：48px 图标 rail。
 * 上排：文件 / 搜索 / 发行；底部：设置。
 * 会话在右栏，质检在状态栏；命令面板 Ctrl+P。
 * 激活指示条贴 rail 左缘；未打开项目时「搜索」变暗（发行全局可用）。
 */
import type { SidePanelView } from './useShellState';
import { FileText, Search, Settings, Flag } from '../icons/shell-icons';
import type { LucideIcon } from '../icons/shell-icons';

type ViewEntry = {
  view: SidePanelView;
  icon: LucideIcon;
  title: string;
  projectOnly?: boolean;
};

const VIEW_ENTRIES: ViewEntry[] = [
  { view: 'explorer', icon: FileText, title: '故事文件 · Ctrl+Shift+E' },
  { view: 'search', icon: Search, title: '搜索 · Ctrl+Shift+F', projectOnly: true },
  { view: 'publish', icon: Flag, title: '发行 · Ctrl+Shift+P 后选 Publish' },
];

export function ActivityBar({
  view,
  sidebarHidden,
  noProject,
  onSwitchView,
  onOpenSettings,
}: {
  view: SidePanelView;
  sidebarHidden: boolean;
  noProject: boolean;
  onSwitchView: (view: SidePanelView) => void;
  onOpenSettings: () => void;
}) {
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
        onClick={onOpenSettings}
      >
        <Settings size={18} strokeWidth={1.6} />
      </button>
    </nav>
  );
}
