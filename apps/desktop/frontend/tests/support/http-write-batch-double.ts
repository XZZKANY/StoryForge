/**
 * 测试替身：批量写章计划要读真作品与引擎库（Tauri 原生端口），浏览器回归没有。这里把请求发到可编排的 fetch 上，
 * 回包照样走产品的 `decodeWriteBatchPlan`。经 `scripts/http-doubles-plugin.mjs` 换进去，其余导出照用原模块。
 */
import { getApiConfig, trimApiBaseUrl } from './http-config';
import { readErrorDetail } from '../../src/lib/api/errors';
import type { AgentPermissionProfile } from '../../src/lib/agent-permission';
import type { ApiWriteBatchPlan } from '../../src/lib/api/contracts';
import { decodeWriteBatchPlan } from '../../src/lib/api/write-batch';

export async function planWriteBatch(input: {
  projectRoot: string;
  from: number;
  to: number;
  permissionProfile: AgentPermissionProfile;
}): Promise<ApiWriteBatchPlan> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/write-batch/plan`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-StoryForge-API-Key': apiKey },
    body: JSON.stringify({
      project_root: input.projectRoot,
      from: input.from,
      to: input.to,
      permission_profile: input.permissionProfile,
    }),
  });
  if (!response.ok) throw new Error(await readErrorDetail(response));
  return decodeWriteBatchPlan(await response.json());
}
