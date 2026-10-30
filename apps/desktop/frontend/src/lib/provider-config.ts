import type { ApiProviderHealthResponse } from './api/contracts';

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'siliconflow'
  | 'ollama'
  | 'openai-compatible';

export type ProviderPreset = {
  kind: ProviderKind;
  label: string;
  /** 引擎在这个地址后面接 /chat/completions、/models，所以兼容服务要写到 /v1。空 = 作者自己填。 */
  baseUrl: string;
};

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  openai: { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { kind: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  gemini: {
    kind: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  deepseek: { kind: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  qwen: {
    kind: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  kimi: { kind: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  siliconflow: {
    kind: 'siliconflow',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
  },
  ollama: { kind: 'ollama', label: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1' },
  // 中转地址因人而异，不预填，免得作者没改就把 Key 发去别家。
  'openai-compatible': { kind: 'openai-compatible', label: '自定义 / 中转', baseUrl: '' },
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

/** 一套配置在卡片上的名字：作者起过名就用名字，否则「服务商 · 模型」。 */
export function profileTitle(profile: { name: string; provider: string; model: string }): string {
  const kind = providerKindOr(profile.provider, 'openai-compatible');
  return (
    profile.name.trim() ||
    `${getProviderPreset(kind).label} · ${profile.model.trim() || '未选模型'}`
  );
}

/** 对话下拉里一组模型的组名：有名字用名字，没有就用服务商名。 */
export function providerTitle(profile: { name: string; provider: string }): string {
  return (
    profile.name.trim() ||
    getProviderPreset(providerKindOr(profile.provider, 'openai-compatible')).label
  );
}

// 引擎报缺项用的是内部键名，界面换成设置页上的字段名。
const MISSING_FIELD_LABELS: Record<string, string> = {
  STORYFORGE_LLM_PROVIDER: '服务商',
  STORYFORGE_LLM_BASE_URL: '服务地址',
  STORYFORGE_LLM_MODEL: '模型',
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

// 把探测结果转成配置卡片上的一行人类可读状态；探的是本机已保存的那套配置。
// 探测只拉模型列表、不真发对话，所以文案只说「列表可达」，免得作者把它当成对话一定能用。
export function describeProviderHealth(health: ProviderHealth): ProviderHealthDisplay {
  switch (health.status) {
    case 'ok': {
      const models = health.models ?? [];
      if (health.model && models.length && !health.detail && !models.includes(health.model))
        return {
          tone: 'warn',
          label: `模型列表可达，但列表里没有「${health.model}」，对话可能会失败`,
        };
      const parts = ['模型列表可达'];
      if (health.model) parts.push(health.model);
      if (typeof health.latencyMs === 'number') parts.push(`${health.latencyMs}ms`);
      if (typeof health.modelCount === 'number') parts.push(`${health.modelCount} 个模型`);
      return { tone: 'ok', label: `${parts.join(' · ')}（只查了列表，没有真发对话）` };
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
