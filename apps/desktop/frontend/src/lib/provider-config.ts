import type { ApiProviderHealthResponse } from './api/contracts';
import type { ProviderKind, ProviderSettings } from './user-settings';

export type ProviderPreset = Omit<ProviderSettings, 'model'> & {
  label: string;
  defaultModel: string;
};

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  openai: {
    kind: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    apiKeyRef: 'OPENAI_API_KEY',
    defaultModel: '',
  },
  anthropic: {
    kind: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyRef: 'ANTHROPIC_API_KEY',
    defaultModel: '',
  },
  gemini: {
    kind: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyRef: 'GEMINI_API_KEY',
    defaultModel: '',
  },
  deepseek: {
    kind: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiKeyRef: 'DEEPSEEK_API_KEY',
    defaultModel: '',
  },
  qwen: {
    kind: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    apiKeyRef: 'DASHSCOPE_API_KEY',
    defaultModel: '',
  },
  kimi: {
    kind: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn',
    apiKeyRef: 'MOONSHOT_API_KEY',
    defaultModel: '',
  },
  siliconflow: {
    kind: 'siliconflow',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn',
    apiKeyRef: 'SILICONFLOW_API_KEY',
    defaultModel: '',
  },
  ollama: {
    kind: 'ollama',
    label: 'Ollama 本地',
    baseUrl: 'http://localhost:11434',
    apiKeyRef: '',
    defaultModel: '',
  },
  'openai-compatible': {
    kind: 'openai-compatible',
    label: '自定义兼容 OpenAI',
    baseUrl: 'https://api.openai.com',
    apiKeyRef: '',
    defaultModel: '',
  },
};

export const PROVIDER_OPTIONS: Array<{ value: ProviderKind; label: string }> = Object.values(
  PROVIDER_PRESETS,
).map((preset) => ({
  value: preset.kind,
  label: preset.label,
}));

export function isProviderKind(value: unknown): value is ProviderKind {
  return Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, String(value));
}

/**
 * 旧版「StoryForge 本地网关」指向已删除的 Python 后端；存过它的配置按兼容 OpenAI 读，
 * 地址原样保留——请求协议本来就是同一族，作者看得见那个失效的地址再自己改。
 */
export function providerKindOr(value: unknown, fallback: ProviderKind): ProviderKind {
  if (value === 'local') return 'openai-compatible';
  return isProviderKind(value) ? value : fallback;
}

export function getProviderPreset(kind: ProviderKind): ProviderPreset {
  return PROVIDER_PRESETS[kind];
}

export function applyProviderPreset(
  current: ProviderSettings,
  kind: ProviderKind,
  options: { preserveModel?: boolean } = {},
): ProviderSettings {
  const preset = getProviderPreset(kind);
  return {
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    apiKeyRef: preset.apiKeyRef,
    model: options.preserveModel ? current.model : preset.defaultModel,
  };
}

// 引擎报缺项用的是内部键名，界面换成设置页上的字段名。
const MISSING_FIELD_LABELS: Record<string, string> = {
  STORYFORGE_LLM_PROVIDER: '服务类型',
  STORYFORGE_LLM_BASE_URL: '服务地址',
  STORYFORGE_LLM_MODEL: '默认模型',
  STORYFORGE_LLM_API_KEY: 'API Key',
};

export type ProviderHealthStatus = ApiProviderHealthResponse['status'];

/** 后端 /api/assistant/provider-health 的结构化探测结果（camelCase 化）。 */
export type ProviderHealth = {
  status: ProviderHealthStatus;
  reachable: boolean;
  baseUrl: string | null;
  model: string | null;
  latencyMs: number | null;
  modelCount: number | null;
  models: string[];
  detail: string | null;
  missingEnv: string[];
};

export type ProviderHealthDisplay = {
  tone: 'ok' | 'warn' | 'error' | 'pending';
  label: string;
};

// 把探测结果转成「测试连接」按钮旁的一行人类可读状态；探的是本机已保存的配置，不是 localStorage。
export function describeProviderHealth(health: ProviderHealth): ProviderHealthDisplay {
  switch (health.status) {
    case 'ok': {
      const parts = ['模型服务可达'];
      if (health.model) parts.push(health.model);
      if (typeof health.latencyMs === 'number') parts.push(`${health.latencyMs}ms`);
      if (typeof health.modelCount === 'number') parts.push(`${health.modelCount} 个模型`);
      return { tone: 'ok', label: parts.join(' · ') };
    }
    case 'unauthorized':
      return { tone: 'error', label: `鉴权失败：${health.detail ?? '密钥无效'}` };
    case 'misconfigured': {
      const label = health.missingEnv.length
        ? `还没填：${health.missingEnv.map((name) => MISSING_FIELD_LABELS[name] ?? name).join('、')}`
        : (health.detail ?? '还没配置模型服务');
      return { tone: 'warn', label };
    }
    case 'unreachable':
    default:
      return { tone: 'error', label: `不可达：${health.detail ?? '连接失败'}` };
  }
}
