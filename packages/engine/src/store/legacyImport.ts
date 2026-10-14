import { parseJson } from '../kernel/json';
import { encodeJsonColumn, type Db, type SqlRow, type SqlStep, type SqlValue } from './db';

/**
 * 旧库（Python sidecar 的 `storyforge.sqlite3`）的只读快照端口：所有查询在同一个读事务里执行，
 * sidecar 同时在写也读到同一时刻的数据；文件不存在时返回 null（不创建）。
 */
export interface LegacySnapshotSource {
  snapshot(queries: readonly string[]): Promise<SqlRow[][] | null>;
}

type ColumnKind = 'int' | 'int?' | 'text' | 'text?' | 'json' | 'bool' | 'time' | 'time?';

/**
 * 七张表按外键顺序导入；列取引擎库的列，旧库多出来的列（0.1.10 的 `book_run_id` 等、
 * 只服务 Python 多进程认领的 `execution_owner_event_id`）不导。
 */
const TABLES: readonly { readonly name: string; readonly columns: Record<string, ColumnKind> }[] = [
  {
    name: 'assistant_sessions',
    columns: {
      id: 'int',
      title: 'text',
      task_type: 'text',
      project_path: 'text?',
      created_at: 'time',
      updated_at: 'time',
    },
  },
  {
    name: 'assistant_messages',
    columns: {
      id: 'int',
      session_id: 'int',
      role: 'text',
      content: 'text',
      created_at: 'time',
      updated_at: 'time',
    },
  },
  {
    name: 'assistant_tool_calls',
    columns: {
      id: 'int',
      session_id: 'int',
      tool_name: 'text',
      status: 'text',
      input_summary: 'json',
      output_summary: 'json',
      error_message: 'text?',
      related_type: 'text?',
      related_id: 'int?',
      started_at: 'time?',
      finished_at: 'time?',
      created_at: 'time',
      updated_at: 'time',
    },
  },
  {
    name: 'agent_runs',
    columns: {
      id: 'int',
      public_id: 'text',
      session_id: 'text',
      assistant_session_id: 'int?',
      goal: 'text',
      scope: 'json',
      permission_profile: 'text',
      budget: 'json',
      status: 'text',
      root_plan: 'json',
      current_step: 'text?',
      created_at: 'time',
      updated_at: 'time',
    },
  },
  {
    name: 'agent_run_events',
    columns: {
      id: 'int',
      run_id: 'int',
      event_type: 'text',
      actor: 'text',
      message: 'text',
      payload: 'json',
      sequence: 'int',
      created_at: 'time',
      updated_at: 'time',
    },
  },
  {
    name: 'agent_artifacts',
    columns: {
      id: 'int',
      run_id: 'int',
      kind: 'text',
      payload: 'json',
      requires_confirmation: 'bool',
      created_at: 'time',
      updated_at: 'time',
    },
  },
  {
    name: 'subagent_runs',
    columns: {
      id: 'int',
      run_id: 'int',
      parent_run_id: 'int?',
      role: 'text',
      input: 'json',
      output: 'json',
      status: 'text',
      created_at: 'time',
      updated_at: 'time',
    },
  },
];

/** 引擎库 `engine_meta` 里的导入标记：写了就不再读旧库。 */
export const LEGACY_IMPORT_KEY = 'imported_from_v1';

export type LegacyImportResult = {
  readonly status: 'imported' | 'already_imported';
  /** 旧库文件是否存在（不存在也写标记：之后才出现的旧库不再导入）。 */
  readonly source_found: boolean;
  readonly rows: Readonly<Record<string, number>>;
};

/** 旧库的值超出导入范围，或引擎库里已经有数据。整组不写、不打标记，下次打开再试。 */
export class LegacyImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyImportError';
  }
}

// SQLite 的 CURRENT_TIMESTAMP（Python 库的 server_default）；引擎库与读模型都按这一种格式处理。
const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function convert(table: string, column: string, kind: ColumnKind, row: SqlRow): SqlValue {
  const value = row[column];
  const fail = (expected: string): never => {
    throw new LegacyImportError(
      `旧库 ${table}.${column}（id ${String(row.id)}）不是${expected}：${JSON.stringify(value)}`,
    );
  };
  const optional = kind.endsWith('?');
  if (value === null || value === undefined) return optional ? null : fail('非空值');
  switch (kind) {
    case 'int':
    case 'int?':
      return Number.isSafeInteger(value) ? value : fail('整数');
    case 'text':
    case 'text?':
      return typeof value === 'string' ? value : fail('文本');
    case 'time':
    case 'time?':
      return typeof value === 'string' && TIMESTAMP.test(value)
        ? value
        : fail('YYYY-MM-DD HH:MM:SS 时间');
    case 'bool':
      return value === 0 || value === 1 ? value : fail('0 / 1');
    case 'json':
      return typeof value === 'string'
        ? encodeJsonColumn(parseJson(value, `旧库 ${table}.${column}（id ${String(row.id)}）`))
        : fail('JSON 文本');
  }
}

async function readMarker(db: Db): Promise<LegacyImportResult | null> {
  const rows = await db.select('SELECT value FROM engine_meta WHERE key = $1', [LEGACY_IMPORT_KEY]);
  if (!rows.length) return null;
  const marker = JSON.parse(String(rows[0].value)) as Omit<LegacyImportResult, 'status'>;
  return { status: 'already_imported', source_found: marker.source_found, rows: marker.rows };
}

/**
 * 旧库只读导入一次（迁移计划 §2.3、P4-3）：七张表逐行逐列照搬（id 不变，左栏记住的会话、
 * 载荷里引用的 id 都照旧对得上），JSON 列按引擎的编码重写；全部行与标记在一个事务里提交。
 * 已有标记就不读旧库；引擎库里已经有数据时不导（id 会撞），报错留给调用方。
 * 必须在引擎第一次写库之前调用。
 */
export async function importLegacyDb(
  db: Db,
  legacy: LegacySnapshotSource,
  now: () => string,
): Promise<LegacyImportResult> {
  const marked = await readMarker(db);
  if (marked) return marked;

  const snapshot = await legacy.snapshot(
    TABLES.map(
      ({ name, columns }) => `SELECT ${Object.keys(columns).join(', ')} FROM ${name} ORDER BY id`,
    ),
  );
  if (snapshot !== null && snapshot.length !== TABLES.length)
    throw new LegacyImportError(
      `旧库快照应有 ${TABLES.length} 组结果，实际 ${String(snapshot.length)} 组`,
    );
  const rows: Record<string, number> = {};
  const steps: SqlStep[] = [];
  TABLES.forEach(({ name, columns }, index) => {
    const tableRows = snapshot === null ? [] : snapshot[index];
    rows[name] = tableRows.length;
    const names = Object.keys(columns);
    const sql = `INSERT INTO ${name} (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`;
    for (const row of tableRows)
      steps.push({
        sql,
        params: names.map((column) => convert(name, column, columns[column], row)),
      });
  });

  if (steps.length) {
    const counts = await db.select(
      `SELECT ${TABLES.map(({ name }) => `(SELECT COUNT(*) FROM ${name}) AS ${name}`).join(', ')}`,
    );
    const occupied = TABLES.filter(({ name }) => Number(counts[0][name]) > 0).map(
      ({ name }) => `${name} ${String(counts[0][name])} 行`,
    );
    if (occupied.length)
      throw new LegacyImportError(`引擎库已有数据（${occupied.join('、')}），旧库不导入`);
  }

  const result: LegacyImportResult = { status: 'imported', source_found: snapshot !== null, rows };
  steps.push({
    sql: 'INSERT INTO engine_meta (key, value) VALUES ($1, $2)',
    params: [
      LEGACY_IMPORT_KEY,
      JSON.stringify({ imported_at: now(), source_found: result.source_found, rows }),
    ],
  });
  await db.transaction(steps);
  return result;
}
