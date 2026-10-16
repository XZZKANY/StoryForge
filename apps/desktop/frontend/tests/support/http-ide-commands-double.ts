/**
 * 测试替身：IDE 命令接到可编排的 fetch 上（沿用早先 HTTP 传输的报文形状）。产品里命令在进程内的
 * TS 引擎里跑；浏览器回归（没有 Tauri 原生端口）经 `scripts/http-doubles-plugin.mjs` 换成它。
 */
import { getApiConfig, trimApiBaseUrl } from './http-config';
import { readErrorDetail } from '../../src/lib/api/errors';

export async function executeIdeCommand(
  commandId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(
    `${trimApiBaseUrl(baseUrl)}/api/ide/commands/${encodeURIComponent(commandId)}`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-StoryForge-API-Key': apiKey },
      body: JSON.stringify({ args }),
    },
  );
  if (!response.ok) throw new Error(await readErrorDetail(response));
  return (await response.json()) as Record<string, unknown>;
}
