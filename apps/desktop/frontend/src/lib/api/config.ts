import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../tauri-env';
import type { ApiConfig } from './types';

function getPreviewApiConfig(): ApiConfig {
  const env = import.meta.env ?? {};
  return {
    baseUrl: env.VITE_STORYFORGE_API_BASE_URL ?? 'http://127.0.0.1:8000',
    apiKey: env.VITE_STORYFORGE_API_KEY ?? 'local-dev-key',
  };
}

function decodeNativeApiConfig(value: unknown): ApiConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native API config is invalid');
  }
  const fields = value as Record<string, unknown>;
  if (typeof fields.baseUrl !== 'string' || typeof fields.apiKey !== 'string') {
    throw new Error('Native API config is invalid');
  }
  return { baseUrl: fields.baseUrl, apiKey: fields.apiKey };
}

export async function getApiConfig(): Promise<ApiConfig> {
  if (!isTauriRuntime()) {
    return getPreviewApiConfig();
  }

  return decodeNativeApiConfig(await invoke<unknown>('get_api_config'));
}

export function trimApiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
