import { getVersion } from '@tauri-apps/api/app';
import {
  callLlm,
  missingLlmEnv,
  prepareChapterFactRecord,
  prepareFactBackfill,
  resolveDisputedFact,
  retireFact,
  unrecordedChapters,
  type FactModel,
  type FactRecordInput,
} from '@storyforge/engine';
import { slots } from './agent';
import { clock, platform, wait } from './assistant';
import { nativeHttpPort } from './llm';
import { nativeProjectReader } from './reader';
import { engineRuns } from './store';

/** 事实台账记账的 ts 档：检查产物在引擎库，正文和 canon.json 经宿主读口读。 */
export async function prepareEngineChapterFactRecord(input: FactRecordInput) {
  const { store } = await engineRuns();
  return await prepareChapterFactRecord(
    {
      reader: nativeProjectReader,
      store,
      platform: platform(),
      now: () => new Date(),
      newHex: () => crypto.randomUUID().replace(/-/g, ''),
    },
    input,
  );
}

/** 作废一条事实后的台账全文（换行按本机平台）。 */
export function retireEngineFact(ledgerText: string | null, factId: string): string {
  return retireFact(ledgerText, factId, platform());
}

/** 处理一条待定事实后的台账全文：accept 以本章为准，reject 保留已记的。 */
export function resolveEngineDispute(
  ledgerText: string | null,
  factId: string,
  choice: 'accept' | 'reject',
): string {
  return resolveDisputedFact(ledgerText, factId, choice, platform());
}

export function listEngineUnrecordedChapters(projectRoot: string) {
  return unrecordedChapters(nativeProjectReader, projectRoot, platform());
}

/** 补录用作者配置的主模型（与拆书同一种调用）；没配置就直说，不发请求。 */
async function factModel(): Promise<FactModel> {
  const [{ main, secrets }, appVersion] = await Promise.all([slots(), getVersion()]);
  if (missingLlmEnv(main.source).length)
    throw new Error('还没配置模型：补录要调用模型抽事实，先在设置里配好。');
  return async (prompts) => {
    const response = await callLlm(main.source, prompts, {
      http: nativeHttpPort('main'),
      clock,
      wait,
      random: Math.random,
      appVersion,
      secrets,
    });
    return { content: String(response.content ?? '') };
  };
}

export async function prepareEngineFactBackfill(
  input: { project_root: string; ledger_text: string | null; paths: readonly string[] },
  onProgress?: (done: number, total: number, path: string) => void,
) {
  return await prepareFactBackfill(
    {
      reader: nativeProjectReader,
      platform: platform(),
      now: () => new Date(),
      newHex: () => crypto.randomUUID().replace(/-/g, ''),
      callModel: await factModel(),
    },
    input,
    onProgress,
  );
}
