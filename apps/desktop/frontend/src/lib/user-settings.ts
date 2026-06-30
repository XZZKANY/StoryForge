import { isProviderKind } from './provider-config';

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

export type AppSettings = {
  editorFontSize: number;
  autoSave: boolean;
  theme: ThemeMode;
  provider: ProviderSettings;
};

export const APP_SETTINGS_KEY = 'storyforge-app-settings';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  editorFontSize: 14,
  autoSave: false,
  theme: 'dark',
  provider: {
    kind: 'openai',
    baseUrl: 'https://api.openai.com',
    model: '',
    apiKeyRef: '',
  },
};

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
  return '';
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
    autoSave:
      typeof candidate.autoSave === 'boolean' ? candidate.autoSave : DEFAULT_APP_SETTINGS.autoSave,
    theme: candidate.theme === 'light' ? 'light' : DEFAULT_APP_SETTINGS.theme,
    provider: sanitizeProviderSettings(candidate.provider),
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
