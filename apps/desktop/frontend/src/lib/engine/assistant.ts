import { getVersion } from '@tauri-apps/api/app';
import {
  engineAssistantLlm,
  fetchProviderModels,
  probeProviderHealth,
  reviseFileContent,
  RunControl,
  streamContinueProse,
  validateAssistantContextBundle,
  type AssistantDeps,
  type LlmContext,
  type PlainJson,
  type SecretContext,
} from '@storyforge/engine';
import { toAssistantContextBundlePayload } from '../api/codecs';
import type { AssistantReviseResult, ContinueProseResult } from '../api/assistant';
import type { ReviseRequest } from '../api/types';
import { pluginLibraryDir } from '../plugin-library';
import type { ProviderHealth } from '../provider-config';
import { nativeHttpPort, nativeLlmSource } from './llm';
import { nativeProjectReader } from './reader';
import { engineSecrets, engineSessions } from './store';

export const clock = () => performance.now() / 1000;
export const wait = (seconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));

/** 作者取消（Esc、换文件）时在下一个读流边界停下，不再继续烧 key。 */
function abortControl(signal: AbortSignal | undefined): RunControl | null {
  if (!signal) return null;
  return new RunControl({
    checkInterruption: () => (signal.aborted ? 'stopped' : null),
    clock,
    wait,
  });
}

async function transportContext(
  signal: AbortSignal | undefined,
): Promise<Omit<LlmContext, 'secrets'>> {
  return {
    http: nativeHttpPort('main'),
    clock,
    wait,
    random: Math.random,
    appVersion: await getVersion(),
    control: abortControl(signal),
  };
}

export const platform = (): 'windows' | 'posix' =>
  navigator.userAgent.includes('Windows') ? 'windows' : 'posix';

export async function engineAssistantDeps(signal?: AbortSignal): Promise<AssistantDeps> {
  // 取不到插件库只是这一次不带插件的要求，修订、续写照常。
  const pluginLibraryRoot = await pluginLibraryDir().catch(() => null);
  return {
    reader: nativeProjectReader,
    // Ctrl+K / 续写记的会话与左栏、agent 循环同在引擎库。
    store: await engineSessions(await engineSecrets()),
    llm: async () => {
      const { source, secrets } = await nativeLlmSource('main');
      return engineAssistantLlm(source, secrets, await transportContext(signal));
    },
    platform: platform(),
    pluginLibraryRoot,
  };
}

/** 引擎错误的文本就是 Python 的 detail（状态码相同）；交给调用方的仍是普通 Error。 */
function asApiError(error: unknown): unknown {
  if (error instanceof Error && typeof (error as { status?: unknown }).status === 'number')
    return new Error(error.message);
  return error;
}

export async function reviseWithEngine(
  payload: Parameters<typeof import('../api/assistant').reviseFileContent>[0],
  deps?: AssistantDeps,
): Promise<AssistantReviseResult> {
  try {
    const data = await reviseFileContent(deps ?? (await engineAssistantDeps(payload.signal)), {
      file_path: payload.filePath,
      content: payload.content,
      instruction: payload.instruction,
      project_name: payload.projectName ?? null,
      project_root: payload.projectRoot ?? null,
      assistant_session_id: payload.assistantSessionId ?? null,
      quality_gate: payload.qualityGate ?? null,
    });
    return {
      before: data.before,
      after: data.after,
      summary: data.summary,
      model: data.model,
      latencyMs: data.latency_ms,
      completionTokens: data.completion_tokens,
      assistantSessionId: data.assistant_session_id,
    };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function continueWithEngine(
  payload: {
    filePath: string;
    content: string;
    cursorLine: number;
    instruction?: string | null;
    projectRoot?: string | null;
    assistantSessionId?: number | null;
    targetChars?: number | null;
    contextBundle?: ReviseRequest['contextBundle'];
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
  },
  deps?: AssistantDeps,
): Promise<ContinueProseResult> {
  const bundle = toAssistantContextBundlePayload(payload.contextBundle);
  let result: ContinueProseResult | null = null;
  let failure: string | null = null;
  try {
    await streamContinueProse(
      deps ?? (await engineAssistantDeps(payload.signal)),
      {
        file_path: payload.filePath,
        content: payload.content,
        cursor_line: payload.cursorLine,
        instruction: payload.instruction ?? null,
        project_root: payload.projectRoot ?? null,
        assistant_session_id: payload.assistantSessionId ?? null,
        target_chars: payload.targetChars ?? null,
        context_bundle: bundle ? validateAssistantContextBundle(bundle as PlainJson) : null,
      },
      (frame) => {
        if (frame.event === 'delta') payload.onDelta?.(frame.data.text);
        else if (frame.event === 'done')
          result = {
            text: frame.data.text,
            model: frame.data.model,
            assistantSessionId: frame.data.assistant_session_id,
          };
        else if (frame.event === 'error') failure = frame.data.message;
      },
    );
  } catch (error) {
    throw asApiError(error);
  }
  if (failure) throw new Error(failure);
  if (!result) throw new Error('续写流在返回结果前结束。');
  return result;
}

export async function probeWithEngine(): Promise<ProviderHealth> {
  let secrets: SecretContext = { values: [] };
  const data = await probeProviderHealth({
    resolveSource: async () => {
      const resolved = await nativeLlmSource('main');
      secrets = resolved.secrets;
      return resolved;
    },
    fetchModels: async (source, timeout) =>
      fetchProviderModels(source, timeout, { ...(await transportContext(undefined)), secrets }),
    clock,
  });
  return {
    status: data.status,
    reachable: data.reachable,
    baseUrl: data.base_url,
    model: data.model,
    latencyMs: data.latency_ms,
    modelCount: data.model_count,
    models: data.models,
    detail: data.detail,
    missingEnv: data.missing_env,
  };
}
