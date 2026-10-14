import { describe, expect, it } from 'vitest';
import golden from '../../golden/p4-chapter-checks.json';
import { AssistantSessionConflictError, AssistantSessionNotFoundError } from '../assistant/service';
import { dumpJson, parseJson } from '../kernel/json';
import { sha256Hex } from '../kernel/sha256';
import { migratedMemoryDb } from '../store/nodeSqlite.test-support';
import { MemoryRunStore } from '../store/runs';
import { SqlAssistantStore } from '../store/sqlAssistant';
import { SqlRunStore } from '../store/sqlRuns';
import { checkSource } from './chapterCheckProtocol';
import { ChapterCheckHistoryRequestError, queryChapterCheckHistory } from './chapterCheckHistory';
import { recordAgentArtifact, startAgentUserMessageRun, type RunServices } from './runEvents';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 按 Python 预言机的 JSON 形状读

const platform = golden.platform as 'windows' | 'posix';
const roots: Record<string, string> =
  platform === 'windows'
    ? { book: 'D:\\synthetic-book', elsewhere: 'D:\\synthetic-elsewhere' }
    : { book: '/tmp/synthetic-book', elsewhere: '/tmp/synthetic-elsewhere' };
const owned: [string, string][] = [
  [roots.book, '$ROOT'],
  [roots.elsewhere, '$ELSEWHERE'],
];
const mask = (value: unknown, key?: string): unknown =>
  typeof value === 'string'
    ? key === 'created_at'
      ? value.replace(/[0-9]/g, '0')
      : owned.reduce((text, [from, to]) => text.split(from).join(to), value)
    : Array.isArray(value)
      ? value.map((item) => mask(item))
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, mask(item, name)]))
        : value;
const plain = (value: unknown) => JSON.parse(dumpJson(value, { ensureAscii: false }));
// 用引擎自己的 JSON 解析：brief 里的 3000.0 要保持浮点身份，否则检查源哈希对不上。
const records = parseJson(golden.records_json, 'records') as unknown as Obj[];

describe.each([
  ['内存存储', async () => new MemoryRunStore(() => '2026-10-14 00:00:00')],
  [
    'sqlite 存储',
    async () => SqlRunStore.open(await migratedMemoryDb(), () => '2026-10-14 00:00:00'),
  ],
] as const)('chapter check history replays the Python service (%s)', (_label, make) => {
  it('pins the oracle sources and operation count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(4);
    expect(records).toHaveLength(72);
  });

  it('replays every operation with the same results and errors', async () => {
    const store = await make();
    const secrets = { values: [golden.secret] };
    const services: RunServices = { store, secrets };
    const sessions = new SqlAssistantStore(await migratedMemoryDb(), secrets, () => 't');
    // 查询时用当时配置的 key（预言机在写完之后才换上新 key）。
    let querySecrets = secrets;
    const ids = new Map<string, number>();
    const resolve = async (value: unknown): Promise<unknown> => {
      if (Array.isArray(value)) return Promise.all(value.map(resolve));
      if (value === null || typeof value !== 'object' || value.constructor?.name === 'JsonFloat')
        return value;
      const entries = Object.entries(value as Obj);
      if (entries.length === 1 && entries[0][0] === '$brief')
        return checkSource('', (await store.artifact(ids.get(entries[0][1])!))!.payload)
          .brief_sha256;
      if (entries.length === 1 && entries[0][0] === '$sha') return sha256Hex(entries[0][1]);
      const output: Obj = {};
      for (const [key, item] of entries) output[key] = await resolve(item);
      return output;
    };

    for (const [index, record] of records.entries()) {
      const op = record.op as Obj;
      const label = `#${index} ${op.op}`;
      if (op.op === 'session') {
        await sessions.createSession({
          title: `会话 ${index}`,
          task_type: 'ide_agent_orchestration',
          project_path: op.project === null ? null : roots[op.project],
          messages: [],
        });
      } else if (op.op === 'start') {
        const { run } = await startAgentUserMessageRun(services, {
          agentSessionId: op.run,
          message: { user_message: '写章', run_id: op.run },
          newRunId: () => 'unused',
        });
        await store.updateRun(run.id, { assistant_session_id: op.session });
      } else if (op.op === 'set_secret') {
        querySecrets = { values: [op.value] };
      } else if (op.op === 'artifact') {
        const run = (await store.findRun(op.run))!;
        const { artifact } = await recordAgentArtifact(services, run, {
          kind: op.kind,
          payload: (await resolve(op.payload)) as Obj,
          requiresConfirmation: op.requires_confirmation,
        });
        ids.set(op.as, artifact.id);
      } else {
        const body = Object.fromEntries(
          Object.entries(op.body as Obj).map(([key, value]) => [
            key,
            key === 'project_root' && typeof value === 'string' && value in roots
              ? roots[value]
              : value,
          ]),
        );
        let result: unknown;
        let error: Obj | undefined;
        try {
          result = await queryChapterCheckHistory(
            { store, sessions, secrets: querySecrets, platform },
            body,
          );
        } catch (failure) {
          if (failure instanceof ChapterCheckHistoryRequestError) error = { status: 422 };
          else if (
            failure instanceof AssistantSessionNotFoundError ||
            failure instanceof AssistantSessionConflictError
          )
            error = { status: failure.status, message: failure.message };
          else throw failure;
        }
        if ('error' in record) expect(error, label).toEqual(record.error);
        else {
          expect(error, label).toBeUndefined();
          expect(mask(plain(result)), label).toEqual(plain(record.result));
        }
      }
    }
  });
});
