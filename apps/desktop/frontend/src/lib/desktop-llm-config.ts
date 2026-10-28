import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './tauri-env';

/** 本机存的一套模型配置；Key 只在宿主里，界面只知道存没存。 */
export type LlmProfile = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};

export type LlmProfiles = {
  profiles: LlmProfile[];
  activeProfileId: string | null;
  /** null = 整章润色跟随当前那套。 */
  polishProfileId: string | null;
};

export type SavedLlmProfile = LlmProfiles & { savedProfileId: string };

/** 不带 id 是新建；Key 留空 = 保持原样，clearApiKey = 清除。 */
export type SaveLlmProfileRequest = {
  id?: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

/** 用还没保存的草稿拉一次模型列表；Key 留空时借 profileId 那套已存的 Key（只发往它原来的地址）。 */
export type LlmDraftProbeRequest = {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  profileId?: string;
};

export type LlmDraftModels = { models: string[]; partial: boolean };

export type LlmProbeFailureKind = 'unauthorized' | 'unreachable' | 'misconfigured';

export class LlmProbeError extends Error {
  constructor(
    message: string,
    readonly kind: LlmProbeFailureKind,
  ) {
    super(message);
    this.name = 'LlmProbeError';
  }
}

function readable(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object') {
    const { kind, message } = error as { kind?: unknown; message?: unknown };
    if (typeof message === 'string')
      return kind === 'unauthorized' || kind === 'misconfigured' || kind === 'unreachable'
        ? new LlmProbeError(message, kind)
        : new Error(message);
  }
  return new Error(typeof error === 'string' ? error : '本机模型配置操作失败');
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw readable(error);
  }
}

export const listLlmProfiles = () => call<LlmProfiles>('list_llm_profiles');

export const saveLlmProfile = (payload: SaveLlmProfileRequest) =>
  call<SavedLlmProfile>('save_llm_profile', { payload });

export const deleteLlmProfile = (id: string) => call<LlmProfiles>('delete_llm_profile', { id });

export const activateLlmProfile = (id: string) => call<LlmProfiles>('activate_llm_profile', { id });

export const setPolishLlmProfile = (id: string | null) =>
  call<LlmProfiles>('set_llm_polish_profile', { id });

export async function probeLlmDraft(payload: LlmDraftProbeRequest): Promise<LlmDraftModels> {
  const result = await call<LlmDraftModels>('probe_llm_draft', { payload });
  if (!result) throw new LlmProbeError('只有在桌面应用里才能获取模型列表。', 'misconfigured');
  return result;
}
