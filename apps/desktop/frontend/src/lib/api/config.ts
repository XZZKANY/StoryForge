import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../tauri-env';
import type { ApiConfig } from './types';

type TauriApiConfig = {
  baseUrl: string;
  apiKey: string;
};

function getPreviewApiConfig(): ApiConfig {
  const env = import.meta.env ?? {};
  return {
    baseUrl: env.VITE_STORYFORGE_API_BASE_URL ?? 'http://127.0.0.1:8000',
    apiKey: env.VITE_STORYFORGE_API_KEY ?? 'local-dev-key',
  };
}

export async function getApiConfig(): Promise<ApiConfig> {
  if (!isTauriRuntime()) {
    return getPreviewApiConfig();
  }

  const config = await invoke<TauriApiConfig>('get_api_config');
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  };
}

export function trimApiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
