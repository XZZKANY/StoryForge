/**
 * 测试替身：批量写章计划、记录与「下一步」要读真作品与引擎库（Tauri 原生端口），浏览器回归没有。这里把请求发到
 * 可编排的 fetch 上，回包照样走产品的解码器（`decodeWriteBatch*`）。经 `scripts/http-doubles-plugin.mjs` 换进去，
 * 其余导出照用原模块。
 */
import { getApiConfig, trimApiBaseUrl } from './http-config';
import { readErrorDetail } from '../../src/lib/api/errors';
import type { AgentPermissionProfile } from '../../src/lib/agent-permission';
import type {
  ApiWriteBatch,
  ApiWriteBatchPlan,
  ApiWriteBatchRecovery,
  ApiWriteBatchStartResult,
  ApiWriteBatchStep,
  ApiWriteBatchView,
} from '../../src/lib/api/contracts';
import {
  decodeWriteBatch,
  decodeWriteBatchPlan,
  decodeWriteBatchStart,
  decodeWriteBatchStep,
  decodeWriteBatchView,
  type WriteBatchInterfaceStopCode,
} from '../../src/lib/api/write-batch';

async function post(name: string, body: unknown): Promise<unknown> {
  const { baseUrl, apiKey } = await getApiConfig();
  const response = await fetch(`${trimApiBaseUrl(baseUrl)}/api/write-batch/${name}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-StoryForge-API-Key': apiKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readErrorDetail(response));
  return response.json();
}

export async function planWriteBatch(input: {
  projectRoot: string;
  from: number;
  to: number;
  permissionProfile: AgentPermissionProfile;
}): Promise<ApiWriteBatchPlan> {
  return decodeWriteBatchPlan(
    await post('plan', {
      project_root: input.projectRoot,
      from: input.from,
      to: input.to,
      permission_profile: input.permissionProfile,
    }),
  );
}

export async function startWriteBatch(input: {
  projectRoot: string;
  from: number;
  to: number;
  permissionProfile: AgentPermissionProfile;
  modelKey: string;
}): Promise<ApiWriteBatchStartResult> {
  return decodeWriteBatchStart(
    await post('start', {
      project_root: input.projectRoot,
      from: input.from,
      to: input.to,
      permission_profile: input.permissionProfile,
      model_key: input.modelKey,
    }),
  );
}

export async function resumeWriteBatch(input: {
  projectRoot: string;
  permissionProfile: AgentPermissionProfile;
  modelKey: string;
}): Promise<ApiWriteBatchStartResult> {
  return decodeWriteBatchStart(
    await post('resume', {
      project_root: input.projectRoot,
      permission_profile: input.permissionProfile,
      model_key: input.modelKey,
    }),
  );
}

export async function recordWriteBatchChapter(input: {
  projectRoot: string;
  batchId: string;
  ordinal: number;
  runId: string;
  writtenPath: string | null;
  snapshotVersion: string | null;
  factsBefore: string | null;
  factDisputes: number;
}): Promise<ApiWriteBatch> {
  return decodeWriteBatch(
    await post('record', {
      project_root: input.projectRoot,
      batch_id: input.batchId,
      ordinal: input.ordinal,
      run_id: input.runId,
      written_path: input.writtenPath,
      snapshot_version: input.snapshotVersion,
      facts_before: input.factsBefore,
      fact_disputes: input.factDisputes,
    }),
  );
}

export async function nextWriteBatchStep(input: {
  projectRoot: string;
  batchId: string;
  permissionProfile: AgentPermissionProfile;
  modelKey: string;
}): Promise<ApiWriteBatchStep> {
  return decodeWriteBatchStep(
    await post('next', {
      project_root: input.projectRoot,
      batch_id: input.batchId,
      permission_profile: input.permissionProfile,
      model_key: input.modelKey,
    }),
  );
}

export async function stopWriteBatch(input: {
  projectRoot: string;
  batchId: string;
  code: WriteBatchInterfaceStopCode;
  message: string;
}): Promise<ApiWriteBatch> {
  return decodeWriteBatch(
    await post('stop', {
      project_root: input.projectRoot,
      batch_id: input.batchId,
      code: input.code,
      message: input.message,
    }),
  );
}

export async function recoverInterruptedWriteBatch(
  projectRoot: string,
): Promise<ApiWriteBatchRecovery> {
  const raw = (await post('recover', { project_root: projectRoot })) as {
    recovered: boolean;
    batch: unknown;
  };
  return {
    recovered: raw.recovered,
    batch: raw.batch === null ? null : decodeWriteBatch(raw.batch),
  };
}

export async function markWriteBatchReviewed(
  projectRoot: string,
  batchId: string,
): Promise<ApiWriteBatch> {
  return decodeWriteBatch(await post('reviewed', { project_root: projectRoot, batch_id: batchId }));
}

export async function readWriteBatch(projectRoot: string): Promise<ApiWriteBatchView> {
  return decodeWriteBatchView(await post('read', { project_root: projectRoot }));
}

/** 浏览器里没有宿主的模型配置：固定一个标识，回归只核它被原样带上。 */
export async function currentWriteBatchModelKey(): Promise<string> {
  return 'browser-fixture-model';
}

/** 与引擎 formatTokenCount 同一种说法（引擎测试钉住规则）；替身里照抄，免得浏览器里装整个引擎。 */
export async function formatWriteBatchTokens(tokens: number): Promise<string> {
  const tenths = Math.round(tokens / 1000);
  if (tenths === 0 && tokens > 0) return '不到 0.1 万';
  return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)} 万`;
}
