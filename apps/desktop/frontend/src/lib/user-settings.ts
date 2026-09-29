import type { EditorFontMode, ProseMeasure } from '../components/editor/options';
import { isProviderKind } from './provider-config';
import { clampSidePanelWidth, SIDE_PANEL_WIDTH_DEFAULT } from './side-panel-width';

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'gemini'
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
  theme: ThemeMode;
  provider: ProviderSettings;
  polishProvider: ProviderSettings;
  /** 旧欢迎页偏好，仅保留序列化兼容；作品库不再由此隐藏。 */
  showWelcomeOnStartup: boolean;
  /** 选择上次作品时恢复页签与光标位置（旧配置字段兼容）。 */
  restoreLastSession: boolean;
  /** 作者拖过的侧面板宽度，全左栏共享一份（旧按视图 sidePanelWidths 加载时迁移）。 */
  sidePanelWidth: number;
};

export const APP_SETTINGS_KEY = 'storyforge-app-settings';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  editorFontSize: 14,
  editorFontMode: 'grid',
  editorProseMeasure: 'medium',
  editorLineNumbers: 'auto',
  dailyWordGoal: 3000,
  autoSave: false,
  theme: 'dark',
  provider: {
    kind: 'openai',
    baseUrl: 'https://api.openai.com',
    model: '',
    apiKeyRef: '',
  },
  polishProvider: {
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: '',
    apiKeyRef: '',
  },
  showWelcomeOnStartup: true,
  restoreLastSession: true,
  sidePanelWidth: SIDE_PANEL_WIDTH_DEFAULT,
};

/** 旧按视图宽度按 >300（旧宽档默认 340 之上）区分「主动加宽」与「收窄」信号。 */
const LEGACY_WIDE_SIGNAL_PX = 300;

/**
 * 旧 `sidePanelWidths: Record<view, px>` 迁移为共享单宽，确定性规则：
 * 新字段优先（调用方先判）；这里只看旧 map——丢非数字、逐项夹限后：
 * 空集 → null（交给默认）；全部相同 → 该值；存在 >300 的值 → 取最大（加宽是最强
 * 意图，也正是当初分视图记录的原因）；全 ≤300 → 取最大（最少收窄）。
 * 与 key 名和遍历顺序无关，同一份旧配置在任何机器上结果一致。
 */
function migrateSidePanelWidths(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const widths: number[] = [];
  for (const px of Object.values(value as Record<string, unknown>)) {
    if (typeof px === 'number' && Number.isFinite(px)) widths.push(clampSidePanelWidth(px));
  }
  if (widths.length === 0) return null;
  const first = widths[0];
  if (widths.every((width) => width === first)) return first;
  const widened = widths.filter((width) => width > LEGACY_WIDE_SIGNAL_PX);
  if (widened.length > 0) return Math.max(...widened);
  return Math.max(...widths);
}

/** 新字段已是有效数字就赢得一切；否则试迁移旧按视图 map，再退回共享默认。 */
function sanitizeSidePanelWidth(candidate: Partial<AppSettings>): number {
  const current = candidate.sidePanelWidth;
  if (typeof current === 'number' && Number.isFinite(current)) return clampSidePanelWidth(current);
  return (
    migrateSidePanelWidths((candidate as Record<string, unknown>).sidePanelWidths) ??
    SIDE_PANEL_WIDTH_DEFAULT
  );
}

function sanitizeProviderSettings(value: unknown, fallback: ProviderSettings): ProviderSettings {
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
    theme: candidate.theme === 'light' ? 'light' : DEFAULT_APP_SETTINGS.theme,
    provider: sanitizeProviderSettings(candidate.provider, DEFAULT_APP_SETTINGS.provider),
    polishProvider: sanitizeProviderSettings(
      candidate.polishProvider,
      DEFAULT_APP_SETTINGS.polishProvider,
    ),
    showWelcomeOnStartup:
      typeof candidate.showWelcomeOnStartup === 'boolean'
        ? candidate.showWelcomeOnStartup
        : DEFAULT_APP_SETTINGS.showWelcomeOnStartup,
    restoreLastSession:
      typeof candidate.restoreLastSession === 'boolean'
        ? candidate.restoreLastSession
        : DEFAULT_APP_SETTINGS.restoreLastSession,
    sidePanelWidth: sanitizeSidePanelWidth(candidate),
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
