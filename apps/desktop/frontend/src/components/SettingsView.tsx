import { Field, type FieldControlProps, DialogSurface, Button, Input, Select } from './ui';
import { AppDialogHost, useAppDialog } from './app/AppDialog';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  DEFAULT_APP_SETTINGS,
  sanitizeAppSettings,
  type AppSettings,
  type EditorLineNumbersMode,
  type ProviderKind,
  type ThemeMode,
} from '../lib/user-settings';
import { Info, Palette, Pencil, Sparkles, Type } from './icons/shell-icons';
import { PROSE_MEASURE_LABELS, PROSE_MEASURE_ORDER, type ProseMeasure } from './editor/options';
import { checkForUpdate, currentAppVersion, type UpdateCheckResult } from '../lib/update-check';
import { useProviderSettings, type ProbeState } from './settings/useProviderSettings';
import {
  applyProviderPreset,
  describeProviderHealth,
  isProviderKind,
  PROVIDER_OPTIONS,
  PROVIDER_RUNTIME_ENV_VARS,
} from '../lib/provider-config';

type SettingsViewProps = {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
  fallbackFocusRef?: RefObject<HTMLElement>;
};

/**
 * 设置左栏锚点导航。
 *
 * 此前与「返回」动作混在同一个 const 里再靠 slice(1) 跳过首项，且缺「润色模型」一项
 * （该分组的 id 已就位却无法从导航到达，只能滚动或靠设置搜索发现）。拆成纯锚点列表后
 * 增删一项不会再多渲染一个无锚点的假导航项。
 */
const settingsNav = ['模型服务', '润色模型', '外观', '编辑器', '关于'] as const;

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
];

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
const SettingsSearchContext = createContext('');

export function SettingsView({ settings, onChange, onClose, fallbackFocusRef }: SettingsViewProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const safeSettings = sanitizeAppSettings(settings);
  const [searchQuery, setSearchQuery] = useState('');
  const {
    update,
    resetSettings,
    secretInput,
    polishSecretInput,
    storedConfig,
    saveState,
    saveError,
    polishSaveState,
    polishSaveError,
    probe,
    detectState,
    detectedModels,
    detectError,
    loadState,
    loadError,
    writeOperation,
    loadConfig,
    runProbe,
    setSecretInput,
    setPolishSecretInput,
    detectModels,
    saveProviderConfig,
    clearProviderSecret,
    savePolishProviderConfig,
    clearPolishProviderSecret,
    unsavedSlots,
  } = useProviderSettings(safeSettings, onChange);
  // 破坏性操作（移除已存密钥 / 恢复默认设置）先经 AppDialog 确认，不走静默直改。
  const confirmDialog = useAppDialog();
  const mainRef = useRef<HTMLElement | null>(null);
  const [activeGroup, setActiveGroup] = useState<string>('provider');
  const hasUnsaved = unsavedSlots.provider || unsavedSlots.polishProvider;
  // 关闭守卫：模型配置有未保存草稿时先确认，避免 Esc/点遮罩/返回静默丢草稿。
  const requestClose = () => {
    if (!hasUnsaved) {
      onClose();
      return;
    }
    void confirmDialog
      .confirm({
        title: '放弃未保存的更改？',
        message:
          '模型服务或润色模型的修改尚未点「保存并应用」，关闭后这些草稿将丢失；此前已保存到本机的配置不受影响。',
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
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 animate-fade-in"
      data-modal-backdrop=""
    >
      <DialogSurface
        dismissOutside
        onClose={requestClose}
        initialFocusRef={searchRef}
        fallbackFocusRef={fallbackFocusRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-[85vh] max-h-[760px] w-full max-w-[940px] overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-dialog animate-slide-up-fade"
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
                onKeyDown={(event) => {
                  // 有查询时 Esc 先清搜索（不就手关掉整个设置窗），空查询时才放行给弹层关闭。
                  if (event.key === 'Escape' && searchQuery) {
                    event.stopPropagation();
                    setSearchQuery('');
                  }
                }}
                placeholder="搜索设置…"
                className="mb-6 bg-surface"
                data-testid="settings-search"
              />

              {loadState === 'error' && (
                <div
                  role="alert"
                  className="mb-4 rounded-md border border-error/30 bg-surface p-3 text-sm"
                  data-testid="provider-config-error"
                >
                  <p className="break-words text-error">配置读取失败：{loadError}</p>
                  <p className="mt-1 text-xs text-muted">
                    输入已保留。可以重新读取，或重新保存配置。
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    data-testid="provider-config-retry"
                    disabled={writeOperation !== null}
                    onClick={() => void loadConfig()}
                  >
                    重试读取
                  </Button>
                </div>
              )}
              {loadState === 'loading' && (
                <p role="status" className="mb-4 text-xs text-muted">
                  正在读取本机模型配置…
                </p>
              )}
              <div className="sf-settings-list">
                <SettingGroup
                  id="provider"
                  title="模型服务"
                  badge={
                    <UnsavedBadge
                      visible={unsavedSlots.provider}
                      testId="settings-unsaved-provider"
                    />
                  }
                >
                  <SettingCard>
                    <SelectRow
                      title="服务类型"
                      description="选择你使用的 AI 服务。"
                      value={safeSettings.provider.kind}
                      onChange={(value) => {
                        const nextKind = toProviderKind(value);
                        update(
                          'provider',
                          applyProviderPreset(safeSettings.provider, nextKind, {
                            preserveModel: true,
                          }),
                        );
                      }}
                      options={PROVIDER_OPTIONS}
                      testId="provider-kind"
                    />
                    <TextRow
                      title="服务地址"
                      description="使用服务商提供的 API 地址；兼容服务通常填写到 /v1。"
                      value={safeSettings.provider.baseUrl}
                      placeholder="https://api.openai.com"
                      onChange={(value) =>
                        update('provider', { ...safeSettings.provider, baseUrl: value })
                      }
                      testId="provider-base-url"
                    />
                    <TextRow
                      title="默认模型"
                      description="填写模型名称，或用下方探测功能选择。"
                      value={safeSettings.provider.model}
                      placeholder="例如 gpt-4.1、deepseek-chat 或本地模型名"
                      onChange={(value) =>
                        update('provider', { ...safeSettings.provider, model: value })
                      }
                      testId="provider-model"
                    />
                    <ModelDetectRow
                      current={safeSettings.provider.model}
                      state={detectState}
                      models={detectedModels}
                      error={detectError}
                      onDetect={detectModels}
                      disabled={writeOperation !== null}
                      onPick={(model) => update('provider', { ...safeSettings.provider, model })}
                    />
                    <TextRow
                      title="API Key"
                      description={
                        storedConfig?.hasApiKey
                          ? '已保存在本机配置文件；输入新 key 可覆盖。'
                          : '填写服务商提供的密钥，仅保存在本机配置文件中。'
                      }
                      value={secretInput}
                      placeholder={
                        storedConfig?.hasApiKey ? '已保存，留空保持不变' : '粘贴 provider API key'
                      }
                      onChange={setSecretInput}
                      testId="provider-api-key"
                      type="password"
                    />
                    <ActionRow
                      title="保存模型配置"
                      description="保存后，下一次模型调用即生效，无需重启。"
                      actionLabel={writeOperation === 'provider' ? '保存中' : '保存并应用'}
                      onAction={saveProviderConfig}
                      disabled={writeOperation !== null}
                      status={
                        saveState === 'saved'
                          ? { text: '已保存并应用', tone: 'ok' }
                          : saveState === 'error'
                            ? { text: `保存失败：${saveError || '未知错误'}`, tone: 'error' }
                            : null
                      }
                    />
                    {storedConfig?.hasApiKey && (
                      <ActionRow
                        title="移除已保存密钥"
                        description="删除本机保存的 provider API key，并保留服务地址与模型。"
                        actionLabel="移除密钥"
                        onAction={() =>
                          void confirmDialog
                            .confirm({
                              title: '移除已保存密钥？',
                              message:
                                '将删除本机配置文件里保存的 provider API key，服务地址与模型会保留；之后调用模型前需要重新填写密钥。',
                              confirmLabel: '移除密钥',
                              cancelLabel: '取消',
                              tone: 'danger',
                            })
                            .then((confirmed) => {
                              if (confirmed) clearProviderSecret();
                            })
                        }
                        disabled={writeOperation !== null}
                      />
                    )}
                    <ProbeRow state={probe} onProbe={runProbe} disabled={writeOperation !== null} />
                    <ProviderRuntimeEnvNotice />
                  </SettingCard>
                </SettingGroup>

                <SettingGroup
                  id="polish-provider"
                  title="专用润色模型"
                  badge={
                    <UnsavedBadge
                      visible={unsavedSlots.polishProvider}
                      testId="settings-unsaved-polish-provider"
                    />
                  }
                >
                  <SettingCard>
                    <SelectRow
                      title="服务类型"
                      description="仅用于作者主动发起的润色，不改变主对话模型。"
                      value={safeSettings.polishProvider.kind}
                      onChange={(value) => {
                        const nextKind = toProviderKind(value);
                        update(
                          'polishProvider',
                          applyProviderPreset(safeSettings.polishProvider, nextKind, {
                            preserveModel: true,
                          }),
                        );
                      }}
                      options={PROVIDER_OPTIONS}
                      testId="polish-provider-kind"
                    />
                    <TextRow
                      title="服务地址"
                      description="Anthropic、Gemini 或兼容服务的 API 基础地址。"
                      value={safeSettings.polishProvider.baseUrl}
                      placeholder="https://api.anthropic.com/v1"
                      onChange={(value) =>
                        update('polishProvider', {
                          ...safeSettings.polishProvider,
                          baseUrl: value,
                        })
                      }
                      testId="polish-provider-base-url"
                    />
                    <TextRow
                      title="润色模型"
                      description="整章润色默认只调用此模型；未配置完整时会明确停止。"
                      value={safeSettings.polishProvider.model}
                      placeholder="例如 claude-sonnet-4-5 或 gemini-2.5-pro"
                      onChange={(value) =>
                        update('polishProvider', { ...safeSettings.polishProvider, model: value })
                      }
                      testId="polish-provider-model"
                    />
                    <TextRow
                      title="API Key"
                      description={
                        storedConfig?.polish?.hasApiKey
                          ? '已保存在本机专用槽位；输入新 key 可覆盖。'
                          : '仅写入本机配置文件，不写入 localStorage。'
                      }
                      value={polishSecretInput}
                      placeholder={
                        storedConfig?.polish?.hasApiKey
                          ? '已保存，留空保持不变'
                          : '粘贴润色模型 API key'
                      }
                      onChange={setPolishSecretInput}
                      testId="polish-provider-api-key"
                      type="password"
                    />
                    <ActionRow
                      title="应用专用润色模型"
                      description="单独保存润色配置，不覆盖主对话模型。"
                      actionLabel={writeOperation === 'polishProvider' ? '保存中' : '保存并应用'}
                      onAction={savePolishProviderConfig}
                      disabled={writeOperation !== null}
                      status={
                        polishSaveState === 'saved'
                          ? { text: '专用润色模型已保存', tone: 'ok' }
                          : polishSaveState === 'error'
                            ? {
                                text: `保存失败：${polishSaveError || '未知错误'}`,
                                tone: 'error',
                              }
                            : null
                      }
                    />
                    {storedConfig?.polish?.hasApiKey && (
                      <ActionRow
                        title="移除润色模型密钥"
                        description="清除专用槽位密钥；之后润色不会自动改用主模型。"
                        actionLabel="移除密钥"
                        onAction={() =>
                          void confirmDialog
                            .confirm({
                              title: '移除润色模型密钥？',
                              message:
                                '将删除本机配置文件里保存的专用润色模型 API key；之后发起润色前需要重新填写密钥，润色不会自动改用主对话模型。',
                              confirmLabel: '移除密钥',
                              cancelLabel: '取消',
                              tone: 'danger',
                            })
                            .then((confirmed) => {
                              if (confirmed) clearPolishProviderSecret();
                            })
                        }
                        disabled={writeOperation !== null}
                      />
                    )}
                  </SettingCard>
                </SettingGroup>

                <SettingGroup id="appearance" title="外观">
                  <SettingCard>
                    <SelectRow
                      title="主题"
                      description="切换深色 / 浅色界面；编辑器主题随之联动。"
                      value={safeSettings.theme}
                      onChange={(value) => update('theme', value === 'light' ? 'light' : 'dark')}
                      options={THEME_OPTIONS}
                      testId="appearance-theme"
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
                      description="状态栏稿件卡按此显示今日进度；拖到 0 表示不设目标，不显示进度条。"
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
                      description="停止输入后自动写回当前文件。"
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
      </DialogSurface>
      <AppDialogHost
        dialog={confirmDialog.dialog}
        onClose={confirmDialog.closeDialog}
        onPromptValueChange={confirmDialog.updatePromptValue}
      />
    </div>
  );
}

function ModelDetectRow({
  current,
  state,
  models,
  error,
  onDetect,
  onPick,
  disabled,
}: {
  current: string;
  state: 'idle' | 'loading' | 'error' | 'ok';
  models: string[];
  error: string;
  onDetect: () => void;
  onPick: (model: string) => void;
  disabled: boolean;
}) {
  const status =
    state === 'loading'
      ? '探测中…'
      : state === 'ok'
        ? `${models.length} 个可用模型，点选即填入默认模型`
        : state === 'error'
          ? error
          : null;
  return (
    <>
      <RowShell
        title="探测可用模型"
        description="按当前服务地址 + API Key 拉取模型列表（会先保存当前配置）。"
        descriptionId="provider-detect-models-description"
      >
        <div className="flex items-center gap-3">
          {status && (
            <span
              className={`max-w-[280px] truncate text-xs ${
                state === 'error' ? 'text-error' : 'text-subtle'
              }`}
              data-testid="provider-detect-status"
            >
              {status}
            </span>
          )}
          <Button
            type="button"
            onClick={onDetect}
            loading={state === 'loading'}
            aria-describedby="provider-detect-models-description"
            disabled={disabled || state === 'loading'}
            size="sm"
            variant="secondary"
            className="flex-shrink-0 text-sm"
            data-testid="provider-detect-models"
          >
            探测模型
          </Button>
        </div>
      </RowShell>
      {models.length > 0 && (
        <div
          className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto px-4 py-3"
          data-testid="provider-model-options"
        >
          {models.map((model) => (
            <button
              key={model}
              type="button"
              onClick={() => onPick(model)}
              className={`max-w-full truncate rounded-md border px-2 py-1 text-xs transition-colors ${
                model === current
                  ? 'border-accent bg-accent text-accent-foreground'
                  : 'border-border text-muted hover:bg-elevated hover:text-foreground'
              }`}
              title={model}
            >
              {model}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ProbeRow({
  state,
  onProbe,
  disabled,
}: {
  state: ProbeState;
  onProbe: () => void;
  disabled: boolean;
}) {
  const display = state === 'idle' || state === 'loading' ? null : describeProviderHealth(state);
  const toneClass =
    display?.tone === 'ok'
      ? 'text-success'
      : display?.tone === 'warn'
        ? 'text-warning'
        : display?.tone === 'error'
          ? 'text-error'
          : 'text-subtle';
  return (
    <RowShell
      title="测试连接"
      description="检查已保存的配置能否连接服务；修改后请先保存再测试。"
      descriptionId="provider-health-probe-description"
    >
      <div className="flex items-center gap-3">
        {state !== 'idle' && (
          <span
            className={`max-w-[280px] truncate text-xs ${state === 'loading' ? 'text-subtle' : toneClass}`}
            data-testid="provider-health-status"
          >
            {state === 'loading' ? '检测中…' : display?.label}
          </span>
        )}
        <Button
          type="button"
          onClick={onProbe}
          aria-describedby="provider-health-probe-description"
          disabled={disabled || state === 'loading'}
          size="sm"
          variant="secondary"
          className="flex-shrink-0 text-sm"
          data-testid="provider-health-probe"
        >
          测试连接
        </Button>
      </div>
    </RowShell>
  );
}

function ProviderRuntimeEnvNotice() {
  const query = useContext(SettingsSearchContext).trim().toLowerCase();
  const description = `配置保存在本机 llm-provider.json，由桌面应用提供给后端。真实模型调用读取后端环境变量：${PROVIDER_RUNTIME_ENV_VARS.join('、')}。密钥不写入浏览器 localStorage。`;
  if (query && !`连接与存储详情 ${description}`.toLowerCase().includes(query)) return null;
  return (
    <details
      className="px-4 py-3 text-xs text-muted"
      data-testid="provider-runtime-details"
      open={Boolean(query)}
    >
      <summary className="cursor-pointer rounded-sm py-1 hover:text-foreground">
        连接与存储详情
        <span className="ml-2 text-muted" data-testid="provider-runtime-env-source">
          桌面注入
        </span>
      </summary>
      <p className="mt-2 break-words leading-relaxed">{description}</p>
    </details>
  );
}

function SettingGroup({
  id,
  title,
  badge = null,
  children,
}: {
  id: string;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  // sf-settings-group + sf-settings-card：搜索过滤后若卡片内全部行 null 渲染 → 卡片 :empty，
  // 整组（含标题）随之 CSS 隐藏，不再留空标题/空卡壳（见 index.css）。
  return (
    <section id={id} className="sf-settings-group mb-8 scroll-mt-6">
      <h2 className="mb-3 text-sm font-medium text-foreground">
        {title}
        {badge}
      </h2>
      {children}
    </section>
  );
}

/** 「未保存」徽标：仅在对应槽位草稿与磁盘基线不一致时出现，保存成功后自然消失。 */
function UnsavedBadge({ visible, testId }: { visible: boolean; testId: string }) {
  if (!visible) return null;
  return (
    <span className="ml-2 text-xs font-normal text-warning" data-testid={testId}>
      ● 未保存
    </span>
  );
}

function SettingCard({ children }: { children: ReactNode }) {
  return <div className="sf-settings-card overflow-hidden rounded-xl bg-surface">{children}</div>;
}

function RowShell({
  title,
  description,
  children,
  controlId,
  descriptionId,
}: {
  title: string;
  description: string;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
  controlId?: string;
  descriptionId?: string;
}) {
  const query = useContext(SettingsSearchContext).trim().toLowerCase();
  if (query && !`${title} ${description}`.toLowerCase().includes(query)) return null;
  if (controlId)
    return (
      <Field
        id={controlId}
        label={title}
        description={description}
        descriptionId={descriptionId}
        layout="horizontal"
        className="min-h-[76px] px-4 py-3"
      >
        {(control) => (typeof children === 'function' ? children(control) : children)}
      </Field>
    );

  return (
    <div className="flex min-h-[76px] items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        {controlId ? (
          <label htmlFor={controlId} className="text-sm font-medium text-foreground">
            {title}
          </label>
        ) : (
          <div className="text-sm font-medium text-foreground">{title}</div>
        )}
        <div
          id={descriptionId ?? (controlId ? `${controlId}-description` : undefined)}
          className="mt-1 text-xs leading-relaxed text-muted"
        >
          {description}
        </div>
      </div>
      <div className="flex-shrink-0">{typeof children === 'function' ? null : children}</div>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  // controlId 走 RowShell 的 Field 分支：标题成为真 label，点标题也能切开关；
  // 按钮改名职责交给 label 关联，不再自带 aria-label。
  const controlId = useId();
  return (
    <RowShell title={title} description={description} controlId={controlId}>
      {(control) => (
        <button
          {...control}
          type="button"
          aria-pressed={checked}
          onClick={() => onChange(!checked)}
          className={`relative h-[22px] w-[38px] rounded-full transition-colors ${
            checked ? 'bg-accent hover:bg-accent/90' : 'bg-border-strong hover:bg-border'
          }`}
        >
          <span
            className={`absolute top-0.5 h-[18px] w-[18px] rounded-full transition-transform ${
              checked ? 'translate-x-[18px] bg-accent-foreground' : 'translate-x-0.5 bg-foreground'
            }`}
          />
        </button>
      )}
    </RowShell>
  );
}

function RangeRow({
  title,
  description,
  value,
  min,
  max,
  step,
  unit = 'px',
  formatValue,
  testId,
  onChange,
}: {
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  formatValue?: (value: number) => string;
  testId: string;
  onChange: (value: number) => void;
}) {
  return (
    <RowShell title={title} description={description} controlId={testId}>
      {(control) => (
        <div className="flex items-center gap-3">
          <input
            type="range"
            {...control}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="w-40 accent-accent"
            data-testid={testId}
          />
          <span className="w-14 whitespace-nowrap text-right text-sm tabular-nums text-foreground">
            {formatValue ? formatValue(value) : `${value}${unit}`}
          </span>
        </div>
      )}
    </RowShell>
  );
}

function TextRow({
  title,
  description,
  value,
  placeholder,
  onChange,
  testId,
  type = 'text',
}: {
  title: string;
  description: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  testId: string;
  type?: 'text' | 'password';
}) {
  return (
    <RowShell title={title} description={description} controlId={testId}>
      {(control) => (
        <Input
          type={type}
          {...control}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          controlSize="sm"
          className="w-[260px]"
          data-testid={testId}
        />
      )}
    </RowShell>
  );
}

function SelectRow({
  title,
  description,
  value,
  onChange,
  options,
  testId,
}: {
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  testId: string;
}) {
  return (
    <RowShell title={title} description={description} controlId={testId}>
      {(control) => (
        <Select
          {...control}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          controlSize="sm"
          className="w-[180px]"
          data-testid={testId}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </RowShell>
  );
}

function toProviderKind(value: string): ProviderKind {
  if (isProviderKind(value)) return value;
  return DEFAULT_APP_SETTINGS.provider.kind;
}

function ActionRow({
  title,
  description,
  actionLabel,
  onAction,
  disabled = false,
  status = null,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  status?: { text: string; tone: 'ok' | 'error' } | null;
}) {
  return (
    <RowShell title={title} description={description}>
      <div className="flex items-center gap-2.5">
        {status && (
          <span
            className={`max-w-[280px] whitespace-pre-wrap break-words text-xs ${
              status.tone === 'error' ? 'text-error' : 'text-success'
            }`}
            role={status.tone === 'error' ? 'alert' : 'status'}
            data-testid="action-row-status"
          >
            {status.text}
          </span>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="flex-shrink-0 text-sm"
          onClick={onAction}
          disabled={disabled}
        >
          {actionLabel}
        </Button>
      </div>
    </RowShell>
  );
}

function navAnchor(label: (typeof settingsNav)[number]): string {
  if (label === '模型服务') return 'provider';
  if (label === '润色模型') return 'polish-provider';
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
      : label === '润色模型'
        ? Pencil
        : label === '外观'
          ? Palette
          : label === '编辑器'
            ? Type
            : Info;
  return <Icon size={15} strokeWidth={1.6} />;
}

type UpdateProbeState = 'idle' | 'loading' | UpdateCheckResult;

/** 关于区：当前版本 + 手动检查更新（对比 GitHub 最新 v* tag；升级仍走重建安装包）。 */
function AboutRows() {
  const [version, setVersion] = useState<string | null>(null);
  const [updateProbe, setUpdateProbe] = useState<UpdateProbeState>('idle');

  useEffect(() => {
    let cancelled = false;
    void currentAppVersion().then((value) => {
      if (!cancelled) setVersion(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runUpdateCheck = async () => {
    setUpdateProbe('loading');
    const current = version ?? (await currentAppVersion());
    if (!current) {
      setUpdateProbe({ kind: 'error', message: '非桌面运行时无版本信息' });
      return;
    }
    setUpdateProbe(await checkForUpdate(current));
  };

  const updateLabel =
    updateProbe === 'idle'
      ? null
      : updateProbe === 'loading'
        ? '检查中…'
        : updateProbe.kind === 'up-to-date'
          ? `已是最新（${updateProbe.current}）`
          : updateProbe.kind === 'update-available'
            ? `有新版本 ${updateProbe.latest}（当前 ${updateProbe.current}）`
            : `检查失败：${updateProbe.message}`;
  const updateTone =
    updateProbe !== 'idle' && updateProbe !== 'loading' && updateProbe.kind === 'error'
      ? 'text-error'
      : updateProbe !== 'idle' &&
          updateProbe !== 'loading' &&
          updateProbe.kind === 'update-available'
        ? 'text-warning'
        : 'text-subtle';

  return (
    <>
      <RowShell title="当前版本" description="StoryForge IDE 桌面端。">
        <span
          className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2 font-mono text-xs text-muted"
          data-testid="about-version"
        >
          {version ? `v${version}` : '开发模式'}
        </span>
      </RowShell>
      <RowShell
        title="检查更新"
        description="对比 GitHub 最新版本 tag；有新版后仍需重建安装包升级。网络走代理，失败属常态。"
      >
        <div className="flex items-center gap-3">
          {updateLabel && (
            <span
              className={`max-w-[280px] truncate text-xs ${updateTone}`}
              data-testid="about-update-status"
            >
              {updateLabel}
            </span>
          )}
          <Button
            type="button"
            onClick={() => void runUpdateCheck()}
            disabled={updateProbe === 'loading'}
            size="sm"
            variant="secondary"
            className="flex-shrink-0 text-sm"
            data-testid="about-update-check"
          >
            检查更新
          </Button>
        </div>
      </RowShell>
    </>
  );
}
