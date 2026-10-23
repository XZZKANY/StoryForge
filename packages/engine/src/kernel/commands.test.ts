import { describe, expect, it } from 'vitest';
import golden from '../../golden/p1-commands.windows.json';
import { BreakdownCancellations } from './bookBreakdown';
import { IdeCommandExecutionError } from './bookContextCommand';
import {
  currentCanonOrderBytes,
  decodeFixtureBytes,
  type EncodedFile,
} from './contextFixture.test-support';
import { executeIdeCommand, IDE_COMMANDS, type IdeCommandDeps } from './ideCommands';
import { memoryProject } from './memoryProject.test-support';
import { recordBookBreakdownRun } from '../loop/bookBreakdownRun';
import { nodeSqliteDb } from '../store/nodeSqlite.test-support';
import { migrateEngineDb } from '../store/schema';
import { SqlRunStore } from '../store/sqlRuns';
import { dumpJson } from './json';

const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';
const secrets = { values: golden.secrets };
const [year, month, day, hour, minute, second, micro] = golden.fixed_now;
const now = () => new Date(Date.UTC(year, month - 1, day, hour, minute, second, micro / 1000));

type Call = {
  fn: string;
  args: {
    command_id: string;
    args: Record<string, unknown> | null;
    model: { content: string }[] | null;
    analysis_id?: string;
  };
  output_json?: string;
  writes: Record<string, EncodedFile | null>;
};
const projects = golden.projects as unknown as {
  id: string;
  files: Record<string, EncodedFile>;
  calls: Call[];
}[];

/** `$ROOT` ↔ 合成根：Python 的输出按真实运行目录归一成占位符。 */
function withRoot(value: unknown): unknown {
  if (typeof value === 'string') return value.split('$ROOT').join(ROOT);
  if (Array.isArray(value)) return value.map(withRoot);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withRoot(item)]));
  return value;
}

/** 生产路由带着 DB 会话：拆书顺带记一个 run。引擎这一侧记进自己的库，读回与 Python 同样的三张表。 */
async function engineRunsDb() {
  const db = nodeSqliteDb();
  await migrateEngineDb(db);
  const store = await SqlRunStore.open(db, () => '2026-10-12 04:30:15');
  const plain = (value: unknown) => JSON.parse(dumpJson(value, { ensureAscii: false })) as unknown;
  return {
    record: (output: { [key: string]: unknown }) =>
      recordBookBreakdownRun({ store, secrets }, output),
    async rows() {
      const runs = await store.allRuns();
      const events = (await Promise.all(runs.map((run) => store.events(run.id)))).flat();
      const artifacts = (await Promise.all(runs.map((run) => store.artifacts(run.id)))).flat();
      const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;
      return plain({
        runs: [...runs].sort(byId),
        events: [...events].sort(byId),
        artifacts: [...artifacts].sort(byId),
      });
    },
  };
}

describe('real Python IDE command envelope replay', () => {
  for (const record of projects) {
    describe(record.id, () => {
      const project = memoryProject(ROOT, record.files);
      const cancellations = new BreakdownCancellations();
      const runsDb = engineRunsDb();
      for (const [index, call] of record.calls.entries()) {
        it(`#${index} ${call.fn} ${JSON.stringify(call.args).slice(0, 70)}`, async () => {
          if (call.fn === 'author_write') {
            project.apply(call.writes);
            return;
          }
          if (call.fn === 'prepare_cancellation') {
            cancellations.prepare(call.args.analysis_id!);
            return;
          }
          if (call.fn === 'release_cancellation') {
            cancellations.release(call.args.analysis_id!);
            return;
          }
          const { command_id: commandId, args, model } = call.args;
          const calls: object[] = [];
          const deps: IdeCommandDeps = {
            reader: project.reader,
            writer: project.writer,
            secrets,
            platform,
            now,
            cancellations,
            newAnalysisId: () => 'c0ffeec0ffeec0ffeec0ffeec0ffee00',
            breakdownModel:
              model === null
                ? null
                : {
                    provider: 'openai',
                    model: 'fake-model',
                    callLlm: async ({ systemPrompt, userPrompt }) => {
                      calls.push({ system: systemPrompt, user: userPrompt });
                      return model[calls.length - 1];
                    },
                  },
          };
          const expected = withRoot(JSON.parse(call.output_json!)) as {
            result?: unknown;
            calls?: unknown;
            db?: unknown;
            error?: { status: number; message: string };
          };
          const recorder = expected.db === undefined ? null : await runsDb;
          if (recorder) deps.recordBreakdownRun = recorder.record;
          const outcome = await executeIdeCommand(
            commandId,
            (args === null ? undefined : withRoot(args)) as Record<string, unknown>,
            deps,
          ).then(
            async (result) => ({
              result,
              calls,
              ...(recorder ? { db: await recorder.rows() } : {}),
            }),
            (error: unknown) => ({ error }),
          );
          if (expected.error) {
            expect('error' in outcome && outcome.error).toBeInstanceOf(IdeCommandExecutionError);
            const failure = (outcome as { error: IdeCommandExecutionError }).error;
            expect(failure.status).toBe(expected.error.status);
            // 500 只核状态：前端显示「API 返回 500」，不展示 Python 的异常文本。
            expect(failure.message).toBe(
              expected.error.status === 500 ? 'API 返回 500' : expected.error.message,
            );
          } else expect(outcome).toEqual(expected);
          const writes = project.takeWrites();
          expect(Object.keys(writes).sort()).toEqual(Object.keys(call.writes).sort());
          for (const [path, file] of Object.entries(call.writes))
            expect(writes[path], path).toEqual(
              currentCanonOrderBytes(path, decodeFixtureBytes(file!)),
            );
        });
      }
    });
  }
});

describe('IDE command front door (§4.3.1)', () => {
  const deps = (): IdeCommandDeps => {
    const { reader, writer } = memoryProject(ROOT, {});
    return {
      reader,
      writer,
      secrets,
      platform,
      now,
      cancellations: new BreakdownCancellations(),
      breakdownModel: null,
      newAnalysisId: () => 'x',
    };
  };
  const failure = (commandId: string, args: unknown) =>
    executeIdeCommand(commandId, args as Record<string, unknown>, deps()).catch(
      (error: IdeCommandExecutionError) => [error.status, error.message],
    );

  it('lists the same nine commands as Python', () => {
    expect(IDE_COMMANDS.map((command) => command.id)).toEqual([
      'audit.open',
      'canon.refresh',
      'observatory.scan',
      'book.breakdown',
      'book.breakdown.cancel',
      'book.breakdown.status',
      'book.context',
      'plan.mark_written',
      'plan.unmark_written',
    ]);
  });
  it('rejects a non-object body like FastAPI (422) before the command lookup', async () => {
    expect(await failure('nope', [1])).toEqual([422, 'API 返回 422']);
    expect(await failure('audit.open', null)).toEqual([422, 'API 返回 422']);
    expect(await failure('audit.open', 5)).toEqual([422, 'API 返回 422']);
  });
  it('rejects a relative project_root instead of guessing a working directory', async () => {
    for (const id of ['canon.refresh', 'observatory.scan', 'book.breakdown', 'plan.mark_written'])
      expect(await failure(id, { project_root: 'book', file_path: 'a.md' })).toEqual([
        400,
        `${id} 的 project_root 必须是绝对路径。`,
      ]);
  });
  it('rejects lone surrogates and over-deep arguments', async () => {
    expect(await failure('audit.open', { note: 'a\ud800' })).toEqual([
      400,
      'audit.open 的参数里有孤立的代理码点。',
    ]);
    let deep: unknown = 1;
    for (let i = 0; i < 65; i++) deep = [deep];
    expect(await failure('audit.open', { deep })).toEqual([
      400,
      'audit.open 的参数嵌套超过 64 层。',
    ]);
  });
  it('reports a mistyped canon.json to the author as 400 with the location (Python dropped it silently)', async () => {
    const { reader, writer } = memoryProject(ROOT, {
      '.storyforge/canon/canon.json': {
        chunks: [{ base64: btoa('{"version": 1, "entities": "x"}'), repeat: 1 }],
      },
    });
    const error = await executeIdeCommand(
      'canon.refresh',
      { project_root: ROOT },
      { ...deps(), reader, writer },
    ).catch((caught: IdeCommandExecutionError) => caught);
    expect(error).toBeInstanceOf(IdeCommandExecutionError);
    expect((error as IdeCommandExecutionError).status).toBe(400);
    expect((error as IdeCommandExecutionError).message).toContain('canon.json');
  });
  it('records the breakdown run when the run store is wired (P4)', async () => {
    const base = deps();
    const { reader, writer } = memoryProject(ROOT, {
      '正文.txt': {
        chunks: [{ base64: btoa(unescape(encodeURIComponent('第1章 a\n内容'))), repeat: 1 }],
      },
    });
    const result = await executeIdeCommand(
      'book.breakdown',
      { project_root: ROOT },
      {
        ...base,
        reader,
        writer,
        recordBreakdownRun: async (output) => ({
          run_id: `breakdown-${output.analysis_id}`,
          artifact_id: 7,
        }),
      },
    );
    expect((result.payload as { breakdown: unknown }).breakdown).toMatchObject({
      run_id: 'breakdown-x',
      artifact_id: 7,
    });
  });
});
