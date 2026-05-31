export type ProviderModelsRequest = {
  readonly baseUrl?: string;
};

export type ProviderModelsResult =
  | { readonly ok: true; readonly models: readonly string[]; readonly endpoint: string }
  | { readonly ok: false; readonly message: string; readonly endpoint?: string };

type OpenAIModelList = {
  readonly data?: readonly unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readModelId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  return typeof id === 'string' && id.trim().length > 0 ? id : null;
}

export function normalizeProviderBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) return 'https://api.openai.com';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/v1$/i, '');
}

export async function probeProviderModels(
  input: ProviderModelsRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderModelsResult> {
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl ?? 'https://api.openai.com');
  const endpoint = `${baseUrl}/v1/models`;

  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        endpoint,
        message: `Provider 端点可达，但返回 ${response.status}，需要服务端凭据配置。`,
      };
    }

    if (!response.ok) {
      return { ok: false, endpoint, message: `模型接口返回 ${response.status}` };
    }

    const payload = (await response.json()) as OpenAIModelList;
    const models = Array.isArray(payload.data)
      ? payload.data
          .map(readModelId)
          .filter((id): id is string => id !== null)
          .sort()
      : [];

    if (models.length === 0) {
      return { ok: false, endpoint, message: '端点已响应，但模型列表为空或响应格式不兼容。' };
    }

    return { ok: true, endpoint, models };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      message: error instanceof Error ? error.message : '模型检测失败。',
    };
  }
}
