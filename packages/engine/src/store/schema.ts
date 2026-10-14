import type { Db, SqlStep } from './db';

/**
 * 引擎库（`storyforge-engine.sqlite3`，与旧库并排）的前向迁移。表名与列沿用 Python 库的七张表，
 * 旧库导入时逐列对得上；JSON 列存文本（`encodeJsonColumn`），时间存 ISO 8601 UTC 文本。
 * 迁移只追加、不改已发布的条目；每一条在一个事务里连同版本号一起提交。
 * `agent_runs.assistant_session_id` 不设外键：会话存储可以在别处（P4 切换前是 Python 库）。
 */
export const ENGINE_MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE assistant_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      task_type TEXT NOT NULL,
      project_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX ix_assistant_sessions_task_type ON assistant_sessions (task_type)',
    'CREATE INDEX ix_assistant_sessions_project_path ON assistant_sessions (project_path)',
    `CREATE TABLE assistant_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES assistant_sessions (id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX ix_assistant_messages_session_id ON assistant_messages (session_id)',
    `CREATE TABLE assistant_tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES assistant_sessions (id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      status TEXT NOT NULL,
      input_summary TEXT NOT NULL,
      output_summary TEXT NOT NULL,
      error_message TEXT,
      related_type TEXT,
      related_id INTEGER,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX ix_assistant_tool_calls_session_id ON assistant_tool_calls (session_id)',
    `CREATE TABLE agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      assistant_session_id INTEGER,
      goal TEXT NOT NULL,
      scope TEXT NOT NULL,
      permission_profile TEXT NOT NULL,
      budget TEXT NOT NULL,
      status TEXT NOT NULL,
      root_plan TEXT NOT NULL,
      current_step TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX ix_agent_runs_assistant_session_id ON agent_runs (assistant_session_id)',
    'CREATE INDEX ix_agent_runs_status ON agent_runs (status)',
    `CREATE TABLE agent_run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (run_id, sequence)
    )`,
    `CREATE TABLE agent_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      requires_confirmation INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX ix_agent_artifacts_run_id ON agent_artifacts (run_id)',
    'CREATE INDEX ix_agent_artifacts_kind ON agent_artifacts (kind)',
    `CREATE TABLE subagent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
      parent_run_id INTEGER REFERENCES agent_runs (id) ON DELETE SET NULL,
      role TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX ix_subagent_runs_run_id ON subagent_runs (run_id)',
  ],
];

export class EngineSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineSchemaError';
  }
}

/** 建版本表并补齐未执行的迁移；库比引擎新（降级打开）直接拒绝，不猜。 */
export async function migrateEngineDb(db: Db): Promise<number> {
  await db.transaction([
    { sql: 'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)' },
  ]);
  const rows = await db.select('SELECT version FROM schema_version');
  if (rows.length > 1) throw new EngineSchemaError('schema_version 有多行，库已损坏');
  const current = rows.length ? Number(rows[0].version) : 0;
  if (!Number.isSafeInteger(current) || current < 0)
    throw new EngineSchemaError(`schema_version 不是合法版本：${String(rows[0]?.version)}`);
  if (current > ENGINE_MIGRATIONS.length)
    throw new EngineSchemaError(
      `引擎库版本 ${current} 比这个版本的 StoryForge 新（最高 ${ENGINE_MIGRATIONS.length}），请升级后再打开`,
    );
  for (let version = current + 1; version <= ENGINE_MIGRATIONS.length; version++) {
    const steps: SqlStep[] = ENGINE_MIGRATIONS[version - 1].map((sql) => ({ sql }));
    steps.push(
      version === 1
        ? { sql: 'INSERT INTO schema_version (version) VALUES ($1)', params: [version] }
        : { sql: 'UPDATE schema_version SET version = $1', params: [version] },
    );
    await db.transaction(steps);
  }
  return ENGINE_MIGRATIONS.length;
}
