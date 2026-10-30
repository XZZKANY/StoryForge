import {
  formatTokenCount,
  markWriteBatchReviewed,
  nextWriteBatchStep,
  planWriteBatch,
  previewWriteBatchResume,
  readWriteBatch,
  recordWriteBatchChapter,
  recoverInterruptedWriteBatch,
  resumeWriteBatch,
  runUsage,
  startWriteBatch,
  stopWriteBatch,
  type WriteBatchRunDeps,
} from '@storyforge/engine';
import type {
  ApiRunUsage,
  ApiWriteBatch,
  ApiWriteBatchPlan,
  ApiWriteBatchRecovery,
  ApiWriteBatchStartResult,
  ApiWriteBatchStep,
  ApiWriteBatchView,
} from '../api/contracts';
import { platform } from './assistant';
import { nativeProjectReader } from './reader';
import { engineRuns, engineSecrets, engineSessions } from './store';
import { nativeProjectWriter } from './writer';

async function storeDeps() {
  // 只读会话归属，用不到密钥；模型配置读不出也不该挡住出计划。
  const secrets = await engineSecrets().catch(() => ({ values: [] }));
  const [{ store }, sessions] = await Promise.all([engineRuns(), engineSessions(secrets)]);
  return { reader: nativeProjectReader, store, sessions, platform: platform() };
}

/** 批量记录写在 `.storyforge/write-batch.json`，经宿主原子写口；不碰引擎库的几步不开库。 */
const fileDeps = () => ({
  reader: nativeProjectReader,
  writer: nativeProjectWriter,
  platform: platform(),
});

async function runDeps(): Promise<WriteBatchRunDeps> {
  return {
    ...(await storeDeps()),
    writer: nativeProjectWriter,
    now: () => new Date(),
    newHex: () => crypto.randomUUID().replace(/-/g, ''),
  };
}

/** 批量写章计划：正文与连载计划经宿主读口读，写章记录在引擎库。返回类型钉住契约形状。 */
export async function planEngineWriteBatch(input: {
  project_root: string;
  from: number;
  to: number;
  permission_profile: string;
}): Promise<ApiWriteBatchPlan> {
  return await planWriteBatch(await storeDeps(), input);
}

/** 单次运行的用量（按 public id）。 */
export async function engineRunUsage(runId: string): Promise<ApiRunUsage> {
  const { store } = await engineRuns();
  return await runUsage(store, runId);
}

export async function startEngineWriteBatch(input: {
  project_root: string;
  from: number;
  to: number;
  permission_profile: string;
  model_key: string;
  note: string | null;
}): Promise<ApiWriteBatchStartResult> {
  return await startWriteBatch(await runDeps(), input);
}

/** 续写前给作者看的计划：只读，不写记录。 */
export async function previewEngineWriteBatchResume(
  projectRoot: string,
  input: { permission_profile: string; model_key: string },
): Promise<ApiWriteBatchPlan> {
  return await previewWriteBatchResume(await storeDeps(), projectRoot, input);
}

export async function resumeEngineWriteBatch(input: {
  project_root: string;
  permission_profile: string;
  model_key: string;
}): Promise<ApiWriteBatchStartResult> {
  return await resumeWriteBatch(await runDeps(), input);
}

export async function recordEngineWriteBatchChapter(
  projectRoot: string,
  batchId: string,
  input: {
    ordinal: number;
    run_id: string;
    written_path: string | null;
    snapshot_version: string | null;
    facts_before: string | null;
    fact_disputes: number;
  },
): Promise<ApiWriteBatch> {
  return await recordWriteBatchChapter(await runDeps(), projectRoot, batchId, input);
}

export async function nextEngineWriteBatchStep(
  projectRoot: string,
  batchId: string,
  input: { permission_profile: string; model_key: string },
): Promise<ApiWriteBatchStep> {
  return await nextWriteBatchStep(await runDeps(), projectRoot, batchId, input);
}

export async function stopEngineWriteBatch(
  projectRoot: string,
  batchId: string,
  input: { code: string; message: string },
): Promise<ApiWriteBatch> {
  return await stopWriteBatch(fileDeps(), projectRoot, batchId, input);
}

export async function recoverEngineWriteBatch(projectRoot: string): Promise<ApiWriteBatchRecovery> {
  return await recoverInterruptedWriteBatch(fileDeps(), projectRoot);
}

export async function markEngineWriteBatchReviewed(
  projectRoot: string,
  batchId: string,
): Promise<ApiWriteBatch> {
  return await markWriteBatchReviewed(fileDeps(), projectRoot, batchId);
}

export async function readEngineWriteBatch(projectRoot: string): Promise<ApiWriteBatchView> {
  return await readWriteBatch(fileDeps(), projectRoot);
}

/** 给作者看的 token 数按「万」说（与引擎停下说明里同一种说法）。 */
export function formatEngineTokenCount(tokens: number): string {
  return formatTokenCount(tokens);
}
