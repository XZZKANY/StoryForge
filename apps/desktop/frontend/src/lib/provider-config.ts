import type { ApiProviderHealthResponse } from './api/contracts';
import type { ProviderKind, ProviderSettings } from './user-settings';

export type ProviderPreset = Omit<ProviderSettings, 'model'> & {
  label: string;
  defaultModel: string;
};

export type ProviderConnectionState = {
  status: 'ready' | 'needs-api-key' | 'local' | 'incomplete';
  label: string;
};

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  openai: {
    kind: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    apiKeyRef: 'OPENAI_API_KEY',
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
  local: {
    kind: 'local',
    label: 'StoryForge 本地网关',
    baseUrl: 'http://localhost:8000',
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

export function describeProviderConnection(settings: ProviderSettings): ProviderConnectionState {
  const baseUrl = settings.baseUrl.trim();
  if (!baseUrl) {
    return {
      status: 'incomplete',
      label: '服务地址未填写',
    };
  }

  if (settings.kind === 'local' || settings.kind === 'ollama') {
    return {
      status: 'local',
      label: '本地模型服务',
    };
  }

  if (!settings.apiKeyRef.trim()) {
    return {
      status: 'needs-api-key',
      label: '缺少密钥引用',
    };
  }

  return {
    status: 'ready',
    label: '模型服务已配置',
  };
}

export type ProviderHealthStatus = ApiProviderHealthResponse['status'];

/** 后端 /api/assistant/provider-health 的结构化探测结果（camelCase 化）。 */
export type ProviderHealth = {
  status: ProviderHealthStatus;
  reachable: boolean;
  baseUrl: string | null;
  model: string | null;
  latencyMs: number | null;
  modelCount: number | null;
  detail: string | null;
  missingEnv: string[];
};

export type ProviderHealthDisplay = {
  tone: 'ok' | 'warn' | 'error' | 'pending';
  label: string;
};

// 把后端探测结果转成「测试连接」按钮旁的一行人类可读状态；探的是后端实际配置，不是 localStorage。
export function describeProviderHealth(health: ProviderHealth): ProviderHealthDisplay {
  switch (health.status) {
    case 'ok': {
      const parts = ['后端模型服务可达'];
      if (health.model) parts.push(health.model);
      if (typeof health.latencyMs === 'number') parts.push(`${health.latencyMs}ms`);
      if (typeof health.modelCount === 'number') parts.push(`${health.modelCount} 个模型`);
      return { tone: 'ok', label: parts.join(' · ') };
    }
    case 'unauthorized':
      return { tone: 'error', label: `鉴权失败：${health.detail ?? '密钥无效'}` };
    case 'misconfigured': {
      const label = health.missingEnv.length
        ? `后端未配置：缺 ${health.missingEnv.join('、')}`
        : (health.detail ?? '后端未配置模型服务');
      return { tone: 'warn', label };
    }
    case 'unreachable':
    default:
      return { tone: 'error', label: `不可达：${health.detail ?? '连接失败'}` };
  }
}
