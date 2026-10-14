import {
  AssistantSessionNotFoundError,
  type AssistantSessionRef,
  type AssistantStore,
  type StoredToolCall,
  type ToolCallPatch,
} from '../assistant/service';
import {
  redactSensitive,
  redactSensitiveText,
  type PlainJson,
  type SecretContext,
} from '../kernel/redaction';
import type { MessageRow, ToolCallRow } from '../loop/conversationHistory';
import { decodeJsonColumn, encodeJsonColumn, SerialQueue, type Db, type SqlRow } from './db';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const length = (text: string) => Array.from(text).length;

/** 请求体不合格（Python 路由在服务之前就回 422 的那些）。 */
export class AssistantStoreValidationError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'AssistantStoreValidationError';
  }
}

export class AssistantToolCallNotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = 'AssistantToolCallNotFoundError';
  }
}

const TOOL_STATUSES = new Set([
  'planned',
  'running',
  'completed',
  'failed',
  'needs_approval',
  'paused',
]);
const ROLES = new Set(['user', 'assistant', 'system']);

function invalid(field: string): never {
  throw new AssistantStoreValidationError(`请求字段不合法：${field}`);
}

/** 只允许列出的键（pydantic 的 extra="forbid"）。 */
function onlyKeys(value: Obj, allowed: readonly string[], where: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${where}.${key}`);
}

const text = (value: unknown, field: string, min: number, max: number): string =>
  typeof value === 'string' && length(value) >= min && length(value) <= max
    ? value
    : invalid(field);
const optionalText = (value: unknown, field: string, max: number): string | null =>
  value === undefined || value === null ? null : text(value, field, 0, max);

function messageInput(value: unknown, field: string): { role: string; content: string } {
  if (!isObj(value)) invalid(field);
  onlyKeys(value, ['role', 'content'], field);
  if (typeof value.role !== 'string' || !ROLES.has(value.role)) invalid(`${field}.role`);
  return { role: value.role, content: text(value.content, `${field}.content`, 1, 12000) };
}

const TOOL_FIELDS = [
  'tool_name',
  'status',
  'input_summary',
  'output_summary',
  'error_message',
  'related_type',
  'related_id',
];

/** 工具调用的列值（未给的字段不出现）；与 AssistantToolCallCreate / Update 的约束一致。 */
function toolCallFields(value: Obj, where: string, create: boolean): Obj {
  onlyKeys(value, TOOL_FIELDS, where);
  const fields: Obj = {};
  if (create || value.tool_name !== undefined)
    fields.tool_name = text(value.tool_name, `${where}.tool_name`, 1, 120);
  if (create || value.status !== undefined) {
    if (typeof value.status !== 'string' || !TOOL_STATUSES.has(value.status))
      invalid(`${where}.status`);
    fields.status = value.status;
  }
  for (const key of ['input_summary', 'output_summary'])
    if (value[key] !== undefined) {
      if (!isObj(value[key])) invalid(`${where}.${key}`);
      fields[key] = value[key];
    } else if (create) fields[key] = {};
  if (value.error_message !== undefined)
    fields.error_message = optionalText(value.error_message, `${where}.error_message`, 4000);
  if (value.related_type !== undefined)
    fields.related_type = optionalText(value.related_type, `${where}.related_type`, 80);
  if (value.related_id !== undefined) {
    const id = value.related_id;
    if (id !== null && !(typeof id === 'number' && Number.isSafeInteger(id) && id > 0))
      invalid(`${where}.related_id`);
    fields.related_id = id;
  }
  return fields;
}

/** 读模型的时间戳照 Python 接口的序列化：库里存 `YYYY-MM-DD HH:MM:SS`（UTC），接口给 `YYYY-MM-DDTHH:MM:SS`。 */
const apiTime = (value: SqlRow[string]) =>
  typeof value === 'string' ? value.replace(' ', 'T') : value;

function sessionRef(row: SqlRow): AssistantSessionRef {
  return {
    id: Number(row.id),
    project_path: row.project_path === null ? null : String(row.project_path),
  };
}

/**
 * 会话 / 消息 / 工具调用的 sqlite 存储（P4-1b），语义照 Python `assistant/service`：
 * 写入时脱敏（标题、消息正文、工具调用摘要与错误），读模型再脱敏一次；部分更新只改给出的字段；
 * 会话的 updated_at 只在会话行本身改动（改标题）时前移，最近会话按 updated_at、id 倒序。
 * 同时实现 agent 循环读会话事实的端口（标题、消息、工具调用的原始行）。
 * 密钥快照随调用方的配置变：每次按当时的配置新建一个实例，共用同一个写队列（`queue`）。
 */
export class SqlAssistantStore implements AssistantStore {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretContext,
    private readonly now: () => string,
    private readonly queue: SerialQueue = new SerialQueue(),
  ) {}

  private redactText = (value: string) => redactSensitiveText(value, this.secrets);
  private redactObj = (value: Obj) => redactSensitive(value as PlainJson, this.secrets) as Obj;

  private async session(id: number): Promise<SqlRow> {
    const rows = await this.db.select('SELECT * FROM assistant_sessions WHERE id = $1', [id]);
    if (!rows.length) throw new AssistantSessionNotFoundError(`Assistant 会话不存在：${id}。`);
    return rows[0];
  }

  // ---- AssistantStore（引擎写会话的端口） ----

  async createSession(
    input: Parameters<AssistantStore['createSession']>[0],
  ): Promise<AssistantSessionRef> {
    const value = input as unknown as Obj;
    if (!isObj(value)) invalid('session');
    onlyKeys(value, ['title', 'task_type', 'project_path', 'messages'], 'session');
    const title = text(value.title, 'title', 1, 160);
    const taskType = text(value.task_type, 'task_type', 1, 50);
    const projectPath = optionalText(value.project_path, 'project_path', 1024);
    const raw = value.messages === undefined ? [] : value.messages;
    if (!Array.isArray(raw) || raw.length > 50) invalid('messages');
    const messages = raw.map((item, index) => messageInput(item, `messages.${index}`));
    return this.queue.run(async () => {
      const at = this.now();
      // 一个事务：会话与开场消息一起落库；串行队列下 MAX(id) 就是刚插入的会话。
      const current = '(SELECT MAX(id) FROM assistant_sessions)';
      const rows = await this.db.transaction([
        {
          sql:
            'INSERT INTO assistant_sessions (title, task_type, project_path, created_at, updated_at) ' +
            'VALUES ($1, $2, $3, $4, $4)',
          params: [this.redactText(title), taskType, projectPath, at],
        },
        ...messages.map((message) => ({
          sql:
            'INSERT INTO assistant_messages (session_id, role, content, created_at, updated_at) ' +
            `VALUES (${current}, $1, $2, $3, $3)`,
          params: [message.role, this.redactText(message.content), at],
        })),
        { sql: `SELECT id, project_path FROM assistant_sessions WHERE id = ${current}` },
      ]);
      return sessionRef(rows[0]);
    });
  }

  getSession(id: number): Promise<AssistantSessionRef> {
    return this.queue.run(async () => sessionRef(await this.session(id)));
  }

  async appendMessage(
    sessionId: number,
    message: { role: string; content: string },
  ): Promise<void> {
    const input = messageInput(message, 'message');
    return this.queue.run(async () => {
      await this.session(sessionId);
      await this.db.transaction([
        {
          sql:
            'INSERT INTO assistant_messages (session_id, role, content, created_at, updated_at) ' +
            'VALUES ($1, $2, $3, $4, $4)',
          params: [sessionId, input.role, this.redactText(input.content), this.now()],
        },
      ]);
    });
  }

  async createToolCall(sessionId: number, input: Obj): Promise<StoredToolCall> {
    if (!isObj(input)) invalid('tool_call');
    const fields = toolCallFields(input, 'tool_call', true);
    return this.queue.run(async () => {
      await this.session(sessionId);
      const at = this.now();
      const rows = await this.db.transaction([
        {
          sql:
            'INSERT INTO assistant_tool_calls (session_id, tool_name, status, input_summary, output_summary, ' +
            'error_message, related_type, related_id, created_at, updated_at) ' +
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *',
          params: [
            sessionId,
            fields.tool_name as string,
            fields.status as string,
            encodeJsonColumn(this.redactObj(fields.input_summary as Obj)),
            encodeJsonColumn(this.redactObj(fields.output_summary as Obj)),
            fields.error_message === undefined || fields.error_message === null
              ? null
              : this.redactText(fields.error_message as string),
            (fields.related_type as string | null | undefined) ?? null,
            (fields.related_id as number | null | undefined) ?? null,
            at,
          ],
        },
      ]);
      return {
        id: Number(rows[0].id),
        input_summary: decodeJsonColumn(rows[0].input_summary) as Obj,
      };
    });
  }

  async updateToolCall(toolCallId: number, patch: ToolCallPatch | Obj): Promise<StoredToolCall> {
    if (!isObj(patch)) invalid('tool_call');
    const fields = toolCallFields(patch, 'tool_call', false);
    return this.queue.run(async () => {
      const found = await this.db.select('SELECT id FROM assistant_tool_calls WHERE id = $1', [
        toolCallId,
      ]);
      if (!found.length)
        throw new AssistantToolCallNotFoundError(`Assistant 工具调用不存在：${toolCallId}。`);
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      for (const [key, value] of Object.entries(fields)) {
        params.push(
          key === 'input_summary' || key === 'output_summary'
            ? encodeJsonColumn(this.redactObj(value as Obj))
            : key === 'error_message' && typeof value === 'string'
              ? this.redactText(value)
              : (value as string | number | null),
        );
        sets.push(`${key} = $${params.length}`);
      }
      params.push(this.now());
      sets.push(`updated_at = $${params.length}`);
      params.push(toolCallId);
      const rows = await this.db.transaction([
        {
          sql: `UPDATE assistant_tool_calls SET ${sets.join(', ')} WHERE id = $${params.length}`,
          params,
        },
        { sql: 'SELECT * FROM assistant_tool_calls WHERE id = $1', params: [toolCallId] },
      ]);
      return {
        id: Number(rows[0].id),
        input_summary: decodeJsonColumn(rows[0].input_summary) as Obj,
      };
    });
  }

  // ---- 会话标题（隐藏标题任务读写原值） ----

  title(sessionId: number): Promise<string> {
    return this.queue.run(async () => String((await this.session(sessionId)).title));
  }

  setTitle(sessionId: number, title: string): Promise<void> {
    return this.queue.run(async () => {
      await this.session(sessionId);
      await this.db.transaction([
        {
          sql: 'UPDATE assistant_sessions SET title = $1, updated_at = $2 WHERE id = $3',
          params: [Array.from(title).slice(0, 160).join(''), this.now(), sessionId],
        },
      ]);
    });
  }

  // ---- 会话事实（agent 循环读的原始行） ----

  messages(sessionId: number): Promise<readonly MessageRow[]> {
    return this.queue.run(async () =>
      (
        await this.db.select(
          'SELECT id, role, content FROM assistant_messages WHERE session_id = $1 ORDER BY id',
          [sessionId],
        )
      ).map((row) => ({
        id: Number(row.id),
        role: String(row.role),
        content: String(row.content),
      })),
    );
  }

  toolCalls(sessionId: number): Promise<readonly ToolCallRow[]> {
    return this.queue.run(async () =>
      (
        await this.db.select(
          'SELECT * FROM assistant_tool_calls WHERE session_id = $1 ORDER BY id',
          [sessionId],
        )
      ).map((row) => ({
        id: Number(row.id),
        tool_name: String(row.tool_name),
        status: String(row.status),
        input_summary: decodeJsonColumn(row.input_summary),
        output_summary: decodeJsonColumn(row.output_summary),
        related_type: row.related_type === null ? null : String(row.related_type),
        related_id: row.related_id === null ? null : Number(row.related_id),
      })),
    );
  }

  // ---- HTTP 读模型（左栏会话列表与详情、工具调用列表；随 P4-2 接线） ----

  private toolCallRead(row: SqlRow): Obj {
    return {
      id: Number(row.id),
      session_id: Number(row.session_id),
      tool_name: String(row.tool_name),
      status: String(row.status),
      input_summary: this.redactObj(decodeJsonColumn(row.input_summary) as Obj),
      output_summary: this.redactObj(decodeJsonColumn(row.output_summary) as Obj),
      error_message: row.error_message === null ? null : this.redactText(String(row.error_message)),
      related_type: row.related_type === null ? null : String(row.related_type),
      related_id: row.related_id === null ? null : Number(row.related_id),
      started_at: apiTime(row.started_at),
      finished_at: apiTime(row.finished_at),
      created_at: apiTime(row.created_at),
      updated_at: apiTime(row.updated_at),
    };
  }

  private async sessionRead(row: SqlRow): Promise<Obj> {
    const messages = await this.db.select(
      'SELECT * FROM assistant_messages WHERE session_id = $1 ORDER BY id',
      [Number(row.id)],
    );
    return {
      id: Number(row.id),
      title: this.redactText(String(row.title)),
      task_type: String(row.task_type),
      project_path: row.project_path === null ? null : String(row.project_path),
      messages: messages.map((message) => ({
        id: Number(message.id),
        session_id: Number(message.session_id),
        role: String(message.role),
        content: this.redactText(String(message.content)),
        created_at: apiTime(message.created_at),
        updated_at: apiTime(message.updated_at),
      })),
      created_at: apiTime(row.created_at),
      updated_at: apiTime(row.updated_at),
    };
  }

  sessionDetail(sessionId: number): Promise<Obj> {
    return this.queue.run(async () => this.sessionRead(await this.session(sessionId)));
  }

  listRecentSessions(
    options: { limit?: number; projectPath?: string | null } = {},
  ): Promise<Obj[]> {
    const limit = options.limit ?? 20;
    return this.queue.run(async () => {
      const rows =
        options.projectPath === undefined || options.projectPath === null
          ? await this.db.select(
              'SELECT * FROM assistant_sessions ORDER BY updated_at DESC, id DESC LIMIT $1',
              [limit],
            )
          : await this.db.select(
              'SELECT * FROM assistant_sessions WHERE project_path = $1 ORDER BY updated_at DESC, id DESC LIMIT $2',
              [options.projectPath, limit],
            );
      const output: Obj[] = [];
      for (const row of rows) output.push(await this.sessionRead(row));
      return output;
    });
  }

  toolCallList(sessionId: number): Promise<Obj[]> {
    return this.queue.run(async () => {
      await this.session(sessionId);
      return (
        await this.db.select(
          'SELECT * FROM assistant_tool_calls WHERE session_id = $1 ORDER BY id',
          [sessionId],
        )
      ).map((row) => this.toolCallRead(row));
    });
  }
}
