import { planWriteBatch, runUsage } from '@storyforge/engine';
import type { ApiRunUsage, ApiWriteBatchPlan } from '../api/contracts';
import { platform } from './assistant';
import { nativeProjectReader } from './reader';
import { engineRuns, engineSecrets, engineSessions } from './store';

/** 批量写章计划：正文与连载计划经宿主读口读，写章记录在引擎库。返回类型钉住契约形状。 */
export async function planEngineWriteBatch(input: {
  project_root: string;
  from: number;
  to: number;
  permission_profile: string;
}): Promise<ApiWriteBatchPlan> {
  // 只读会话归属，用不到密钥；模型配置读不出也不该挡住出计划。
  const secrets = await engineSecrets().catch(() => ({ values: [] }));
  const [{ store }, sessions] = await Promise.all([engineRuns(), engineSessions(secrets)]);
  return await planWriteBatch(
    { reader: nativeProjectReader, store, sessions, platform: platform() },
    input,
  );
}

/** 单次运行的用量（按 public id）。 */
export async function engineRunUsage(runId: string): Promise<ApiRunUsage> {
  const { store } = await engineRuns();
  return await runUsage(store, runId);
}
