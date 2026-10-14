import { describe, expect, it } from 'vitest';
import { JsonFloat } from '../kernel/json';
import { decodeJsonColumn, encodeJsonColumn, type Db } from './db';
import { migratedMemoryDb, nodeSqliteDb } from './nodeSqlite.test-support';
import type { RunRecord } from './runs';
import { ENGINE_MIGRATIONS, EngineSchemaError, migrateEngineDb } from './schema';
import { RunStoreBrokenError, SqlRunStore } from './sqlRuns';

const now = () => '2026-10-14T00:00:00Z';
const fields = (publicId: string): Omit<RunRecord, 'id'> => ({
  public_id: publicId,
  session_id: 's',
  assistant_session_id: 7,
  goal: '写第三章',
  scope: { cost: new JsonFloat(2), ratio: 0.5, nested: { list: [1, new JsonFloat(3)] } },
  permission_profile: 'ask',
  budget: {},
  status: 'running',
  root_plan: [{ step: 'a' }],
  current_step: null,
});
const event = (runId: number, type: string, payload: object = {}) => ({
  run_id: runId,
  event_type: type,
  actor: 'agent',
  message: `${type} 消息`,
  payload: payload as { [key: string]: unknown },
});

describe('test port binds like the desktop port', () => {
  it('binds integers as INTEGER and other numbers as REAL', async () => {
    const db = nodeSqliteDb();
    expect(
      await db.select('SELECT typeof($1) AS a, typeof($2) AS b, CAST($1 AS TEXT) AS c', [5, 0.5]),
    ).toEqual([{ a: 'integer', b: 'real', c: '5' }]);
    db.close();
  });
});

describe('JSON column codec', () => {
  it('keeps plain numbers, JsonFloat identity and prototype-less objects', () => {
    const value = decodeJsonColumn(
      encodeJsonColumn({
        a: 2,
        b: 2.5,
        c: new JsonFloat(2),
        d: [new JsonFloat(0.5)],
        e: undefined,
      }),
    ) as Record<string, unknown>;
    expect(value.a).toBe(2);
    expect(value.b).toBe(2.5);
    expect(value.c).toEqual(new JsonFloat(2));
    expect(value.c).toBeInstanceOf(JsonFloat);
    expect((value.d as unknown[])[0]).toBeInstanceOf(JsonFloat);
    expect('e' in value).toBe(false);
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(decodeJsonColumn('{"constructor": 1}')).toEqual({ constructor: 1 });
    expect(() => decodeJsonColumn(3)).toThrow(TypeError);
  });
});

describe('engine schema migrations', () => {
  it('creates the schema once and records the version', async () => {
    const db = nodeSqliteDb();
    expect(await migrateEngineDb(db)).toBe(ENGINE_MIGRATIONS.length);
    expect(await migrateEngineDb(db)).toBe(ENGINE_MIGRATIONS.length);
    expect(await db.select('SELECT version FROM schema_version')).toEqual([
      { version: ENGINE_MIGRATIONS.length },
    ]);
    const tables = (
      await db.select("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    ).map((row) => row.name);
    expect(tables).toEqual([
      'agent_artifacts',
      'agent_run_events',
      'agent_runs',
      'assistant_messages',
      'assistant_sessions',
      'assistant_tool_calls',
      'engine_meta',
      'schema_version',
      'sqlite_sequence',
      'subagent_runs',
    ]);
  });

  it('rolls a failing migration back as a whole', async () => {
    const db = nodeSqliteDb();
    await db.transaction([{ sql: 'CREATE TABLE agent_runs (id INTEGER)' }]);
    await expect(migrateEngineDb(db)).rejects.toThrow();
    expect(await db.select('SELECT version FROM schema_version')).toEqual([]);
    expect(
      await db.select("SELECT name FROM sqlite_master WHERE name = 'assistant_sessions'"),
    ).toEqual([]);
  });

  it('refuses a newer or corrupt version table', async () => {
    const newer = nodeSqliteDb();
    await newer.transaction([
      { sql: 'CREATE TABLE schema_version (version INTEGER NOT NULL)' },
      { sql: 'INSERT INTO schema_version VALUES ($1)', params: [ENGINE_MIGRATIONS.length + 1] },
    ]);
    await expect(migrateEngineDb(newer)).rejects.toThrow(EngineSchemaError);
    const twice = nodeSqliteDb();
    await twice.transaction([
      { sql: 'CREATE TABLE schema_version (version INTEGER NOT NULL)' },
      { sql: 'INSERT INTO schema_version VALUES (1), (1)' },
    ]);
    await expect(migrateEngineDb(twice)).rejects.toThrow('schema_version 有多行');
  });
});

describe('SqlRunStore persistence', () => {
  it('reopens with the same rows, ids and per-run sequences', async () => {
    const db = await migratedMemoryDb();
    const first = await SqlRunStore.open(db, now);
    const a = await first.insertRun(fields('run-a'));
    const b = await first.insertRun(fields('run-b'));
    await first.appendEvent(event(a.id, 'one'));
    const two = await first.appendEvent(event(a.id, 'two', { n: new JsonFloat(1) }));
    await first.appendEvent(event(b.id, 'three'));
    await first.settleRun(a.id, 'running', { status: 'completed', current_step: 'done' }, (run) =>
      event(run.id, `settled:${run.status}`),
    );
    await first.updateEvent(two.id, { n: 9 });
    const artifact = await first.insertArtifact({
      run_id: b.id,
      kind: 'proposed_patch',
      payload: { after: '新' },
      requires_confirmation: true,
    });
    await first.updateArtifact(artifact.id, { after: '更新' });
    await first.insertSubagent({
      run_id: a.id,
      parent_run_id: b.id,
      role: 'plot',
      input: { x: 1 },
      output: {},
      status: 'completed',
    });

    const second = await SqlRunStore.open(db, now);
    expect(await second.getRun(a.id)).toEqual(await first.getRun(a.id));
    expect(await second.findRun('run-b')).toEqual(await first.findRun('run-b'));
    expect(second.peek(a.id)).toEqual({ status: 'completed', current_step: 'done' });
    expect(await second.rowsAfter({ events: 0, artifacts: 0, subagents: 0 })).toEqual(
      await first.rowsAfter({ events: 0, artifacts: 0, subagents: 0 }),
    );
    expect((await second.events(a.id)).map((row) => [row.sequence, row.event_type])).toEqual([
      [1, 'one'],
      [2, 'two'],
      [3, 'settled:completed'],
    ]);
    expect((await second.events(a.id))[1].payload).toEqual({ n: 9 });
    expect(await second.artifact(artifact.id)).toMatchObject({
      payload: { after: '更新' },
      requires_confirmation: true,
    });
    // id 与 sequence 接着往下分配。
    const next = await second.appendEvent(event(b.id, 'four'));
    expect([next.id, next.sequence]).toEqual([5, 2]);
    expect((await second.insertRun(fields('run-c'))).id).toBe(3);
    await expect(second.insertRun(fields('run-a'))).rejects.toThrow('已存在');
  });

  it('keeps call order for interleaved writes and reads its own writes', async () => {
    const store = await SqlRunStore.open(await migratedMemoryDb(), now);
    const run = await store.insertRun(fields('run-a'));
    const pending = Array.from({ length: 5 }, (_, index) =>
      store.appendEvent(event(run.id, `e${index}`)),
    );
    const read = store.events(run.id);
    const written = await Promise.all(pending);
    expect(written.map((row) => [row.id, row.sequence])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ]);
    expect((await read).map((row) => row.event_type)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
  });

  it('marks itself broken after a failed write instead of drifting from the database', async () => {
    const inner = await migratedMemoryDb();
    let fail = false;
    const db: Db = {
      select: (sql, params) => inner.select(sql, params),
      transaction: (steps) =>
        fail ? Promise.reject(new Error('disk I/O error')) : inner.transaction(steps),
    };
    const store = await SqlRunStore.open(db, now);
    const run = await store.insertRun(fields('run-a'));
    fail = true;
    await expect(store.appendEvent(event(run.id, 'lost'))).rejects.toBeInstanceOf(
      RunStoreBrokenError,
    );
    fail = false;
    await expect(store.getRun(run.id)).rejects.toBeInstanceOf(RunStoreBrokenError);
    await expect(store.events(run.id)).rejects.toBeInstanceOf(RunStoreBrokenError);
    expect(await inner.select('SELECT COUNT(*) AS n FROM agent_run_events')).toEqual([{ n: 0 }]);
  });

  it('serialises reads behind slower writes (the port does not promise ordering across calls)', async () => {
    const inner = await migratedMemoryDb();
    const db: Db = {
      select: (sql, params) => inner.select(sql, params),
      // 写比读慢：没有串行队列时，读会跑在还没提交的写前面。
      transaction: (steps) =>
        new Promise((resolve, reject) =>
          setTimeout(() => inner.transaction(steps).then(resolve, reject), 15),
        ),
    };
    const store = await SqlRunStore.open(db, now);
    const run = await store.insertRun(fields('run-a'));
    void store.appendEvent(event(run.id, 'first'));
    void store.appendEvent(event(run.id, 'second'));
    expect((await store.events(run.id)).map((row) => row.event_type)).toEqual(['first', 'second']);
  });

  it('round-trips a run without an assistant session and filters runs by session', async () => {
    const db = await migratedMemoryDb();
    const store = await SqlRunStore.open(db, now);
    await store.insertRun({ ...fields('run-a'), assistant_session_id: null });
    await store.insertRun({ ...fields('run-b'), assistant_session_id: 8 });
    await store.insertRun(fields('run-c'));
    const reopened = await SqlRunStore.open(db, now);
    expect((await reopened.findRun('run-a'))!.assistant_session_id).toBeNull();
    expect((await reopened.runsOfAssistantSession(7)).map((run) => run.public_id)).toEqual([
      'run-c',
    ]);
  });

  it('hands out copies: changing a returned run does not change the store', async () => {
    const store = await SqlRunStore.open(await migratedMemoryDb(), now);
    const run = await store.insertRun(fields('run-a'));
    (await store.findRun('run-a'))!.status = 'tampered';
    (await store.getRun(run.id)).status = 'tampered';
    expect(store.peek(run.id).status).toBe('running');
  });

  it('continues artifact and subagent ids after reopening', async () => {
    const db = await migratedMemoryDb();
    const first = await SqlRunStore.open(db, now);
    const run = await first.insertRun(fields('run-a'));
    const artifact = { run_id: run.id, kind: 'k', payload: {}, requires_confirmation: false };
    await first.insertArtifact(artifact);
    const subagent = {
      run_id: run.id,
      parent_run_id: null,
      role: 'r',
      input: {},
      output: {},
      status: 's',
    };
    await first.insertSubagent(subagent);
    const second = await SqlRunStore.open(db, now);
    expect((await second.insertArtifact(artifact)).id).toBe(2);
    expect((await second.insertSubagent(subagent)).id).toBe(2);
  });

  it('enforces one event per run and sequence in the schema', async () => {
    const db = await migratedMemoryDb();
    const store = await SqlRunStore.open(db, now);
    const run = await store.insertRun(fields('run-a'));
    const insert = {
      sql:
        'INSERT INTO agent_run_events (run_id, event_type, actor, message, payload, sequence, created_at, updated_at) ' +
        "VALUES ($1, 'x', 'agent', '', '{}', 1, 't', 't')",
      params: [run.id],
    };
    await db.transaction([insert]);
    await expect(db.transaction([insert])).rejects.toThrow('UNIQUE');
  });

  it('rejects writes for a run it does not know', async () => {
    const store = await SqlRunStore.open(await migratedMemoryDb(), now);
    await expect(store.appendEvent(event(9, 'x'))).rejects.toThrow(RangeError);
    await expect(store.updateRun(9, { status: 'x' })).rejects.toThrow(RangeError);
    await expect(store.updateEvent(9, {})).rejects.toThrow('event 9 不存在');
  });
});
