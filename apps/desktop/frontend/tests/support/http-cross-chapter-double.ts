/**
 * 测试替身：跨章一致性检查接到可编排的 fetch 上（沿用早先 HTTP 传输的报文形状）。产品里它在进程内的
 * TS 引擎里跑；用它的界面测试关心的是聊天提交怎么分到跨章检查。接法：
 *   vi.mock('../src/lib/api/cross-chapter', () => import('./support/http-cross-chapter-double'));
 */
import { getApiConfig, trimApiBaseUrl } from './http-config';
import { readErrorDetail } from '../../src/lib/api/errors';
import type {
  CrossChapterFinding,
  CrossChapterRequest,
  CrossChapterResult,
} from '../../src/lib/api/types';

export async function requestCrossChapterConsistency(
  request: CrossChapterRequest,
): Promise<CrossChapterResult> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/ide/review/cross-chapter`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'X-StoryForge-API-Key': apiKey,
    },
    body: JSON.stringify({
      chapters: request.chapters,
      focus: request.focus ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  const data = (await response.json()) as {
    findings?: CrossChapterFinding[];
    model?: string | null;
    latency_ms?: number | null;
  };

  return {
    findings: data.findings ?? [],
    model: data.model ?? null,
    latencyMs: data.latency_ms ?? null,
  };
}
