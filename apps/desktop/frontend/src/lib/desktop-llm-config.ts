import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './tauri-env';

export type DesktopLlmConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};

export type SaveDesktopLlmConfigRequest = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

export async function getDesktopLlmConfig(): Promise<DesktopLlmConfig | null> {
  if (!isTauriRuntime()) return null;
  return invoke<DesktopLlmConfig>('get_llm_config');
}

export async function saveDesktopLlmConfig(
  payload: SaveDesktopLlmConfigRequest,
): Promise<DesktopLlmConfig | null> {
  if (!isTauriRuntime()) return null;
  return invoke<DesktopLlmConfig>('save_llm_config', { payload });
}

export async function restartDesktopApiServer(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke('restart_api_server');
  return true;
}
