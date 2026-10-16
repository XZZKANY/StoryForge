import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import {
  dumpJson,
  engineAssistantLlm,
  ModelObservation,
  requestSnapshot,
  type AssistantDeps,
  type AssistantStore,
  type ChatRequest,
  type HttpPort,
  type LlmSource,
  type SecretContext,
} from '@storyforge/engine';
import type { AssistantReviseResult, ContinueProseResult } from '../api/assistant';
import { clock, continueWithEngine, engineAssistantDeps, reviseWithEngine } from './assistant';
import { nativeLlmSource } from './llm';
import {
  compareCaptures,
  parsePythonCaptures,
  type PromptCapture,
  type ShadowComparison,
} from './shadowDiff';

/**
 * 影子档（迁移计划 §4.2，P5-1）：结果照旧给 Python 的；引擎对同一份输入组出自己的请求，
 * 在派发前取快照并中止（不出网、不花钱、不写会话），与 Python 交回的快照比对。
 * 比对结果交 Rust 追加到本地数据目录：每次比对一行 `shadow-checks.jsonl`，有差异另记一行
 * `shadow-diffs.jsonl`。影子这一侧出什么错都不影响作者拿到的结果。
 */
export type ShadowSurface =
  | 'assistant.revise'
  | 'assistant.continue'
  | 'agent.loop'
  | 'ide.command';

class ShadowCaptured extends Error {}

/** 双保险：观察者在派发前就中止；万一有路径绕过观察者，这个端口也不出网。 */
export const refusingHttp: HttpPort = {
  send: () => Promise.reject(new Error('影子档不出网')),
};

/** 读作者那一侧的会话（只用来核对会话归属），写一律丢弃：证据链只记 Python 那一份。 */
function discardingStore(read: AssistantStore): AssistantStore {
  return {
    createSession: async (input) => ({ id: 0, project_path: input.project_path }),
    getSession: (id) => read.getSession(id),
    appendMessage: async () => undefined,
    createToolCall: async (_session, input) => ({ id: 0, input_summary: input.input_summary }),
    updateToolCall: async (_id, patch) => ({ id: 0, input_summary: patch.input_summary ?? {} }),
  };
}

function snapshotOf(
  request: ChatRequest,
  fields: { source: LlmSource; streaming: boolean; operation: string },
  secrets: SecretContext,
): PromptCapture {
  const { operation: step, streaming } = fields;
  try {
    const snapshot = requestSnapshot(request, fields.source, secrets);
    return {
      step,
      streaming,
      // 引擎的值里有浮点标记，比对用解析后的普通 JSON；摘要已由快照按 Python 编码算好。
      request: JSON.parse(dumpJson(snapshot.request, { ensureAscii: false })) as {
        [key: string]: unknown;
      },
      requestDigest: snapshot.request_digest as string,
    };
  } catch {
    return { step, streaming, error: 'snapshot_failed' };
  }
}

export type TsCapture = { capture: PromptCapture | null; error: string | null; detail?: string };

/** 只记错误类名：错误文本可能带着作者的稿子。 */
export const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/**
 * agent 宿主错误帧的文案：引擎在发出第一个请求前失败时写的是固定提示（配置、路径、版本核对），
 * 不经模型、不引正文；仍截短，免得哪条提示带出长路径。
 */
export const errorDetail = (detail: unknown) =>
  typeof detail === 'string' ? Array.from(detail).slice(0, 160).join('') : typeof detail;

/** 用作者这一次的输入跑一遍引擎，只取第一次派发的快照。 */
async function captureEngine(run: (deps: AssistantDeps) => Promise<unknown>): Promise<TsCapture> {
  let capture: PromptCapture | null = null;
  try {
    const base = await engineAssistantDeps();
    const appVersion = await getVersion();
    await run({
      ...base,
      store: discardingStore(base.store),
      llm: async () => {
        const { source, secrets } = await nativeLlmSource('main');
        const observation = new ModelObservation({
          begin: async (request, fields) => {
            capture ??= snapshotOf(request, fields, secrets);
            throw new ShadowCaptured();
          },
        });
        return engineAssistantLlm(source, secrets, {
          http: refusingHttp,
          clock,
          wait: async () => undefined,
          random: () => 0,
          appVersion,
          control: null,
          observation,
        });
      },
    });
    return { capture, error: null };
  } catch (error) {
    return { capture, error: capture ? null : errorName(error) };
  }
}

export async function appendShadow(
  log: 'diffs' | 'checks',
  record: Record<string, unknown>,
): Promise<void> {
  try {
    await invoke('engine_shadow_append', { log, record });
  } catch {
    // 记不上就算了：作者的结果已经交出去，checks 文件缺行即说明影子没记上。
  }
}

export const shadowCheckHeader = async (surface: ShadowSurface) => ({
  at: new Date().toISOString(),
  app_version: await getVersion().catch(() => null),
  surface,
});

/** 这一次没法比（比如 Python 的库不在本机）：只记一行 checks，不算差异。 */
export async function recordShadowUnavailable(surface: ShadowSurface, reason: string) {
  await appendShadow('checks', {
    ...(await shadowCheckHeader(surface)),
    outcome: 'unavailable',
    reason,
  });
}

export async function recordShadow(
  surface: ShadowSurface,
  python: PromptCapture[] | null,
  ts: TsCapture,
): Promise<void> {
  const first = python?.[0] ?? null;
  const comparison: ShadowComparison =
    python === null
      ? {
          outcome: 'diff',
          differences: [{ path: 'shadow', kind: 'python_capture_invalid' }],
          truncated: false,
        }
      : compareCaptures(first, ts.capture);
  const digest = (capture: PromptCapture | null) =>
    capture && 'requestDigest' in capture ? capture.requestDigest : null;
  const check: Record<string, unknown> = {
    ...(await shadowCheckHeader(surface)),
    outcome: comparison.outcome,
    step: first?.step ?? ts.capture?.step ?? null,
    python_digest: digest(first),
    ts_digest: digest(ts.capture),
    python_requests: python?.length ?? null,
    ...(ts.error ? { ts_error: ts.error } : {}),
    ...(ts.detail ? { ts_detail: ts.detail } : {}),
  };
  await appendShadow('checks', check);
  if (comparison.outcome === 'diff')
    await appendShadow('diffs', {
      ...check,
      differences: comparison.differences,
      ...(comparison.truncated ? { truncated: true } : {}),
    });
}

/**
 * Python 那一侧照常请求（带上影子头）；引擎同时复算，两边都结束后在后台比对记账。
 * Python 失败就原样抛给作者，这一次不比（没有可比的请求）。
 */
async function shadowed<T>(
  surface: ShadowSurface,
  python: () => Promise<{ result: T; captures: unknown }>,
  engine: (deps: AssistantDeps) => Promise<unknown>,
): Promise<T> {
  const ts = captureEngine(engine);
  const { result, captures } = await python();
  void ts.then((capture) => recordShadow(surface, parsePythonCaptures(captures), capture));
  return result;
}

type RevisePayload = Parameters<typeof reviseWithEngine>[0];
type ContinuePayload = Parameters<typeof continueWithEngine>[0];

export function shadowRevise(
  payload: RevisePayload,
  python: () => Promise<{ result: AssistantReviseResult; captures: unknown }>,
): Promise<AssistantReviseResult> {
  const { signal: _signal, ...input } = payload;
  return shadowed('assistant.revise', python, (deps) => reviseWithEngine(input, deps));
}

export function shadowContinue(
  payload: ContinuePayload,
  python: () => Promise<{ result: ContinueProseResult; captures: unknown }>,
): Promise<ContinueProseResult> {
  const { signal: _signal, onDelta: _onDelta, ...input } = payload;
  return shadowed('assistant.continue', python, (deps) => continueWithEngine(input, deps));
}
