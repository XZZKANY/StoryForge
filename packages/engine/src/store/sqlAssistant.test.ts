import { describe, expect, it } from 'vitest';
import golden from '../../golden/p4-assistant-store.json';
import { decodeJsonColumn } from './db';
import { migratedMemoryDb } from './nodeSqlite.test-support';
import { SqlAssistantStore } from './sqlAssistant';

type Obj = { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 按 Python 预言机的 JSON 形状读

const TIMESTAMPS = new Set(['created_at', 'updated_at', 'started_at', 'finished_at']);
const plain = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(plain)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => !TIMESTAMPS.has(key))
            .map(([key, item]) => [key, plain(item)]),
        )
      : value;
/** 时间戳的形状（数字一律换成 0）：值随时钟变，格式要与 Python 接口一致。 */
function timestampShapes(value: unknown): (string | null)[] {
  const shapes = new Set<string | null>();
  const walk = (item: unknown) => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item !== null && typeof item === 'object')
      for (const [key, child] of Object.entries(item))
        if (TIMESTAMPS.has(key))
          shapes.add(child === null ? null : String(child).replace(/[0-9]/g, '0'));
        else walk(child);
  };
  walk(value);
  return [...shapes].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0,
  );
}

describe('assistant session store replays the Python services', () => {
  it('pins the oracle sources and operation count', () => {
    expect(Object.keys(golden.sources)).toHaveLength(4);
    expect(golden.records).toHaveLength(39);
  });

  it('replays every operation with the same results, errors and rows', async () => {
    const db = await migratedMemoryDb();
    // 预言机的写入都落在同一秒：最近会话按 id 倒序，这里用固定时钟复现（库里的存储格式）。
    const store = new SqlAssistantStore(
      db,
      { values: [golden.secret] },
      () => '2026-10-14 00:00:00',
    );
    const toolCall = async (id: number) => {
      const rows = await db.select('SELECT session_id FROM assistant_tool_calls WHERE id = $1', [
        id,
      ]);
      return (await store.toolCallList(Number(rows[0].session_id))).find((row) => row.id === id);
    };
    const raw = async () => ({
      sessions: (
        await db.select('SELECT id, title, project_path FROM assistant_sessions ORDER BY id')
      ).map((row) => ({ ...row })),
      messages: (
        await db.select('SELECT id, session_id, role, content FROM assistant_messages ORDER BY id')
      ).map((row) => ({ ...row })),
      tool_calls: (
        await db.select(
          'SELECT id, session_id, tool_name, status, input_summary, output_summary, error_message, related_type, related_id FROM assistant_tool_calls ORDER BY id',
        )
      ).map((row) => ({
        ...row,
        input_summary: decodeJsonColumn(row.input_summary),
        output_summary: decodeJsonColumn(row.output_summary),
      })),
    });

    for (const [index, record] of (golden.records as Obj[]).entries()) {
      const op = record.op as Obj;
      const label = `#${index} ${op.op}`;
      let result: unknown;
      let failure: Error | null = null;
      try {
        switch (op.op) {
          case 'create_session':
            result = await store.sessionDetail((await store.createSession(op.payload)).id);
            break;
          case 'append_message':
            await store.appendMessage(op.session, op.payload);
            result = ((await store.sessionDetail(op.session)) as Obj).messages.at(-1);
            break;
          case 'create_tool_call':
            result = await toolCall((await store.createToolCall(op.session, op.payload)).id);
            break;
          case 'update_tool_call':
            result = await toolCall((await store.updateToolCall(op.id, op.payload)).id);
            break;
          case 'list_tool_calls':
            result = await store.toolCallList(op.session);
            break;
          case 'get_session':
            result = await store.sessionDetail(op.session);
            break;
          case 'set_title':
            await store.setTitle(op.session, op.title);
            result = null;
            break;
          case 'list_recent':
            result = await store.listRecentSessions({
              limit: op.kwargs.limit,
              projectPath: op.kwargs.project_path,
            });
            break;
          default:
            throw new Error(`unknown op ${op.op}`);
        }
      } catch (error) {
        failure = error as Error;
      }
      if ('rejected' in record) {
        expect(failure, label).toMatchObject({
          name: 'AssistantStoreValidationError',
          status: 422,
        });
      } else if ('error' in record) {
        expect(failure, label).toMatchObject({
          name: record.error.type,
          message: record.error.message,
        });
      } else {
        if (failure) throw failure;
        expect(plain(result), label).toEqual(record.result);
        expect(timestampShapes(result), `${label} timestamps`).toEqual(record.timestamp_shapes);
      }
      expect(await raw(), `${label} rows`).toEqual(record.raw);
    }
  });

  it('counts lengths in code points like pydantic', async () => {
    const store = new SqlAssistantStore(await migratedMemoryDb(), { values: [] }, () => 't');
    const astral = '😀'.repeat(160);
    const ref = await store.createSession({
      title: astral,
      task_type: 't',
      project_path: null,
      messages: [],
    });
    expect(await store.title(ref.id)).toBe(astral);
    await expect(
      store.createSession({
        title: astral + '😀',
        task_type: 't',
        project_path: null,
        messages: [],
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('moves a session to the top of the recent list when its title changes', async () => {
    let tick = 0;
    const store = new SqlAssistantStore(await migratedMemoryDb(), { values: [] }, () =>
      new Date(Date.UTC(2026, 9, 14, 0, 0, tick++)).toISOString(),
    );
    const first = await store.createSession({
      title: 'a',
      task_type: 't',
      project_path: null,
      messages: [],
    });
    await store.createSession({ title: 'b', task_type: 't', project_path: null, messages: [] });
    await store.setTitle(first.id, '改过的标题');
    expect((await store.listRecentSessions()).map((row) => row.title)).toEqual(['改过的标题', 'b']);
  });

  it('redacts rows written before the current key was known, and keeps related ids', async () => {
    const db = await migratedMemoryDb();
    const secret = 'sk-later-key-0001';
    const store = new SqlAssistantStore(db, { values: [secret] }, () => 't');
    const ref = await store.createSession({
      title: 't',
      task_type: 't',
      project_path: null,
      messages: [],
    });
    await db.transaction([
      {
        sql:
          'INSERT INTO assistant_tool_calls (session_id, tool_name, status, input_summary, output_summary, ' +
          "error_message, related_type, related_id, created_at, updated_at) VALUES ($1, 'x', 'failed', $2, '{}', $3, 'agent_run', 5, 't', 't')",
        params: [ref.id, JSON.stringify({ note: secret }), `失败 ${secret}`],
      },
    ]);
    const [read] = await store.toolCallList(ref.id);
    expect(read).toMatchObject({
      input_summary: { note: '[REDACTED]' },
      error_message: '失败 [REDACTED]',
      related_type: 'agent_run',
      related_id: 5,
    });
    expect((await store.toolCalls(ref.id))[0]).toMatchObject({
      related_type: 'agent_run',
      related_id: 5,
    });
  });

  it('serves the agent loop its raw conversation rows', async () => {
    const store = new SqlAssistantStore(
      await migratedMemoryDb(),
      { values: ['sk-x-123456'] },
      () => 't',
    );
    const ref = await store.createSession({
      title: 'IDE Agent: 你好',
      task_type: 'ide_agent_orchestration',
      project_path: 'D:/book',
      messages: [{ role: 'user', content: '你好' }],
    });
    await store.appendMessage(ref.id, { role: 'assistant', content: '在。' });
    await store.createToolCall(ref.id, {
      tool_name: 'fs.read',
      status: 'running',
      input_summary: {},
    });
    expect(await store.title(ref.id)).toBe('IDE Agent: 你好');
    expect(await store.messages(ref.id)).toEqual([
      { id: 1, role: 'user', content: '你好' },
      { id: 2, role: 'assistant', content: '在。' },
    ]);
    expect(await store.toolCalls(ref.id)).toEqual([
      {
        id: 1,
        tool_name: 'fs.read',
        status: 'running',
        input_summary: {},
        output_summary: {},
        related_type: null,
        related_id: null,
      },
    ]);
    await store.setTitle(ref.id, '长'.repeat(200));
    expect(await store.title(ref.id)).toBe('长'.repeat(160));
    await expect(store.title(99)).rejects.toThrow('Assistant 会话不存在：99。');
  });
});
