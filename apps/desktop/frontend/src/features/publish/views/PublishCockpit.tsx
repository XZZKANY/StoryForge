import { OpenAssistWizard } from '../assist/OpenAssistWizard';
import { usePublishCockpit } from '../hooks/usePublishCockpit';
import { PUBLISH_TABS } from './types';
import { Stat } from './ui';
import {
  AccountsTab,
  AssignTab,
  CalendarTab,
  DailyTab,
  PipelineTab,
  ReviewTab,
  SettingsTab,
} from './tabs';

export type PublishCockpitProps = {
  projectPath: string | null;
  /** sidebar=左栏功能块（默认）；page=旧中栏整页（兼容） */
  variant?: 'sidebar' | 'page';
  onClose?: () => void;
};

/**
 * 发行驾驶舱壳：状态与动作在 usePublishCockpit，Tab UI 在 views/tabs。
 * 壳层只负责布局与入口按钮。
 */
export function PublishCockpit({
  projectPath,
  variant = 'sidebar',
  onClose,
}: PublishCockpitProps) {
  const api = usePublishCockpit(projectPath);
  const compact = variant === 'sidebar';

  return (
    <div
      className={`flex h-full min-h-0 flex-col text-foreground ${compact ? 'bg-panel' : 'bg-background'}`}
      data-testid="publish-cockpit"
      data-variant={variant}
    >
      <header
        className={`flex flex-wrap items-center gap-1 border-b border-border ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}
      >
        <h1 className={`font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>发行</h1>
        <span className="text-[10px] text-subtle">{api.yearMonth}</span>
        <div className="flex-1" />
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
          onClick={() => void api.jumpPlatformLogin()}
          title="系统浏览器跳转平台登录/作者页（不代登、不存密码）"
        >
          登录
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
          onClick={() => void api.jumpAuthorHome()}
          title="打开作者后台"
        >
          后台
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
          onClick={() => void api.handleAddCurrentProject()}
          title="将当前项目加入发布库"
        >
          入库
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
          onClick={() => void api.handleCreateSlot()}
        >
          占坑
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
          onClick={() => void api.refreshReadyScores()}
        >
          Ready
        </button>
        {onClose && variant === 'page' && (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] hover:bg-elevated"
            onClick={onClose}
          >
            关闭
          </button>
        )}
      </header>

      <div className="flex flex-wrap gap-0.5 border-b border-border px-1 py-1">
        {PUBLISH_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`publish-tab-${t.id}`}
            className={`rounded px-1.5 py-0.5 text-[10px] ${api.tab === t.id ? 'bg-elevated text-foreground' : 'text-subtle hover:bg-elevated/60'}`}
            onClick={() => api.setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {api.message && (
        <div className="border-b border-border bg-elevated/40 px-3 py-1 text-xs">
          {api.message}
        </div>
      )}

      <div className={`min-h-0 flex-1 overflow-auto text-sm ${compact ? 'p-2' : 'p-3'}`}>
        <div
          className={`mb-2 grid gap-1.5 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}
        >
          <Stat label="目标" value={String(api.settings.monthlyOpenTarget)} />
          <Stat label="理论产能" value={String(api.capacity.theory)} />
          <Stat label="spare" value={String(api.capacity.spare)} warn={api.capacity.spareWarn} />
          <Stat label="目标缺口" value={String(api.gap)} warn={api.gap > 0} />
        </div>

        {api.tab === 'daily' && <DailyTab api={api} />}
        {api.tab === 'pipeline' && <PipelineTab api={api} />}
        {api.tab === 'calendar' && <CalendarTab api={api} />}
        {api.tab === 'accounts' && <AccountsTab api={api} />}
        {api.tab === 'assign' && <AssignTab api={api} />}
        {api.tab === 'review' && <ReviewTab api={api} />}
        {api.tab === 'settings' && <SettingsTab api={api} />}
      </div>

      {api.assistBook && (
        <OpenAssistWizard
          book={api.assistBook}
          accounts={api.accounts}
          onClose={() => api.setAssistBookKey(null)}
          onConfirmOpened={api.markOpened}
          onFlash={api.flash}
        />
      )}
    </div>
  );
}
