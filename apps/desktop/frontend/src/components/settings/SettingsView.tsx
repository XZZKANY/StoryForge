import { ModalDialog, Button, Input } from '../ui';
import { AppDialogHost, useAppDialog } from '../app/AppDialog';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  DEFAULT_APP_SETTINGS,
  sanitizeAppSettings,
  type AppSettings,
  type EditorLineNumbersMode,
} from '../../lib/user-settings';
import { Info, Palette, Puzzle, Sparkles, Type } from '../icons/shell-icons';
import { PROSE_MEASURE_LABELS, PROSE_MEASURE_ORDER, type ProseMeasure } from '../editor/options';
import { useModelProfiles } from './useModelProfiles';
import { ModelProfilesSection } from './ModelProfilesSection';
import { AppearanceSection } from './AppearanceSection';
import { SettingsSearchContext, settingsTextMatches, useSettingsQuery } from './search-context';
import { usePlugins } from './usePlugins';
import { PluginsSection } from './PluginsSection';
import { takeRequestedSettingsSection } from '../../lib/settings-section';
import { AboutRows } from './AboutRows';
import {
  ActionRow,
  RangeRow,
  SelectRow,
  SettingCard,
  SettingDetails,
  SettingGroup,
  ToggleRow,
  UnsavedBadge,
} from './SettingRows';

type SettingsViewProps = {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
  fallbackFocusRef?: RefObject<HTMLElement>;
};

/**
 * 设置左栏锚点导航（纯锚点列表，「返回」不在里面）。整章润色用哪套模型并进了
 * 「模型服务」的「高级」，不再单列一组。
 */
const settingsNav = ['模型服务', '插件', '外观', '编辑器', '关于'] as const;

const LINE_NUMBER_OPTIONS: ReadonlyArray<{ value: EditorLineNumbersMode; label: string }> = [
  { value: 'auto', label: '智能（正文隐藏）' },
  { value: 'on', label: '总是显示' },
  { value: 'off', label: '总是隐藏' },
];

const FONT_MODE_OPTIONS: ReadonlyArray<{ value: 'grid' | 'prose'; label: string }> = [
  { value: 'grid', label: '格子（CJK 等宽对齐）' },
  { value: 'prose', label: '书稿（衬线比例字体）' },
];

const PROSE_MEASURE_OPTIONS: ReadonlyArray<{ value: ProseMeasure; label: string }> =
  PROSE_MEASURE_ORDER.map((value) => ({ value, label: PROSE_MEASURE_LABELS[value] }));

// 设置搜索：RowShell 按标题+描述自过滤，空查询显示全部。
export function SettingsView({ settings, onChange, onClose, fallbackFocusRef }: SettingsViewProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const safeSettings = sanitizeAppSettings(settings);
  const [searchQuery, setSearchQuery] = useState('');
  const models = useModelProfiles();
  const plugins = usePlugins();
  // 同一事件里连着改两项时，第二项要叠在第一项之上，不能都从同一份旧 props 出发。
  const latestRef = useRef(safeSettings);
  useLayoutEffect(() => {
    latestRef.current = safeSettings;
  });
  const update = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    latestRef.current = { ...latestRef.current, [key]: value };
    onChange(latestRef.current);
  };
  const resetSettings = () => {
    latestRef.current = DEFAULT_APP_SETTINGS;
    onChange(DEFAULT_APP_SETTINGS);
  };
  // 破坏性操作（移除已存密钥 / 恢复默认设置）先经 AppDialog 确认，不走静默直改。
  const confirmDialog = useAppDialog();
  const mainRef = useRef<HTMLElement | null>(null);
  // 从别处（对话头「上下文」的「管理插件」）打开设置时直接滚到那一组。
  const [requestedSection] = useState(takeRequestedSettingsSection);
  const [activeGroup, setActiveGroup] = useState<string>(requestedSection ?? 'provider');
  const scrollPendingRef = useRef(requestedSection);
  const modelsLoaded = models.loadState !== 'loading';
  useEffect(() => {
    const anchor = scrollPendingRef.current;
    if (!anchor) return;
    mainRef.current?.querySelector(`#${anchor}`)?.scrollIntoView?.({ block: 'start' });
    // 模型配置第一次读完会撑高上面那组，读完再滚一次就收手。
    if (modelsLoaded) scrollPendingRef.current = null;
  }, [modelsLoaded]);
  const hasUnsaved = models.draftDirty;
  // 关闭守卫：模型配置有未保存草稿时先确认，避免 Esc/点遮罩/返回静默丢草稿。
  const requestClose = () => {
    if (!hasUnsaved) {
      onClose();
      return;
    }
    void confirmDialog
      .confirm({
        title: '放弃未保存的更改？',
        message: '正在编辑的模型配置还没点「保存」，关闭后这份草稿会丢掉；已经保存的配置不受影响。',
        confirmLabel: '放弃并关闭',
        cancelLabel: '继续编辑',
        tone: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) onClose();
      });
  };
  // Scrollspy：主区滚动时把视口上沿附近的分组标成当前导航项。搜索隐藏（display:none）
  // 的分组不产生 isIntersecting，active 自然停在最后一个可见组。
  useEffect(() => {
    const root = mainRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveGroup(entry.target.id);
        }
      },
      { root, rootMargin: '-20% 0px -70% 0px' },
    );
    for (const label of settingsNav) {
      const section = root.querySelector(`#${navAnchor(label)}`);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <ModalDialog
        dismissOutside
        onClose={requestClose}
        initialFocusRef={searchRef}
        fallbackFocusRef={fallbackFocusRef}
        aria-labelledby="settings-title"
        className="flex h-[85vh] max-h-[760px] w-full max-w-[940px] overflow-hidden bg-background text-foreground"
        data-testid="settings-view"
      >
        <aside className="flex w-48 flex-shrink-0 flex-col bg-panel px-3 py-3">
          <Button
            size="sm"
            variant="ghost"
            className="mb-5 flex items-center gap-2 text-left text-sm"
            onClick={requestClose}
            data-testid="settings-close"
          >
            <span className="text-lg leading-none">‹</span>
            <span>返回</span>
          </Button>

          <nav className="space-y-1">
            {settingsNav.map((item) => {
              const anchor = navAnchor(item);
              const active = anchor === activeGroup;
              return (
                <a
                  key={item}
                  href={`#${anchor}`}
                  aria-current={active ? 'true' : undefined}
                  className={`flex h-9 items-center gap-2 rounded-md px-2 text-sm no-underline transition-colors hover:bg-elevated hover:text-foreground ${
                    active ? 'bg-elevated text-foreground' : 'text-muted'
                  }`}
                >
                  <span className="grid h-5 w-5 place-items-center text-subtle">
                    <NavIcon label={item} />
                  </span>
                  <span className="truncate">{item}</span>
                </a>
              );
            })}
          </nav>
        </aside>

        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <SettingsSearchContext.Provider value={searchQuery}>
            <div className="mx-auto w-full max-w-[850px] px-6 py-6">
              <h1 id="settings-title" className="mb-4 text-xl font-semibold text-foreground">
                设置
              </h1>

              <Input
                ref={searchRef}
                aria-label="搜索设置"
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                // 弹层在捕获阶段就处理 Esc；有查询时声明自理，才轮得到下面先清搜索。
                data-esc-handled={searchQuery ? '' : undefined}
                onKeyDown={(event) => {
                  // 有查询时 Esc 先清搜索（不就手关掉整个设置窗），空查询时才放行给弹层关闭。
                  if (event.key === 'Escape' && searchQuery && !event.nativeEvent.isComposing) {
                    event.stopPropagation();
                    setSearchQuery('');
                  }
                }}
                placeholder="搜索设置…"
                className="mb-6 bg-surface"
                data-testid="settings-search"
              />

              <div className="sf-settings-list">
                <SettingGroup
                  id="provider"
                  title="模型服务"
                  badge={
                    <UnsavedBadge visible={models.draftDirty} testId="settings-unsaved-provider" />
                  }
                >
                  <SettingCard>
                    <ModelProfilesSection model={models} confirm={confirmDialog.confirm} />
                    <ProviderRuntimeEnvNotice />
                  </SettingCard>
                </SettingGroup>

                <SettingGroup id="plugins" title="插件">
                  <SettingCard>
                    <PluginsSection plugins={plugins} confirm={confirmDialog.confirm} />
                  </SettingCard>
                </SettingGroup>

                <SettingGroup id="appearance" title="外观">
                  <SettingCard>
                    <AppearanceSection
                      settings={safeSettings}
                      onChange={(key, value) => update(key, value as AppSettings[typeof key])}
                    />
                  </SettingCard>
                </SettingGroup>

                <SettingGroup id="editor" title="编辑器">
                  <SettingCard>
                    <RangeRow
                      title="字号"
                      description="调整 Markdown 编辑器默认字号。"
                      value={safeSettings.editorFontSize}
                      min={12}
                      max={20}
                      testId="editor-font-size"
                      onChange={(value) => update('editorFontSize', value)}
                    />
                    <SelectRow
                      title="字体模式"
                      description="格子 = CJK 2:1 等宽中英对齐；书稿 = 衬线比例字体，长文更像书。"
                      value={safeSettings.editorFontMode}
                      onChange={(value) =>
                        update('editorFontMode', value === 'prose' ? 'prose' : 'grid')
                      }
                      options={FONT_MODE_OPTIONS}
                      testId="editor-font-mode"
                    />
                    <SelectRow
                      title="正文行宽"
                      description="正文提前折行，宽屏下眼睛不用横扫一整屏；编辑区照旧铺满，文字靠左。只作用于 Markdown 正文。"
                      value={safeSettings.editorProseMeasure}
                      onChange={(value) =>
                        update(
                          'editorProseMeasure',
                          PROSE_MEASURE_OPTIONS.some((option) => option.value === value)
                            ? (value as ProseMeasure)
                            : 'medium',
                        )
                      }
                      options={PROSE_MEASURE_OPTIONS}
                      testId="editor-prose-measure"
                    />
                    <SelectRow
                      title="行号"
                      description="智能 = 小说正文（Markdown）隐藏行号、canon.json 等数据文件保留。"
                      value={safeSettings.editorLineNumbers}
                      onChange={(value) =>
                        update(
                          'editorLineNumbers',
                          value === 'on' || value === 'off' ? value : 'auto',
                        )
                      }
                      options={LINE_NUMBER_OPTIONS}
                      testId="editor-line-numbers"
                    />
                    <RangeRow
                      title="日更目标"
                      description="作品资料里按此显示今日进度；拖到 0 表示不设目标，不显示进度条。"
                      value={safeSettings.dailyWordGoal}
                      min={0}
                      max={10000}
                      step={500}
                      testId="daily-word-goal"
                      formatValue={(value) => (value === 0 ? '不设' : `${value} 字`)}
                      onChange={(value) => update('dailyWordGoal', value)}
                    />
                    <ToggleRow
                      title="自动保存"
                      description="停止输入后自动保存当前文件。"
                      checked={safeSettings.autoSave}
                      onChange={(checked) => update('autoSave', checked)}
                    />
                    <ToggleRow
                      title="恢复上次写作现场"
                      description="启动先进入作品库。选择上次的作品时，恢复页签与停笔位置。"
                      checked={safeSettings.restoreLastSession}
                      onChange={(checked) => update('restoreLastSession', checked)}
                    />
                    <ActionRow
                      title="恢复默认设置"
                      description="重置本机 StoryForge 桌面偏好。"
                      actionLabel="恢复默认"
                      onAction={() =>
                        void confirmDialog
                          .confirm({
                            title: '恢复默认设置？',
                            message:
                              '将把主题、编辑器等本机偏好全部重置为默认值；模型服务配置与已保存的密钥不受影响。',
                            confirmLabel: '恢复默认',
                            cancelLabel: '取消',
                            tone: 'danger',
                          })
                          .then((confirmed) => {
                            if (confirmed) resetSettings();
                          })
                      }
                    />
                  </SettingCard>
                </SettingGroup>

                <SettingGroup id="about" title="关于">
                  <SettingCard>
                    <AboutRows />
                  </SettingCard>
                </SettingGroup>
                <p className="sf-settings-empty" data-testid="settings-no-results">
                  未找到匹配的设置
                </p>
              </div>
            </div>
          </SettingsSearchContext.Provider>
        </main>
      </ModalDialog>
      <AppDialogHost
        dialog={confirmDialog.dialog}
        onClose={confirmDialog.closeDialog}
        onPromptValueChange={confirmDialog.updatePromptValue}
      />
    </>
  );
}

function ProviderRuntimeEnvNotice() {
  const query = useSettingsQuery();
  const description =
    '配置保存在本机 llm-provider.json，API Key 加密存放，保存后界面不再读回明文。模型请求由桌面应用直接发到你填的服务地址；密钥不写进浏览器存储，也不进日志。';
  if (!settingsTextMatches(query, `连接与存储详情 ${description}`)) return null;
  return (
    <SettingDetails
      className="px-4 py-3 text-xs text-muted"
      data-testid="provider-runtime-details"
      summary={
        <>
          连接与存储详情
          <span className="ml-2 text-muted" data-testid="provider-runtime-env-source">
            仅存本机
          </span>
        </>
      }
    >
      <p className="mt-2 break-words leading-relaxed">{description}</p>
    </SettingDetails>
  );
}

function navAnchor(label: (typeof settingsNav)[number]): string {
  if (label === '模型服务') return 'provider';
  if (label === '插件') return 'plugins';
  if (label === '外观') return 'appearance';
  if (label === '编辑器') return 'editor';
  return 'about';
}

/** 设置左栏图标走 Lucide（此前是 ◈ ◐ ▤ ⓘ 四个 Unicode 字形，Win11 下会被字体替换成异形，
 *  且与全站唯一图标源 shell-icons 割裂 —— 那个模块的存在理由就是「取代旧的 Unicode/字形图标」）。 */
function NavIcon({ label }: { label: string }) {
  const Icon =
    label === '模型服务'
      ? Sparkles
      : label === '插件'
        ? Puzzle
        : label === '外观'
          ? Palette
          : label === '编辑器'
            ? Type
            : Info;
  return <Icon size={15} strokeWidth={1.6} />;
}
