import { describe, expect, it } from 'vitest';
import golden from '../../golden/p4-legacy-import.json';
import { dumpJson, InputDomainError, JsonFloat, parseJson } from '../kernel/json';
import { LoopCheckpointStore } from '../loop/chatLoopCheckpoints';
import { agentRunSavePoints, listAgentRunEvents } from '../loop/savePoints';
import type { ProjectReader } from '../readPort';
import { decodeJsonColumn, type Db, type SqlRow } from './db';
import { importLegacyDb, LEGACY_IMPORT_KEY, LegacyImportError } from './legacyImport';
import { migratedMemoryDb, nodeLegacySource } from './nodeSqlite.test-support';
import { SqlAssistantStore } from './sqlAssistant';
import { SqlRunStore } from './sqlRuns';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 按 Python 预言机的 JSON 形状读

const TABLES = Object.keys(golden.rows);
const now = () => '2026-10-14 00:00:00';
const plain = (value: unknown) => JSON.parse(dumpJson(value, { ensureAscii: false }));
const schemaOnly = golden.legacy_sql.filter(
  (sql) => sql.startsWith('CREATE TABLE') || sql.startsWith('CREATE INDEX'),
);

async function engineRows(db: Db, table: string): Promise<SqlRow[]> {
  return db.select(`SELECT * FROM ${table} ORDER BY id`);
}

async function counts(db: Db) {
  const output: Record<string, number> = {};
  for (const table of TABLES)
    output[table] = Number((await db.select(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);
  return output;
}

describe('legacy import replays the Python read models', () => {
  it('pins the oracle sources and shape', () => {
    expect(Object.keys(golden.sources)).toHaveLength(7);
    expect(golden.rows).toEqual({
      assistant_sessions: 4,
      assistant_messages: 5,
      assistant_tool_calls: 3,
      agent_runs: 5,
      agent_run_events: 9,
      agent_artifacts: 4,
      subagent_runs: 2,
    });
    expect(golden.reads).toHaveLength(22);
  });

  it('copies every row and column, then serves the same reads as Python', async () => {
    const legacy = nodeLegacySource(golden.legacy_sql);
    const db = await migratedMemoryDb();
    expect(await importLegacyDb(db, legacy, now)).toEqual({
      status: 'imported',
      source_found: true,
      rows: golden.rows,
    });

    // 逐表逐行逐列：id 不变，JSON 列与引擎解析旧库原文的结果一致，其余列原样。
    // 按 Python json.dumps 重新写出后与原文逐字节相同，只有整数形的键被 JS 对象排到了前面
    // （引擎里所有载荷都是这样，键的先后不属于契约；作者库里没有这种键）。
    const reordered: string[] = [];
    for (const table of TABLES) {
      const columns = (await db.select(`PRAGMA table_info(${table})`)).map((row) =>
        String(row.name),
      );
      const jsonColumns = new Set(
        legacy
          .select(`PRAGMA table_info(${table})`)
          .filter((row) => row.type === 'JSON')
          .map((row) => String(row.name)),
      );
      const before = legacy.select(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY id`);
      const after = await engineRows(db, table);
      expect(after.length, table).toBe(golden.rows[table as keyof typeof golden.rows]);
      after.forEach((row, index) => {
        for (const column of columns) {
          const label = `${table}#${String(row.id)}.${column}`;
          if (jsonColumns.has(column)) {
            const text = dumpJson(decodeJsonColumn(row[column]));
            const source = String(before[index][column]);
            expect(text, label).toBe(dumpJson(parseJson(source, label)));
            if (text !== source) reordered.push(label);
          } else expect(row[column], label).toBe(before[index][column]);
        }
      });
    }
    expect(reordered).toEqual([
      'assistant_tool_calls#1.input_summary',
      'agent_run_events#3.payload',
    ]);
    // 整数值浮点保住身份（读回是 JsonFloat，不是整数）。
    const budget = decodeJsonColumn((await engineRows(db, 'agent_runs'))[0].budget) as Obj;
    expect(budget.tokens).toBeInstanceOf(JsonFloat);

    const secrets = { values: [golden.secret] };
    const sessions = new SqlAssistantStore(db, secrets, now);
    const store = await SqlRunStore.open(db, now);
    const deps = {
      store,
      secrets,
      reader: {} as ProjectReader,
      checkpoints: new LoopCheckpointStore(),
    };
    for (const [index, read] of (golden.reads as Obj[]).entries()) {
      const label = `#${index} ${read.op}`;
      let result: unknown;
      if (read.op === 'session') result = await sessions.sessionDetail(read.id);
      else if (read.op === 'tool_calls') result = await sessions.toolCallList(read.id);
      else if (read.op === 'recent')
        result = await sessions.listRecentSessions({
          limit: read.kwargs.limit,
          projectPath: read.kwargs.project_path,
        });
      else if (read.op === 'events') result = await listAgentRunEvents(deps, read.run);
      else if (read.op === 'save_points') result = await agentRunSavePoints(deps, read.run);
      else throw new Error(`未知操作 ${String(read.op)}`);
      expect(plain(result), label).toEqual(read.result);
    }

    // 导入之后新写的行接在旧 id 后面。
    expect(
      (
        await sessions.createSession({
          title: '新会话',
          task_type: 'x',
          project_path: null,
          messages: [],
        })
      ).id,
    ).toBe(5);
    const run = await store.insertRun({
      public_id: 'engine-run',
      session_id: 's',
      assistant_session_id: null,
      goal: 'g',
      scope: {},
      permission_profile: 'ask',
      budget: {},
      status: 'running',
      root_plan: [],
      current_step: null,
    });
    expect(run.id).toBe(6);
    expect(
      (
        await store.appendEvent({
          run_id: 6,
          event_type: 'e',
          actor: 'a',
          message: '',
          payload: {},
        })
      ).id,
    ).toBe(10);
  });

  it('imports once: the marker stops every later read of the old database', async () => {
    const legacy = nodeLegacySource(golden.legacy_sql);
    const db = await migratedMemoryDb();
    await importLegacyDb(db, legacy, now);
    legacy.exec(
      "INSERT INTO assistant_sessions (title, task_type, created_at, updated_at) VALUES ('后来的', 'x', '2026-07-09 00:00:00', '2026-07-09 00:00:00')",
    );
    expect(await importLegacyDb(db, legacy, now)).toEqual({
      status: 'already_imported',
      source_found: true,
      rows: golden.rows,
    });
    expect(legacy.snapshots).toBe(1);
    expect(await counts(db)).toEqual(golden.rows);
    const marker = await db.select('SELECT key, value FROM engine_meta');
    expect(marker.map((row) => row.key)).toEqual([LEGACY_IMPORT_KEY]);
    expect(JSON.parse(String(marker[0].value))).toEqual({
      imported_at: '2026-10-14 00:00:00',
      source_found: true,
      rows: golden.rows,
    });
  });
});

describe('legacy import edges', () => {
  it('marks a missing old database and never looks again', async () => {
    const db = await migratedMemoryDb();
    let reads = 0;
    const missing = {
      snapshot: async () => {
        reads += 1;
        return null;
      },
    };
    const zero = Object.fromEntries(TABLES.map((table) => [table, 0]));
    expect(await importLegacyDb(db, missing, now)).toEqual({
      status: 'imported',
      source_found: false,
      rows: zero,
    });
    expect(await importLegacyDb(db, missing, now)).toEqual({
      status: 'already_imported',
      source_found: false,
      rows: zero,
    });
    expect(reads).toBe(1);
  });

  it('refuses to import into an engine database that already has rows, without writing', async () => {
    const legacy = nodeLegacySource(golden.legacy_sql);
    const db = await migratedMemoryDb();
    await new SqlAssistantStore(db, { values: [] }, now).createSession({
      title: '引擎先建的',
      task_type: 'x',
      project_path: null,
      messages: [],
    });
    await expect(importLegacyDb(db, legacy, now)).rejects.toThrow(
      new LegacyImportError('引擎库已有数据（assistant_sessions 1 行），旧库不导入'),
    );
    expect(await db.select('SELECT * FROM engine_meta')).toEqual([]);
    expect((await counts(db)).assistant_sessions).toBe(1);
    expect((await counts(db)).agent_runs).toBe(0);
    // 旧库是空的就没有可撞的 id：照常打标记。
    expect(await importLegacyDb(db, nodeLegacySource(schemaOnly), now)).toMatchObject({
      status: 'imported',
      source_found: true,
    });
  });

  it.each([
    [
      "UPDATE agent_run_events SET created_at = '2026-07-02T10:00:00' WHERE id = 2",
      new LegacyImportError(
        '旧库 agent_run_events.created_at（id 2）不是YYYY-MM-DD HH:MM:SS 时间："2026-07-02T10:00:00"',
      ),
    ],
    [
      "UPDATE assistant_tool_calls SET finished_at = '2026-07-02 10:00:00.250000' WHERE id = 1",
      LegacyImportError,
    ],
    ['UPDATE agent_artifacts SET requires_confirmation = 2 WHERE id = 1', LegacyImportError],
    ["UPDATE agent_artifacts SET payload = '3' WHERE id = 1", LegacyImportError],
    ["UPDATE agent_run_events SET sequence = '1.5' WHERE id = 3", LegacyImportError],
    ['UPDATE agent_runs SET current_step = 4 WHERE id = 1', null],
    ['UPDATE assistant_sessions SET project_path = NULL WHERE id = 1', null],
    ['UPDATE agent_runs SET scope = \'{"x": NaN}\' WHERE id = 1', InputDomainError],
    ['UPDATE assistant_messages SET session_id = 99 WHERE id = 1', Error],
  ] as const)('rejects out-of-range rows as a whole and retries later: %s', async (sql, error) => {
    const legacy = nodeLegacySource(golden.legacy_sql);
    const db = await migratedMemoryDb();
    legacy.exec(sql);
    if (error === null) {
      // 旧库的类型亲和性把它存成了文本 / 可空列的 NULL：在范围内。
      await expect(importLegacyDb(db, legacy, now)).resolves.toMatchObject({ status: 'imported' });
      return;
    }
    await expect(importLegacyDb(db, legacy, now)).rejects.toThrow(error);
    expect(await db.select('SELECT * FROM engine_meta')).toEqual([]);
    expect(Object.values(await counts(db)).every((count) => count === 0)).toBe(true);
    // 旧库修好之后下次打开照常导入。
    const fixed = nodeLegacySource(golden.legacy_sql);
    await expect(importLegacyDb(db, fixed, now)).resolves.toMatchObject({ status: 'imported' });
    expect(await counts(db)).toEqual(golden.rows);
  });

  it('refuses a snapshot with the wrong number of result sets', async () => {
    const db = await migratedMemoryDb();
    await expect(
      importLegacyDb(db, { snapshot: async (queries) => queries.slice(1).map(() => []) }, now),
    ).rejects.toThrow(new LegacyImportError('旧库快照应有 7 组结果，实际 6 组'));
    expect(await db.select('SELECT * FROM engine_meta')).toEqual([]);
  });

  // 旧库的 NOT NULL 与文本亲和性让这两种值在 SQL 里造不出来：直接改快照，核对报的是导入范围。
  it.each([
    [{ title: null }, '旧库 assistant_sessions.title（id 1）不是非空值：null'],
    [{ title: 5 }, '旧库 assistant_sessions.title（id 1）不是文本：5'],
  ])('names the column of a tampered value: %j', async (patch, message) => {
    const legacy = nodeLegacySource(golden.legacy_sql);
    const db = await migratedMemoryDb();
    const tampered = {
      snapshot: async (queries: readonly string[]) => {
        const sets = await legacy.snapshot(queries);
        sets[0][0] = { ...sets[0][0], ...patch };
        return sets;
      },
    };
    await expect(importLegacyDb(db, tampered, now)).rejects.toThrow(new LegacyImportError(message));
    expect(await db.select('SELECT * FROM engine_meta')).toEqual([]);
  });
});
