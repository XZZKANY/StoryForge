import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../tauri-env';
import type { ApiConfig } from './types';
import { decodeNativeApiConfig } from './managed-agent-host';

function getPreviewApiConfig(): ApiConfig {
  const env = import.meta.env ?? {};
  return {
    baseUrl: env.VITE_STORYFORGE_API_BASE_URL ?? 'http://127.0.0.1:8000',
    apiKey: env.VITE_STORYFORGE_API_KEY ?? 'local-dev-key',
    managedHostGeneration: null,
    executionProtocols: [],
  };
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
