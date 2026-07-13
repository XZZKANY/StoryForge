import { useEffect, useState } from 'react';
import { OpenAssistWizard } from '../assist/OpenAssistWizard';
import { usePublishCockpit } from '../hooks/usePublishCockpit';
import { PUBLISH_TABS } from './types';
import {
  CapacitySummary,
  FlashBar,
  OnboardingGuide,
  ToolbarBtn,
} from './ui';
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

const STATS_TABS = new Set(['daily', 'pipeline', 'assign', 'review']);

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
  const [statsExpanded, setStatsExpanded] = useState(false);
  const showStats = STATS_TABS.has(api.tab);

  const setTab = api.setTab;
  // 数字 1–7 切换发行 Tab（不抢输入框焦点）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= PUBLISH_TABS.length) {
        e.preventDefault();
        setTab(PUBLISH_TABS[n - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab]);

  return (
    <div
      className={`flex h-full min-h-0 flex-col text-foreground ${compact ? 'bg-panel' : 'bg-background'}`}
      data-testid="publish-cockpit"
      data-variant={variant}
    >
      <header className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-border px-2">
        <h1 className="text-[12px] font-semibold tracking-tight">发行</h1>
        <span className="text-[10px] text-subtle">{api.yearMonth}</span>
        <div className="flex-1" />
        <ToolbarBtn onClick={() => void api.loginViaWebView()} title="内嵌 WebView 登录">
          登录
        </ToolbarBtn>
        <ToolbarBtn onClick={() => void api.jumpAuthorHome()} title="打开作者后台">
          后台
        </ToolbarBtn>
        <ToolbarBtn onClick={() => void api.handleAddCurrentProject()} title="将当前项目加入发布库">
          入库
        </ToolbarBtn>
        <ToolbarBtn onClick={() => void api.handleCreateSlot()}>占坑</ToolbarBtn>
        <ToolbarBtn
          onClick={() => void api.refreshReadyScores()}
          title="扫描可开分（Ready）"
        >
          可开分
        </ToolbarBtn>
        {onClose && variant === 'page' && (
          <ToolbarBtn onClick={onClose}>关闭</ToolbarBtn>
        )}
      </header>

      <div
        className="flex flex-shrink-0 gap-0.5 overflow-x-auto border-b border-border px-1.5 py-1"
        role="tablist"
        aria-label="发行视图（数字键 1–7 切换）"
      >
        {PUBLISH_TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={api.tab === t.id}
            data-testid={`publish-tab-${t.id}`}
            title={`${t.label} · ${i + 1}`}
            className={`h-7 flex-shrink-0 rounded-md px-2 text-[11px] whitespace-nowrap transition-colors ${
              api.tab === t.id
                ? 'bg-elevated font-medium text-foreground'
                : 'text-subtle hover:bg-elevated/60 hover:text-foreground'
            }`}
            onClick={() => api.setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {api.message && (
        <FlashBar message={api.message} onDismiss={api.dismissFlash} />
      )}

      <div className={`min-h-0 flex-1 overflow-auto ${compact ? 'p-2' : 'p-3'}`}>
        <OnboardingGuide
          hasAccounts={api.accounts.length > 0}
          hasBooks={api.books.length > 0}
          onGoAccounts={() => api.setTab('accounts')}
          onAddProject={() => void api.handleAddCurrentProject()}
          onCreateSlot={() => void api.handleCreateSlot()}
        />

        {showStats && (
          <CapacitySummary
            target={api.settings.monthlyOpenTarget}
            theory={api.capacity.theory}
            spare={api.capacity.spare}
            gap={api.gap}
            spareWarn={api.capacity.spareWarn}
            expanded={statsExpanded}
            onToggle={() => setStatsExpanded((v) => !v)}
          />
        )}

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
