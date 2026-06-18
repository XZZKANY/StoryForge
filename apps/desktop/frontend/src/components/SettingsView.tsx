import type { ReactNode } from 'react';
import {
  DEFAULT_APP_SETTINGS,
  sanitizeAppSettings,
  type AppSettings,
  type ProviderKind,
} from '../lib/user-settings';
import {
  applyProviderPreset,
  describeProviderConnection,
  isProviderKind,
  PROVIDER_OPTIONS,
} from '../lib/provider-config';

type SettingsViewProps = {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
};

const settingsNav = [
  '返回',
  '模型服务',
  '编辑器',
] as const;

export function SettingsView({
  settings,
  onChange,
  onClose,
}: SettingsViewProps) {
  const safeSettings = sanitizeAppSettings(settings);
  const providerConnection = describeProviderConnection(safeSettings.provider);
  const update = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    onChange({ ...safeSettings, [key]: value });
  };

  return (
    <section className="flex h-full min-w-0 bg-[#101010] text-[#EDEDED]" data-testid="settings-view">
      <aside className="flex w-[278px] flex-shrink-0 flex-col border-r border-[#2A2A2A] bg-[#121212] px-3 py-3">
        <button
          className="mb-5 flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm text-[#BDBDBD] hover:bg-[#1F1F1F] hover:text-white"
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
              className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-[#A8A8A8] no-underline hover:bg-[#1F1F1F] hover:text-white"
            >
              <span className="grid h-5 w-5 place-items-center text-[#8A8A8A]">{navIcon(item)}</span>
              <span className="truncate">{item}</span>
            </a>
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <button className="flex h-10 w-full items-center gap-2 rounded-md border border-[#303030] bg-[#1E1E1E] px-2 text-left text-sm text-[#EDEDED] hover:bg-[#252525]">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2F2F2F] text-xs">SF</span>
            <span className="truncate">本地创作环境</span>
          </button>
          <div className="flex items-center gap-2 rounded-md bg-[#1A1A1A] px-2 py-2">
            <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#303030] text-xs font-semibold">
              SF
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-[#DCDCDC]">本地创作环境</div>
              <div className="truncate text-xs text-[#8E8E8E]">{providerConnection.label}</div>
            </div>
            <span className="grid h-7 w-7 place-items-center rounded-md bg-[#2B2B2B] text-[#BDBDBD]">
              <SettingsGlyph />
            </span>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[850px] px-8 py-8">
          <h1 className="mb-7 text-xl font-semibold text-white">设置</h1>

          <SettingGroup id="provider" title="模型服务">
            <SettingCard>
              <SelectRow
                title="服务类型"
                description="选择默认的模型服务来源。"
                value={safeSettings.provider.kind}
                onChange={(value) => {
                  const nextKind = toProviderKind(value);
                  update('provider', applyProviderPreset(safeSettings.provider, nextKind, { preserveModel: true }));
                }}
                options={PROVIDER_OPTIONS}
                testId="provider-kind"
              />
              <TextRow
                title="服务地址"
                description="填写兼容 OpenAI 协议的端点，或本地模型网关地址。"
                value={safeSettings.provider.baseUrl}
                placeholder="https://api.openai.com"
                onChange={(value) => update('provider', { ...safeSettings.provider, baseUrl: value })}
                testId="provider-base-url"
              />
              <TextRow
                title="默认模型"
                description="留空时交给运行时选择默认模型。"
                value={safeSettings.provider.model}
                placeholder="例如 gpt-4.1、deepseek-chat 或本地模型名"
                onChange={(value) => update('provider', { ...safeSettings.provider, model: value })}
                testId="provider-model"
              />
              <TextRow
                title="密钥引用"
                description="只保存环境变量名或密钥引用，不保存明文密钥。"
                value={safeSettings.provider.apiKeyRef}
                placeholder="例如 OPENAI_API_KEY"
                onChange={(value) => update('provider', { ...safeSettings.provider, apiKeyRef: value })}
                testId="provider-api-key-ref"
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

function SettingGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-8 scroll-mt-6">
      <h2 className="mb-3 text-sm font-medium text-[#D6D6D6]">{title}</h2>
      {children}
    </section>
  );
}

function SettingCard({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl bg-[#1A1A1A]">{children}</div>;
}

function RowShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[76px] items-center gap-4 border-b border-[#292929] px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="mt-1 text-sm leading-5 text-[#C9C9C9]">{description}</div>
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
          checked ? 'bg-[#43B373]' : 'bg-[#4A4A4A]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
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
          className="w-40 accent-[#43B373]"
          data-testid="editor-font-size"
        />
        <span className="w-10 text-sm tabular-nums text-[#EDEDED]">{value}px</span>
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
        className="h-8 w-[260px] rounded-md border border-[#343434] bg-[#111111] px-2 text-sm text-[#EDEDED] outline-none placeholder:text-[#666666] focus:border-[#777777]"
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
        className="h-8 w-[180px] rounded-md border border-[#343434] bg-[#111111] px-2 text-sm text-[#EDEDED] outline-none focus:border-[#777777]"
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
        className="h-8 rounded-md border border-[#343434] bg-[#151515] px-3 text-sm text-[#EDEDED] hover:bg-[#242424]"
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </RowShell>
  );
}

function navAnchor(label: string): string {
  if (label === '模型服务') return 'provider';
  if (label === '编辑器') return 'editor';
  return 'provider';
}

function navIcon(label: string): string {
  if (label === '模型服务') return '◈';
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
