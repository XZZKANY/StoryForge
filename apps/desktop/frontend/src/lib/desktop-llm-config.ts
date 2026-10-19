import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './tauri-env';

export type DesktopLlmSlotConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};

export type DesktopLlmConfig = DesktopLlmSlotConfig & {
  polish: DesktopLlmSlotConfig | null;
};

export type SaveDesktopLlmSlotRequest = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

// 只保存润色槽时不带主槽字段：宿主保持主槽原样，不把设置页里没保存的主模型草稿写进去。
export type SaveDesktopLlmConfigRequest = Partial<SaveDesktopLlmSlotRequest> & {
  polish?: SaveDesktopLlmSlotRequest;
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
