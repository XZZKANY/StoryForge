import { getVersion } from '@tauri-apps/api/app';
import {
  callLlm,
  checkCrossChapterConsistency,
  InputDomainError,
  LlmError,
  missingLlmEnv,
} from '@storyforge/engine';
import type { CrossChapterRequest, CrossChapterResult } from '../api/types';
import { clock, wait } from './assistant';
import { nativeHttpPort, nativeLlmSource } from './llm';

const isText = (value: unknown) => typeof value === 'string';

/** 与 `POST /api/ide/review/cross-chapter` 相同的错误文本（Python 的 detail；只有状态码的是「API 返回 N」）。 */
function routeError(error: unknown): Error {
  if (error instanceof LlmError) return new Error(`跨章一致性 LLM 调用失败：${error.message}`);
  if (error instanceof RangeError || error instanceof InputDomainError)
    return new Error(error.message);
  if (error instanceof Error && typeof (error as { status?: unknown }).status === 'number')
    return new Error(error.message);
  return new Error('API 返回 500');
}

/** ts 档的跨章一致性检查：整章正文交给模型，回 finding、模型名与耗时。 */
export async function crossChapterWithEngine(
  request: CrossChapterRequest,
): Promise<CrossChapterResult> {
  // 请求体校验（FastAPI 回 422、明细不是一句话）：至少两章，name / content 都是字符串。
  const chapters = request.chapters as unknown;
  if (
    !Array.isArray(chapters) ||
    chapters.length < 2 ||
    chapters.some((item) => !item || !isText(item.name) || !isText(item.content)) ||
    (request.focus != null && !isText(request.focus))
  )
    throw new Error('API 返回 422');
  const { source, secrets } = await nativeLlmSource('main');
  const missing = missingLlmEnv(source);
  if (missing.length) throw new Error(`真实 LLM 未配置：${missing.join(', ')}`);
  const appVersion = await getVersion();
  let result: Awaited<ReturnType<typeof checkCrossChapterConsistency>>;
  try {
    result = await checkCrossChapterConsistency(request.chapters, request.focus ?? null, {
      callLlm: async (prompts) =>
        (await callLlm(source, prompts, {
          http: nativeHttpPort('main'),
          clock,
          wait,
          random: Math.random,
          appVersion,
          secrets,
        })) as { content: unknown; latency_ms?: unknown },
      model: source.STORYFORGE_LLM_MODEL ?? null,
    });
  } catch (error) {
    throw routeError(error);
  }
  return {
    findings: result.findings as CrossChapterResult['findings'],
    model: result.model,
    latencyMs: typeof result.latency_ms === 'number' ? result.latency_ms : null,
  };
}
