import 'server-only';

import type { components } from '@storyforge/shared';

export type ApiSchemas = components['schemas'];
export type ApiResponseSchema<Name extends keyof ApiSchemas> = ApiSchemas[Name];

export type ApiResult<T> =
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly message: string };

const defaultApiBaseUrl = 'http://127.0.0.1:8000';
type ApiQueryParams = Record<string, string | number | undefined | null>;

export type ApiFetchInit = RequestInit & {
  readonly params?: ApiQueryParams;
};

export function getApiBaseUrl(): string {
  return process.env.STORYFORGE_API_BASE_URL ?? defaultApiBaseUrl;
}

export function buildApiUrl(path: string, params: ApiQueryParams = {}): URL {
  const url = new URL(path, getApiBaseUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function getApiKey(): string {
  const apiKey = process.env.STORYFORGE_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 STORYFORGE_API_KEY，无法调用 StoryForge API。');
  }
  return apiKey;
}

export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const { params, headers, ...requestInit } = init;
  const apiHeaders = new Headers(headers);
  apiHeaders.set('X-StoryForge-API-Key', getApiKey());

  return fetch(buildApiUrl(path, params), {
    ...requestInit,
    cache: 'no-store',
    headers: apiHeaders,
  });
}

export async function readJson<T>(
  path: string,
  options: {
    readonly params?: Record<string, string | number | undefined | null>;
    readonly validate: (value: unknown) => value is T;
    readonly invalidMessage: string;
    readonly init?: RequestInit;
  },
): Promise<ApiResult<T>> {
  try {
    const response = await apiFetch(path, {
      ...options.init,
      params: options.params,
    });
    if (!response.ok) {
      return { status: 'error', message: `API 返回 ${response.status}` };
    }
    const payload: unknown = await response.json();
    if (!options.validate(payload)) {
      return { status: 'error', message: options.invalidMessage };
    }
    return { status: 'ready', data: payload };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : '未知错误' };
  }
}
