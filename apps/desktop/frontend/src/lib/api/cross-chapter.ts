import { getApiConfig, trimApiBaseUrl } from './config';
import { readErrorDetail } from './errors';
import type { CrossChapterFinding, CrossChapterRequest, CrossChapterResult } from './types';

/** 调后端跨章一致性端点 POST /api/ide/review/cross-chapter。 */
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
