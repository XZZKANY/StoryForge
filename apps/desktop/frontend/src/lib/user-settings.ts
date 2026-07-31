import type { EditorFontMode, ProseMeasure } from '../components/editor/options';
import { isProviderKind } from './provider-config';
import { clampSidePanelWidth } from './side-panel-width';

export type ProviderKind =
  | 'openai'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'siliconflow'
  | 'ollama'
  | 'local'
  | 'openai-compatible';

export type ProviderSettings = {
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKeyRef: string;
};

export type ThemeMode = 'dark' | 'light';

export const AGENT_PERMISSION_PROFILES = [
  'read',
  'step_confirm',
  'risk_confirm',
  'autonomous',
] as const;

export type AgentPermissionProfile = (typeof AGENT_PERMISSION_PROFILES)[number];

export const DEFAULT_AGENT_PERMISSION_PROFILE: AgentPermissionProfile = 'risk_confirm';

export const AGENT_PERMISSION_PROFILE_OPTIONS: ReadonlyArray<{
  value: AgentPermissionProfile;
  label: string;
}> = [
  { value: 'read', label: '只读' },
  { value: 'step_confirm', label: '逐步确认' },
  { value: 'risk_confirm', label: '风险确认' },
  { value: 'autonomous', label: '自治' },
];

/** auto = 正文（Markdown）关行号、数据/代码文件开；on/off = 一刀切覆盖。 */
export type EditorLineNumbersMode = 'auto' | 'on' | 'off';

export type AppSettings = {
  editorFontSize: number;
  editorFontMode: EditorFontMode;
  editorProseMeasure: ProseMeasure;
  editorLineNumbers: EditorLineNumbersMode;
  /** 日更目标字数；0 = 不设目标，稿件卡不显示进度条。 */
  dailyWordGoal: number;
  autoSave: boolean;
  /** 下一次 AgentRun 的权限快照；运行中的 run 永远按其启动时 profile 执行。 */
  agentPermissionProfile: AgentPermissionProfile;
  theme: ThemeMode;
  provider: ProviderSettings;
  showWelcomeOnStartup: boolean;
  /** 启动时恢复上次的项目、页签与光标位置（写作时刻 01「恢复现场」）。 */
  restoreLastSession: boolean;
  /** 作者拖过的侧面板宽度，按视图各记一份；没拖过的视图吃档位默认（见 side-panel-width.ts）。 */
  sidePanelWidths: Record<string, number>;
};

export const APP_SETTINGS_KEY = 'storyforge-app-settings';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  editorFontSize: 14,
  editorFontMode: 'grid',
  editorProseMeasure: 'medium',
  editorLineNumbers: 'auto',
  dailyWordGoal: 3000,
  autoSave: false,
  agentPermissionProfile: DEFAULT_AGENT_PERMISSION_PROFILE,
  theme: 'dark',
  provider: {
    kind: 'openai',
    baseUrl: 'https://api.openai.com',
    model: '',
    apiKeyRef: '',
  },
  showWelcomeOnStartup: true,
  restoreLastSession: true,
  sidePanelWidths: {},
};

/** 逐项夹限并丢掉非数字：手改过的 localStorage 不该把面板撑成 0 或 5000。 */
function sanitizeSidePanelWidths(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [view, px] of Object.entries(value as Record<string, unknown>)) {
    if (typeof px === 'number' && Number.isFinite(px)) result[view] = clampSidePanelWidth(px);
  }
  return result;
}

function sanitizeProviderSettings(value: unknown): ProviderSettings {
  const fallback = DEFAULT_APP_SETTINGS.provider;
  if (!value || typeof value !== 'object') return fallback;

  const candidate = value as Partial<ProviderSettings>;
  const baseUrl =
    typeof candidate.baseUrl === 'string' ? candidate.baseUrl.trim() : fallback.baseUrl;
  const model = typeof candidate.model === 'string' ? candidate.model.trim() : fallback.model;
  const apiKeyRef =
    typeof candidate.apiKeyRef === 'string'
      ? sanitizeApiKeyReference(candidate.apiKeyRef)
      : fallback.apiKeyRef;

  return {
    kind: isProviderKind(candidate.kind) ? candidate.kind : fallback.kind,
    baseUrl: baseUrl || fallback.baseUrl,
    model,
    apiKeyRef,
  };
}

function sanitizeApiKeyReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) return trimmed;
  if (/^vault:\/\/[a-z0-9][a-z0-9_./:-]*$/i.test(trimmed)) return trimmed;
  if (/^stored:\/\/[a-z0-9][a-z0-9_./:-]*$/i.test(trimmed)) return trimmed;
  return '';
}

function isProseMeasure(value: unknown): value is ProseMeasure {
  return value === 'narrow' || value === 'medium' || value === 'wide' || value === 'full';
}

export function isAgentPermissionProfile(value: unknown): value is AgentPermissionProfile {
  return (
    typeof value === 'string' && AGENT_PERMISSION_PROFILES.includes(value as AgentPermissionProfile)
  );
}

export function sanitizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') return DEFAULT_APP_SETTINGS;

  const candidate = value as Partial<AppSettings>;
  const editorFontSize =
    typeof candidate.editorFontSize === 'number' && Number.isFinite(candidate.editorFontSize)
      ? Math.min(Math.max(Math.round(candidate.editorFontSize), 12), 20)
      : DEFAULT_APP_SETTINGS.editorFontSize;

  return {
    editorFontSize,
    editorFontMode: candidate.editorFontMode === 'prose' ? 'prose' : 'grid',
    editorProseMeasure: isProseMeasure(candidate.editorProseMeasure)
      ? candidate.editorProseMeasure
      : DEFAULT_APP_SETTINGS.editorProseMeasure,
    editorLineNumbers:
      candidate.editorLineNumbers === 'on' || candidate.editorLineNumbers === 'off'
        ? candidate.editorLineNumbers
        : 'auto',
    dailyWordGoal:
      typeof candidate.dailyWordGoal === 'number' && Number.isFinite(candidate.dailyWordGoal)
        ? Math.min(Math.max(Math.round(candidate.dailyWordGoal), 0), 50000)
        : DEFAULT_APP_SETTINGS.dailyWordGoal,
    autoSave:
      typeof candidate.autoSave === 'boolean' ? candidate.autoSave : DEFAULT_APP_SETTINGS.autoSave,
    agentPermissionProfile: isAgentPermissionProfile(candidate.agentPermissionProfile)
      ? candidate.agentPermissionProfile
      : DEFAULT_AGENT_PERMISSION_PROFILE,
    theme: candidate.theme === 'light' ? 'light' : DEFAULT_APP_SETTINGS.theme,
    provider: sanitizeProviderSettings(candidate.provider),
    showWelcomeOnStartup:
      typeof candidate.showWelcomeOnStartup === 'boolean'
        ? candidate.showWelcomeOnStartup
        : DEFAULT_APP_SETTINGS.showWelcomeOnStartup,
    restoreLastSession:
      typeof candidate.restoreLastSession === 'boolean'
        ? candidate.restoreLastSession
        : DEFAULT_APP_SETTINGS.restoreLastSession,
    sidePanelWidths: sanitizeSidePanelWidths(candidate.sidePanelWidths),
  };
}

export function loadAppSettings(): AppSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_APP_SETTINGS;
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    return raw ? sanitizeAppSettings(JSON.parse(raw)) : DEFAULT_APP_SETTINGS;
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(sanitizeAppSettings(settings)));
}
