/**
 * 测试替身：章节检查历史接到可编排的 fetch 上（沿用早先 HTTP 传输的报文形状），解码仍走产品的
 * `decodeChapterCheckHistory`。浏览器回归（没有 Tauri 原生端口）经 `scripts/http-doubles-plugin.mjs` 换成它。
 */
import { getApiConfig, trimApiBaseUrl } from './http-config';
import { readErrorDetail } from '../../src/lib/api/errors';
import {
  decodeChapterCheckHistory,
  type ChapterCheckHistory,
  type ChapterCheckHistoryRequest,
} from '../../src/lib/api/chapter-checks';

export async function queryChapterCheckHistory(
  request: ChapterCheckHistoryRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ChapterCheckHistory> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/agent-runs/chapter-checks/query`, {
    method: 'POST',
    signal: options.signal,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-StoryForge-API-Key': apiKey },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(await readErrorDetail(response));
  return decodeChapterCheckHistory(await response.json(), request);
}
