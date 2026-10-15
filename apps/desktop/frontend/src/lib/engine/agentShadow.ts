import { getVersion } from '@tauri-apps/api/app';
import {
  dumpJson,
  importLegacyDb,
  LoopCheckpointStore,
  migrateEngineDb,
  REQUEST_EVIDENCE_KIND,
  SerialQueue,
  SqlAssistantStore,
  SqlRunStore,
  streamAgentUserMessage,
  type Db,
  type LegacySnapshotSource,
} from '@storyforge/engine';
import type { AgentSocketMessage, AgentUserMessageRequest } from '../api/types';
import { hostDeps, slots } from './agent';
import { agentRequestBody } from './agentRoutes';
import { nativePythonDb, nativeScratchDb } from './db';
import { nativeProjectReader } from './reader';
import {
  errorName,
  recordShadow,
  recordShadowUnavailable,
  refusingHttp,
  type TsCapture,
} from './shadow';
import { parsePythonCaptures, type PromptCapture } from './shadowDiff';
import { overlayProject } from './shadowProject';
import { dbNow } from './store';

/**
 * agent 循环的影子档（迁移计划 §4.2，P5-1b）：发送前把 Python 的库只读读一份，导进 Rust 的内存临时库
 * （旧库导入器，id 原样照搬：临时库与 Python 库在发送那一刻逐行相同），引擎在临时库上跑同一条作者消息；
 * 写作者 `.storyforge/` 的写入截在内存，出网端口拒发。Python 那一侧照常跑完后，比两边这个 run 的
 * 第一条模型请求证据。引擎库一行不写：P5-2 打开旧库导入时它必须是空的。
 */

type Scratch = Db & { close(): Promise<void> };
type Prepared = { db: Scratch; imported: Promise<{ source_found: boolean }> };
type EngineOutcome = TsCapture | { unavailable: string };

const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** 挡在发送前面的只有「读快照」这一步；导进临时库在后台继续。 */
async function prepare(): Promise<Prepared> {
  const db = await nativeScratchDb();
  try {
    await migrateEngineDb(db);
    let read = () => {};
    const snapshotRead = new Promise<void>((resolve) => {
      read = resolve;
    });
    const source: LegacySnapshotSource = {
      async snapshot(queries) {
        try {
          return await nativePythonDb.snapshot(queries);
        } finally {
          read();
        }
      },
    };
    const imported = importLegacyDb(db, source, dbNow);
    imported.catch(() => undefined); // 失败由引擎那一步接住，这里只防未处理的拒绝。
    await Promise.race([snapshotRead, imported]);
    return { db, imported };
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }
}

/** 证据载荷 → 比对用的快照（两侧同一个形状）；形状不对算快照没取到。 */
function evidenceCapture(payload: unknown): PromptCapture {
  const item = payload as { [key: string]: unknown } | null;
  const parsed = parsePythonCaptures([
    {
      step: item?.step,
      streaming: item?.streaming,
      request: item?.request,
      request_digest: item?.request_digest,
    },
  ]);
  return parsed?.[0] ?? { step: String(item?.step), streaming: false, error: 'evidence_invalid' };
}

async function runEngine(
  prepared: Prepared,
  request: AgentUserMessageRequest,
  runId: string,
): Promise<EngineOutcome> {
  try {
    if (!(await prepared.imported).source_found) return { unavailable: 'python_db_missing' };
    const [parts, appVersion] = await Promise.all([slots(), getVersion()]);
    const store = await SqlRunStore.open(prepared.db, dbNow);
    const sessions = new SqlAssistantStore(prepared.db, parts.secrets, dbNow, new SerialQueue());
    const overlay = overlayProject(nativeProjectReader);
    const deps = hostDeps({
      store,
      checkpoints: new LoopCheckpointStore(),
      sessions,
      slots: parts,
      appVersion,
      reader: overlay.reader,
      writer: overlay.writer,
      http: () => refusingHttp,
      wait: async () => undefined,
    });
    let error: string | null = null;
    try {
      await streamAgentUserMessage(deps, request.sessionId, agentRequestBody(request), () => {});
    } catch (caught) {
      error = errorName(caught);
    }
    const run = await store.findRun(runId);
    const first = run
      ? [...(await store.artifacts(run.id))]
          .filter((artifact) => artifact.kind === REQUEST_EVIDENCE_KIND)
          .sort((a, b) => a.id - b.id)[0]
      : undefined;
    // 引擎的载荷里有浮点标记：按 Python 编码转成普通 JSON 再比（摘要早已按 Python 编码算好）。
    const capture = first
      ? evidenceCapture(JSON.parse(dumpJson(first.payload, { ensureAscii: false })))
      : null;
    return { capture, error: capture ? null : error };
  } catch (error) {
    return { capture: null, error: errorName(error) };
  }
}

/** Python 库里这个 run 的第一条请求证据；`unavailable` 是库不在本机。 */
async function pythonEvidence(runId: string): Promise<PromptCapture[] | 'unavailable' | null> {
  if (!RUN_ID.test(runId)) return null;
  const sets = await nativePythonDb.snapshot([
    'SELECT a.payload FROM agent_artifacts a JOIN agent_runs r ON a.run_id = r.id ' +
      `WHERE r.public_id = '${runId}' AND a.kind = '${REQUEST_EVIDENCE_KIND}' ORDER BY a.id LIMIT 1`,
  ]);
  if (sets === null) return 'unavailable';
  const payload = sets[0][0]?.payload;
  if (payload === undefined) return [];
  try {
    return [evidenceCapture(JSON.parse(String(payload)))];
  } catch {
    return null;
  }
}

async function settle(
  prepared: Prepared | null,
  engine: Promise<EngineOutcome>,
  runId: string,
): Promise<void> {
  try {
    const outcome = await engine;
    if ('unavailable' in outcome)
      return await recordShadowUnavailable('agent.loop', outcome.unavailable);
    const python = await pythonEvidence(runId);
    if (python === 'unavailable')
      return await recordShadowUnavailable('agent.loop', 'python_db_missing');
    await recordShadow('agent.loop', python, outcome);
  } catch {
    // 记账失败不影响作者：checks 缺行即说明这一次没比上。
  } finally {
    await prepared?.db.close().catch(() => undefined);
  }
}

/**
 * 作者消息照常交给 Python（结果、流与控制都是 Python 的）；引擎在临时库上同时复算，
 * Python 这一轮结束后在后台比对记账。临时库没开起来也照常发送，这一次记成引擎侧没取到。
 */
export async function shadowAgentMessage(
  request: AgentUserMessageRequest,
  python: () => Promise<AgentSocketMessage>,
): Promise<AgentSocketMessage> {
  // 没有 run id 就对不上 Python 那一侧的证据（桌面端总会带上）。
  const runId = request.runId;
  if (!runId) return python();
  let prepared: Prepared | null = null;
  let setupError: string | null = null;
  try {
    prepared = await prepare();
  } catch (error) {
    setupError = errorName(error);
  }
  const sent = python();
  const engine: Promise<EngineOutcome> = prepared
    ? runEngine(prepared, request, runId)
    : Promise.resolve({ capture: null, error: setupError });
  try {
    const terminal = await sent;
    void settle(prepared, engine, runId);
    return terminal;
  } catch (error) {
    void engine.finally(() => prepared?.db.close().catch(() => undefined));
    throw error;
  }
}
