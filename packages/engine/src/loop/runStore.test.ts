import { beforeAll, describe, expect, it } from 'vitest';
import golden from '../../golden/p3-run-store.json';
import { dumpJson, JsonFloat, parseJson } from '../kernel/json';
import { migratedMemoryDb } from '../store/nodeSqlite.test-support';
import { MemoryRunStore, type RunEventRecord, type RunRecord, type RunStore } from '../store/runs';
import { SqlRunStore } from '../store/sqlRuns';
import { framesForEvent } from './frames';
import {
  AgentRunEventSink,
  AgentRunNotFoundError,
  finishAgentExecution,
  startAgentExecution,
  startAgentUserMessageRun,
  type RunServices,
} from './runEvents';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- golden 操作脚本是任意 JSON
const secrets = { values: [golden.secret] };
const plain = (value: unknown): unknown => JSON.parse(dumpJson(value, { ensureAscii: false }));
// 运行时进度来自 SDK 循环的原生数字，不经 JSON 解析；回放时把 JsonFloat 还原成 number。
const native = (value: unknown): unknown =>
  value instanceof JsonFloat
    ? value.value
    : Array.isArray(value)
      ? value.map(native)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, native(item)]))
        : value;

describe.each([
  [
    '内存存储',
    async (): Promise<
      RunStore & { rowsAfter: MemoryRunStore['rowsAfter'] | SqlRunStore['rowsAfter'] }
    > => new MemoryRunStore(),
  ],
  [
    'sqlite 存储',
    async () => SqlRunStore.open(await migratedMemoryDb(), () => '2026-10-14T00:00:00Z'),
  ],
] as const)('P3-5a run 存储与事件落库（Python 预言机，%s）', (_label, make) => {
  // 与 Python 一样，所有脚本共用一个库：续接 run-a 要看到第一个脚本留下的行。
  let store: Awaited<ReturnType<typeof make>>;
  let services: RunServices;
  beforeAll(async () => {
    store = await make();
    services = { store, secrets };
  });
  const frames: unknown[] = [];
  const onEvent = (event: RunEventRecord, run: RunRecord) =>
    frames.push(...framesForEvent(run, event, secrets));
  const sinks = new Map<string, AgentRunEventSink>();
  const started = new Map<string, RunEventRecord>();
  const cursor = { events: 0, artifacts: 0, subagents: 0 };

  for (const script of golden.scripts) {
    const steps = parseJson(script.steps_json, 'steps') as Obj[];
    for (const [index, expected] of steps.entries()) {
      const op = expected.op as Obj;
      it(`${script.id} #${index} ${op.op}`, async () => {
        frames.length = 0;
        let returned: unknown = null;
        let run: RunRecord;
        if (op.op === 'start') {
          try {
            const out = await startAgentUserMessageRun(services, {
              agentSessionId: op.agent_session_id,
              message: op.message,
              newRunId: () => 'unused',
            });
            onEvent(out.startedEvent, out.run);
            sinks.set(out.run.public_id, new AgentRunEventSink(services, onEvent));
            returned = out.run.public_id;
          } catch (error) {
            if (!(error instanceof AgentRunNotFoundError)) throw error;
            returned = { error: error.name, message: error.message };
          }
          run = (await store.findRun(op.message.run_id))!;
        } else {
          run = (await store.findRun(op.run))!;
          const sink = sinks.get(op.run)!;
          switch (op.op) {
            case 'execution_start': {
              const event = await startAgentExecution(services, run);
              sink.bindExecution(event);
              started.set(op.run, event);
              break;
            }
            case 'plan':
              await sink.recordPlan(run, op.result);
              break;
            case 'tool_trace':
              await sink.recordToolTrace(run, op.trace, op.index);
              break;
            case 'artifact':
              await sink.recordArtifact(run, {
                kind: op.kind,
                payload: op.payload,
                requiresConfirmation: op.requires_confirmation,
              });
              break;
            case 'permission_required':
              await sink.recordPermissionRequired(run, op.result, op.reason);
              break;
            case 'system_job':
              await sink.recordSystemJob(run, {
                key: op.key,
                payload: op.payload,
                artifactKind: op.artifact_kind ?? null,
                artifactPayload: op.artifact_payload ?? null,
              });
              break;
            case 'progress':
              await sink.recordRuntimeProgress(run, native(op.payload) as Obj);
              break;
            case 'runtime_interruption':
              returned = await sink.runtimeInterruption(run, op.boundary);
              break;
            case 'complete':
              await sink.complete(run, op.result);
              break;
            case 'fail':
              await sink.fail(run, op.message, op.payload);
              break;
            case 'set_status':
              await store.updateRun(run.id, { status: op.status, current_step: op.current_step });
              break;
            case 'finish': {
              const [output, settled, settledRun] = await finishAgentExecution(
                services,
                run.id,
                started.get(op.run)!,
                op.result,
              );
              onEvent(settled, settledRun);
              returned = output;
              break;
            }
            default:
              throw new Error(`unknown op ${op.op}`);
          }
        }
        const rows = await store.rowsAfter(cursor);
        for (const key of ['events', 'artifacts', 'subagents'] as const)
          if (rows[key].length) cursor[key] = rows[key][rows[key].length - 1].id;
        expect(
          plain({
            returned,
            events: rows.events,
            artifacts: rows.artifacts,
            subagents: rows.subagents,
            frames,
            run: await store.getRun(run.id),
          }),
        ).toEqual(
          plain({
            returned: expected.returned,
            events: expected.events,
            artifacts: expected.artifacts,
            subagents: expected.subagents,
            frames: expected.frames,
            run: expected.run,
          }),
        );
      });
    }
  }
});
