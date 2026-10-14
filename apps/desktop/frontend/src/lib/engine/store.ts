import {
  LoopCheckpointStore,
  migrateEngineDb,
  reapInterruptedRuns,
  SerialQueue,
  SqlAssistantStore,
  SqlRunStore,
  type SecretContext,
} from '@storyforge/engine';
import { nativeEngineDb } from './db';
import { nativeLlmSource } from './llm';

/** 与 Python 库同一种时间戳（UTC、精确到秒）：旧库导入的行与引擎写的行按同一种格式排序。 */
const dbNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** 同一个 WebView 只做一次；失败不缓存，下次调用再试。 */
function once<T>(open: () => Promise<T>): () => Promise<T> {
  let opened: Promise<T> | null = null;
  return () => {
    opened ??= open().catch((error: unknown) => {
      opened = null;
      throw error;
    });
    return opened;
  };
}

const migrated = once(() => migrateEngineDb(nativeEngineDb));

/**
 * run / 事件 / artifact 落引擎库：迁移、载入 run、把上次没跑完的 run 收尸（迁移计划 §2.6：
 * 不跨重启续跑）。续跑检查点仍只在内存，重启后 paused 的 run 可以确认 / 拒绝补丁，
 * 续跑会回落为「重新发问」。
 */
export const engineRuns = once(async () => {
  await migrated();
  const store = await SqlRunStore.open(nativeEngineDb, dbNow);
  // 收尸只写固定文案与 run id，用不到密钥快照（也不该因为模型配置读不出而打不开库）。
  await reapInterruptedRuns({ store, secrets: { values: [] } });
  return { store, checkpoints: new LoopCheckpointStore() };
});

const sessionWrites = new SerialQueue();

/** 引擎库里的会话存储：脱敏用调用方当时的密钥快照，所有实例共用一个写队列。 */
export async function engineSessions(secrets: SecretContext): Promise<SqlAssistantStore> {
  await migrated();
  return new SqlAssistantStore(nativeEngineDb, secrets, dbNow, sessionWrites);
}

/** 两个模型槽配置过的 key 合在一起：会话里的脱敏要盖住其中任何一个。 */
export async function engineSecrets(): Promise<SecretContext> {
  const [main, polish] = await Promise.all([nativeLlmSource('main'), nativeLlmSource('polish')]);
  return { values: [...new Set([...main.secrets.values, ...polish.secrets.values])] };
}
