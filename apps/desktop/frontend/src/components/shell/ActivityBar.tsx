/**
 * 活动栏：48px 图标 rail，壳子框架始终在场（连窄窗都留），并保留作扩展位。
 * Q8 精简：上排只留 文件 / 搜索；底部只留 设置。
 * 会话已移入右栏对话头（Q5），质检收到状态栏观测芯片 + 底部观测面板，
 * 命令面板走顶栏搜索框（Ctrl+P），不再在 rail 上单列图标。
 * 激活指示条贴 rail 左缘；未打开项目时搜索变暗。
 */
import type { SidePanelView } from './useShellState';
import { FileText, Search, Settings } from '../icons/shell-icons';
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
