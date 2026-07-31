import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  DEFAULT_APP_SETTINGS,
  sanitizeAppSettings,
  type AppSettings,
  type EditorLineNumbersMode,
  type ProviderKind,
  type ThemeMode,
} from '../lib/user-settings';
import { Info, Palette, Sparkles, Type } from './icons/shell-icons';
import { PROSE_MEASURE_LABELS, PROSE_MEASURE_ORDER, type ProseMeasure } from './editor/options';
import { checkForUpdate, currentAppVersion, type UpdateCheckResult } from '../lib/update-check';
import { probeProviderHealth } from '../lib/api-client';
import {
  getDesktopLlmConfig,
  saveDesktopLlmConfig,
  type DesktopLlmConfig,
} from '../lib/desktop-llm-config';
import {
  applyProviderPreset,
  describeProviderHealth,
  isProviderKind,
  PROVIDER_OPTIONS,
  PROVIDER_RUNTIME_ENV_VARS,
  type ProviderHealth,
} from '../lib/provider-config';

type SettingsViewProps = {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
};

type ProbeState = 'idle' | 'loading' | ProviderHealth;
type SaveState = 'idle' | 'loading' | 'saved' | 'error';

const settingsNav = ['返回', '模型服务', '外观', '编辑器', '关于'] as const;

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

export function SettingsView({ settings, onChange, onClose }: SettingsViewProps) {
  const safeSettings = sanitizeAppSettings(settings);
  const [secretInput, setSecretInput] = useState('');
  const [storedConfig, setStoredConfig] = useState<DesktopLlmConfig | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const update = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    onChange({ ...safeSettings, [key]: value });
  };

  const [probe, setProbe] = useState<ProbeState>('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [detectState, setDetectState] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [detectError, setDetectError] = useState('');
  const runProbe = async () => {
    setProbe('loading');
    try {
      setProbe(await probeProviderHealth());
    } catch (err) {
      setProbe({
        status: 'unreachable',
        reachable: false,
        baseUrl: null,
        model: null,
        latencyMs: null,
        modelCount: null,
        models: [],
        detail: err instanceof Error ? err.message : String(err),
        missingEnv: [],
      });
    }
  };

  // #16：按当前 provider / URL / API Key 探测可用模型（先落盘再拉 /models），供下方点选填入默认模型。
  const detectModels = async () => {
    setDetectState('loading');
    setDetectError('');
    try {
      const next = await saveDesktopLlmConfig({
        provider: safeSettings.provider.kind,
        baseUrl: safeSettings.provider.baseUrl,
        model: safeSettings.provider.model,
        apiKey: secretInput,
      });
      if (next) setStoredConfig(next);
      const health = await probeProviderHealth();
      setDetectedModels(health.models);
      if (health.status === 'ok' && health.models.length > 0) {
        setDetectState('ok');
      } else {
        setDetectState('error');
        setDetectError(describeProviderHealth(health).label);
      }
    } catch (error) {
      setDetectState('error');
      setDetectError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    let cancelled = false;
    void getDesktopLlmConfig()
      .then((config) => {
        if (cancelled || !config) return;
        setStoredConfig(config);
        update('provider', {
          ...safeSettings.provider,
          kind: toProviderKind(config.provider),
          baseUrl: config.baseUrl || safeSettings.provider.baseUrl,
          model: config.model || safeSettings.provider.model,
          apiKeyRef: config.hasApiKey ? 'stored://storyforge/llm-provider' : '',
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setSaveError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
    // Run once when the settings pane opens; user edits are handled by explicit save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 保存成功反馈数秒后自清（回 idle）：不让「已保存」永久停留在操作行。
  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = window.setTimeout(() => setSaveState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  // #15：设置由页面式改弹出式，Esc 关闭。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveProviderConfig = async () => {
    setSaveState('loading');
    setSaveError('');
    try {
      const next = await saveDesktopLlmConfig({
        provider: safeSettings.provider.kind,
        baseUrl: safeSettings.provider.baseUrl,
        model: safeSettings.provider.model,
        apiKey: secretInput,
      });
      if (next) {
        setStoredConfig(next);
        setSecretInput('');
        update('provider', {
          ...safeSettings.provider,
          apiKeyRef: next.hasApiKey ? 'stored://storyforge/llm-provider' : '',
        });
      }
      setSaveState('saved');
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const clearProviderSecret = async () => {
    setSaveState('loading');
    setSaveError('');
    try {
      const next = await saveDesktopLlmConfig({
        provider: safeSettings.provider.kind,
        baseUrl: safeSettings.provider.baseUrl,
        model: safeSettings.provider.model,
        clearApiKey: true,
      });
      if (next) {
        setStoredConfig(next);
        update('provider', { ...safeSettings.provider, apiKeyRef: '' });
      }
      setSecretInput('');
      setSaveState('saved');
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <section
        className="flex h-[85vh] max-h-[760px] w-full max-w-[940px] overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-[var(--shadow-dropdown)]"
        data-testid="settings-view"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="flex w-[240px] flex-shrink-0 flex-col border-r border-border bg-panel px-3 py-3">
          <button
            className="mb-5 flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm text-muted hover:bg-elevated hover:text-foreground"
            onClick={onClose}
            data-testid="settings-close"
          >
            <span className="text-lg leading-none">‹</span>
            <span>返回</span>
          </button>

          <nav className="space-y-1">
            {settingsNav.slice(1).map((item) => (
              <a
                key={item}
                href={`#${navAnchor(item)}`}
                className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted no-underline hover:bg-elevated hover:text-foreground"
              >
                <span className="grid h-5 w-5 place-items-center text-subtle">
                  <NavIcon label={item} />
                </span>
                <span className="truncate">{item}</span>
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <SettingsSearchContext.Provider value={searchQuery}>
            <div className="mx-auto w-full max-w-[850px] px-8 py-8">
              <h1 className="mb-4 text-xl font-semibold text-foreground">设置</h1>

              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索设置…"
                className="mb-6 h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none placeholder:text-subtle focus:border-accent"
                data-testid="settings-search"
              />

              <div className="sf-settings-list">
                <SettingGroup id="provider" title="模型服务">
                  <SettingCard>
                    <SelectRow
                      title="服务类型"
                      description="保存后由桌面主进程注入后端 STORYFORGE_LLM_PROVIDER。"
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
                      description="OpenAI-compatible 服务通常填写到 /v1；保存后注入 STORYFORGE_LLM_BASE_URL。"
                      value={safeSettings.provider.baseUrl}
                      placeholder="https://api.openai.com"
                      onChange={(value) =>
                        update('provider', { ...safeSettings.provider, baseUrl: value })
                      }
                      testId="provider-base-url"
                    />
                    <TextRow
                      title="默认模型"
                      description="保存后注入 STORYFORGE_LLM_MODEL。"
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
                      onPick={(model) => update('provider', { ...safeSettings.provider, model })}
                    />
                    <TextRow
                      title="API Key"
                      description={
                        storedConfig?.hasApiKey
                          ? '已保存在本机配置文件；输入新 key 可覆盖。'
                          : '保存后由桌面主进程注入 STORYFORGE_LLM_API_KEY，不写入 localStorage。'
                      }
                      value={secretInput}
                      placeholder={
                        storedConfig?.hasApiKey ? '已保存，留空保持不变' : '粘贴 provider API key'
                      }
                      onChange={setSecretInput}
                      testId="provider-api-key"
                      type="password"
                    />
                    <ProviderRuntimeEnvNotice />
                    <ActionRow
                      title="应用到本机后端"
                      description="保存到本机即写入 llm-provider.json，后端下次调用即读取生效，无需重启。"
                      actionLabel={saveState === 'loading' ? '保存中' : '保存并应用'}
                      onAction={saveProviderConfig}
                      disabled={saveState === 'loading'}
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
                        onAction={clearProviderSecret}
                        disabled={saveState === 'loading'}
                      />
                    )}
                    <ProbeRow state={probe} onProbe={runProbe} />
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
                      title="启动时恢复上次现场"
                      description="重开后自动打开上次的项目、页签与停笔位置。关闭则每次从欢迎页开始。"
                      checked={safeSettings.restoreLastSession}
                      onChange={(checked) => update('restoreLastSession', checked)}
                    />
                    <ActionRow
                      title="恢复默认设置"
                      description="重置本机 StoryForge 桌面偏好。"
                      actionLabel="恢复默认"
                      onAction={() => onChange(DEFAULT_APP_SETTINGS)}
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
      </section>
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
}: {
  current: string;
  state: 'idle' | 'loading' | 'error' | 'ok';
  models: string[];
  error: string;
  onDetect: () => void;
  onPick: (model: string) => void;
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
          <button
            type="button"
            onClick={onDetect}
            disabled={state === 'loading'}
            className="h-8 flex-shrink-0 rounded-md border border-border bg-surface px-3 text-sm text-foreground hover:bg-elevated disabled:opacity-50"
            data-testid="provider-detect-models"
          >
            探测模型
          </button>
        </div>
      </RowShell>
      {models.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3 last:border-b-0"
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

function ProbeRow({ state, onProbe }: { state: ProbeState; onProbe: () => void }) {
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
      description="探测后端 STORYFORGE_LLM_* resolved_llm_env；刚保存配置后可直接测试。"
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
        <button
          type="button"
          onClick={onProbe}
          disabled={state === 'loading'}
          className="h-8 flex-shrink-0 rounded-md border border-border bg-surface px-3 text-sm text-foreground hover:bg-elevated disabled:opacity-50"
          data-testid="provider-health-probe"
        >
          测试连接
        </button>
      </div>
    </RowShell>
  );
}

function ProviderRuntimeEnvNotice() {
  // 真相源 badge 恒显 env 源；保存成功/失败反馈移到下方「应用到本机后端」ActionRow，且数秒后自清，
  // 不再劫持本行标签永久停在「已保存」。
  return (
    <RowShell
      title="运行时真相源"
      description={`真实模型调用读取后端环境变量：${PROVIDER_RUNTIME_ENV_VARS.join('、')}。`}
    >
      <span
        className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2 text-xs text-muted"
        data-testid="provider-runtime-env-source"
      >
        桌面注入
      </span>
    </RowShell>
  );
}

function SettingGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  // sf-settings-group + sf-settings-card：搜索过滤后若卡片内全部行 null 渲染 → 卡片 :empty，
  // 整组（含标题）随之 CSS 隐藏，不再留空标题/空卡壳（见 index.css）。
  return (
    <section id={id} className="sf-settings-group mb-8 scroll-mt-6">
      <h2 className="mb-3 text-sm font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function SettingCard({ children }: { children: ReactNode }) {
  return (
    <div className="sf-settings-card overflow-hidden rounded-xl border border-border bg-surface">
      {children}
    </div>
  );
}

function RowShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const query = useContext(SettingsSearchContext).trim().toLowerCase();
  if (query && !`${title} ${description}`.toLowerCase().includes(query)) return null;
  return (
    <div className="flex min-h-[76px] items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-sm leading-5 text-muted">{description}</div>
      </div>
      <div className="flex-shrink-0">{children}</div>
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
  return (
    <RowShell title={title} description={description}>
      <button
        type="button"
        aria-pressed={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-[38px] rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-border-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 h-[18px] w-[18px] rounded-full transition-transform ${
            checked ? 'translate-x-[18px] bg-accent-foreground' : 'translate-x-0.5 bg-foreground'
          }`}
        />
      </button>
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
    <RowShell title={title} description={description}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-40 accent-accent"
          data-testid={testId}
        />
        <span className="w-14 text-right text-sm tabular-nums text-foreground">
          {formatValue ? formatValue(value) : `${value}${unit}`}
        </span>
      </div>
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
    <RowShell title={title} description={description}>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-[260px] rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none placeholder:text-subtle focus:border-accent"
        data-testid={testId}
      />
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
    <RowShell title={title} description={description}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-[180px] rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-accent"
        data-testid={testId}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
            className={`max-w-[220px] truncate text-xs ${
              status.tone === 'error' ? 'text-error' : 'text-success'
            }`}
            data-testid="action-row-status"
          >
            {status.text}
          </span>
        )}
        <button
          className="h-8 flex-shrink-0 rounded-md border border-border bg-surface px-3 text-sm text-foreground hover:bg-elevated disabled:opacity-50"
          onClick={onAction}
          disabled={disabled}
        >
          {actionLabel}
        </button>
      </div>
    </RowShell>
  );
}

function navAnchor(label: string): string {
  if (label === '模型服务') return 'provider';
  if (label === '外观') return 'appearance';
  if (label === '编辑器') return 'editor';
  if (label === '关于') return 'about';
  return 'provider';
}

/** 设置左栏图标走 Lucide（此前是 ◈ ◐ ▤ ⓘ 四个 Unicode 字形，Win11 下会被字体替换成异形，
 *  且与全站唯一图标源 shell-icons 割裂 —— 那个模块的存在理由就是「取代旧的 Unicode/字形图标」）。 */
function NavIcon({ label }: { label: string }) {
  const Icon =
    label === '模型服务' ? Sparkles : label === '外观' ? Palette : label === '编辑器' ? Type : Info;
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
          <button
            type="button"
            onClick={() => void runUpdateCheck()}
            disabled={updateProbe === 'loading'}
            className="h-8 flex-shrink-0 rounded-md border border-border bg-surface px-3 text-sm text-foreground hover:bg-elevated disabled:opacity-50"
            data-testid="about-update-check"
          >
            检查更新
          </button>
        </div>
      </RowShell>
    </>
  );
}
