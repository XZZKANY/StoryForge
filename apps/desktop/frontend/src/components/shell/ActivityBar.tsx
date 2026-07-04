/**
 * 活动栏：48px 图标 rail，壳子框架始终在场（连窄窗都留）。
 * 上：故事 / 搜索 / 会话（agent 紫）/ 质检（badge）；底：命令面板 / 设置。
 * 激活指示条贴 rail 左缘；未打开项目时会话/搜索/质检变暗。
 */
import type { SidePanelView } from './useShellState';
import { Command, FileText, Flag, Search, Settings, Sparkles } from '../icons/shell-icons';
import type { LucideIcon } from '../icons/shell-icons';

type ViewEntry = {
  view: SidePanelView;
  icon: LucideIcon;
  title: string;
  agent?: boolean;
  projectOnly?: boolean;
};

const VIEW_ENTRIES: ViewEntry[] = [
  { view: 'explorer', icon: FileText, title: '故事文件 · Ctrl+Shift+E' },
  { view: 'search', icon: Search, title: '搜索 · Ctrl+Shift+F', projectOnly: true },
  {
    view: 'sessions',
    icon: Sparkles,
    title: '会话 · Ctrl+Shift+C',
    agent: true,
    projectOnly: true,
  },
  { view: 'qa', icon: Flag, title: '质检观测 · Ctrl+Shift+M', projectOnly: true },
];

export function ActivityBar({
  view,
  sidebarHidden,
  noProject,
  qaBadge,
  onSwitchView,
  onOpenPalette,
  onOpenSettings,
}: {
  view: SidePanelView;
  sidebarHidden: boolean;
  noProject: boolean;
  qaBadge: number;
  onSwitchView: (view: SidePanelView) => void;
  onOpenPalette: () => void;
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
              active
                ? entry.agent
                  ? 'text-agent'
                  : 'text-foreground'
                : 'text-subtle hover:text-foreground'
            } ${dimmed ? 'opacity-30' : ''}`}
            title={entry.title}
            onClick={() => {
              if (dimmed) return;
              onSwitchView(entry.view);
            }}
          >
            {active && (
              <span
                className={`absolute -left-1 bottom-2 top-2 w-0.5 rounded-r ${
                  entry.agent ? 'bg-agent' : 'bg-foreground'
                }`}
              />
            )}
            <Icon size={19} strokeWidth={1.6} />
            {entry.view === 'qa' && qaBadge > 0 && !noProject && (
              <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-agent px-1 text-[9px] leading-none text-white">
                {qaBadge}
              </span>
            )}
          </button>
        );
      })}

      <div className="flex-1" />

      <button
        className="flex h-10 w-10 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-elevated hover:text-foreground"
        title="命令面板 · Ctrl+P"
        onClick={onOpenPalette}
      >
        <Command size={18} strokeWidth={1.6} />
      </button>
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
