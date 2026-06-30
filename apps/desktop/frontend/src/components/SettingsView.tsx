import { useState, type ReactNode } from 'react';
import {
  DEFAULT_APP_SETTINGS,
  sanitizeAppSettings,
  type AppSettings,
  type ProviderKind,
  type ThemeMode,
} from '../lib/user-settings';
import { probeProviderHealth } from '../lib/api-client';
import {
  applyProviderPreset,
  describeProviderConnection,
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

const settingsNav = ['返回', '模型服务', '外观', '编辑器'] as const;

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
];

export function SettingsView({ settings, onChange, onClose }: SettingsViewProps) {
  const safeSettings = sanitizeAppSettings(settings);
  const providerConnection = describeProviderConnection(safeSettings.provider);
  const update = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    onChange({ ...safeSettings, [key]: value });
  };

  const [probe, setProbe] = useState<ProbeState>('idle');
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
        detail: err instanceof Error ? err.message : String(err),
        missingEnv: [],
      });
    }
  };

  return (
    <section
      className="flex h-full min-w-0 bg-background text-foreground"
      data-testid="settings-view"
    >
      <aside className="flex w-[278px] flex-shrink-0 flex-col border-r border-border bg-panel px-3 py-3">
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
              <span className="grid h-5 w-5 place-items-center text-subtle">{navIcon(item)}</span>
              <span className="truncate">{item}</span>
            </a>
          ))}
        </nav>

        <div className="mt-auto">
          <div className="flex items-center gap-2 rounded-md bg-surface px-2 py-2">
            <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
              SF
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">本地创作环境</div>
              <div className="truncate text-xs text-subtle">{providerConnection.label}</div>
            </div>
            <span className="grid h-7 w-7 place-items-center rounded-md bg-elevated text-muted">
              <SettingsGlyph />
            </span>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[850px] px-8 py-8">
          <h1 className="mb-7 text-xl font-semibold text-foreground">设置</h1>

          <SettingGroup id="provider" title="模型服务">
            <SettingCard>
              <SelectRow
                title="服务类型"
                description="仅用于本机偏好和界面提示；真实模型调用读取后端环境变量。"
                value={safeSettings.provider.kind}
                onChange={(value) => {
                  const nextKind = toProviderKind(value);
                  update(
                    'provider',
                    applyProviderPreset(safeSettings.provider, nextKind, { preserveModel: true }),
                  );
                }}
                options={PROVIDER_OPTIONS}
                testId="provider-kind"
              />
              <TextRow
                title="服务地址"
                description="参考地址，不会从前端注入后端调用链。"
                value={safeSettings.provider.baseUrl}
                placeholder="https://api.openai.com"
                onChange={(value) =>
                  update('provider', { ...safeSettings.provider, baseUrl: value })
                }
                testId="provider-base-url"
              />
              <TextRow
                title="默认模型"
                description="参考模型名；后端以 STORYFORGE_LLM_MODEL 为准。"
                value={safeSettings.provider.model}
                placeholder="例如 gpt-4.1、deepseek-chat 或本地模型名"
                onChange={(value) => update('provider', { ...safeSettings.provider, model: value })}
                testId="provider-model"
              />
              <TextRow
                title="密钥引用"
                description="只允许环境变量名或 vault:// 引用；明文密钥会被丢弃，真实密钥必须在后端环境中配置。"
                value={safeSettings.provider.apiKeyRef}
                placeholder="例如 OPENAI_API_KEY"
                onChange={(value) =>
                  update('provider', { ...safeSettings.provider, apiKeyRef: value })
                }
                testId="provider-api-key-ref"
              />
              <ProviderRuntimeEnvNotice />
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
                onChange={(value) => update('editorFontSize', value)}
              />
              <ToggleRow
                title="自动保存"
                description="停止输入后自动写回当前文件。"
                checked={safeSettings.autoSave}
                onChange={(checked) => update('autoSave', checked)}
              />
              <ActionRow
                title="恢复默认设置"
                description="重置本机 StoryForge 桌面偏好。"
                actionLabel="恢复默认"
                onAction={() => onChange(DEFAULT_APP_SETTINGS)}
              />
            </SettingCard>
          </SettingGroup>
        </div>
      </main>
    </section>
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
      description="探测后端 resolved_llm_env；它只读取 STORYFORGE_LLM_*，不会读取本页 localStorage。"
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
  return (
    <RowShell
      title="运行时真相源"
      description={`真实调用只读取后端环境变量：${PROVIDER_RUNTIME_ENV_VARS.join('、')}。`}
    >
      <span
        className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2 text-xs text-muted"
        data-testid="provider-runtime-env-source"
      >
        Backend env
      </span>
    </RowShell>
  );
}

function SettingGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-8 scroll-mt-6">
      <h2 className="mb-3 text-sm font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function SettingCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">{children}</div>
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
  onChange,
}: {
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <RowShell title={title} description={description}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-40 accent-accent"
          data-testid="editor-font-size"
        />
        <span className="w-10 text-sm tabular-nums text-foreground">{value}px</span>
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
}: {
  title: string;
  description: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <RowShell title={title} description={description}>
      <input
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
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <RowShell title={title} description={description}>
      <button
        className="h-8 rounded-md border border-border bg-surface px-3 text-sm text-foreground hover:bg-elevated"
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </RowShell>
  );
}

function navAnchor(label: string): string {
  if (label === '模型服务') return 'provider';
  if (label === '外观') return 'appearance';
  if (label === '编辑器') return 'editor';
  return 'provider';
}

function navIcon(label: string): string {
  if (label === '模型服务') return '◈';
  if (label === '外观') return '◐';
  if (label === '编辑器') return '▤';
  return '◈';
}

function SettingsGlyph() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.55 2.1h2.9l.35 1.55c.33.12.64.3.92.53l1.48-.48 1.45 2.5-1.15 1.08a4.4 4.4 0 0 1 0 1.44l1.15 1.08-1.45 2.5-1.48-.48c-.28.23-.59.41-.92.53l-.35 1.55h-2.9l-.35-1.55a4.1 4.1 0 0 1-.92-.53l-1.48.48-1.45-2.5 1.15-1.08a4.4 4.4 0 0 1 0-1.44L2.35 6.2 3.8 3.7l1.48.48c.28-.23.59-.41.92-.53l.35-1.55Z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}
