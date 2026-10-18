import { prepareChapterFactRecord, retireFact, type FactRecordInput } from '@storyforge/engine';
import { platform } from './assistant';
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
