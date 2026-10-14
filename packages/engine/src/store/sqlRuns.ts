import {
  decodeJsonColumn,
  encodeJsonColumn,
  SerialQueue,
  type Db,
  type SqlRow,
  type SqlStep,
} from './db';
import {
  RunPublicIdConflictError,
  type ArtifactRecord,
  type Obj,
  type RunEventFields,
  type RunEventRecord,
  type RunPatch,
  type RunRecord,
  type RunStatusView,
  type RunStore,
  type SubagentRecord,
} from './runs';

const RUN_COLUMNS =
  'public_id, session_id, assistant_session_id, goal, scope, permission_profile, budget, status, root_plan, current_step';

function runFromRow(row: SqlRow): RunRecord {
  return {
    id: Number(row.id),
    public_id: String(row.public_id),
    session_id: String(row.session_id),
    assistant_session_id:
      row.assistant_session_id === null ? null : Number(row.assistant_session_id),
    goal: String(row.goal),
    scope: decodeJsonColumn(row.scope) as Obj,
    permission_profile: String(row.permission_profile),
    budget: decodeJsonColumn(row.budget) as Obj,
    status: String(row.status),
    root_plan: decodeJsonColumn(row.root_plan) as unknown[],
    current_step: row.current_step === null ? null : String(row.current_step),
  };
}

const eventFromRow = (row: SqlRow): RunEventRecord => ({
  id: Number(row.id),
  run_id: Number(row.run_id),
  event_type: String(row.event_type),
  actor: String(row.actor),
  message: String(row.message),
  payload: decodeJsonColumn(row.payload) as Obj,
  sequence: Number(row.sequence),
});

const artifactFromRow = (row: SqlRow): ArtifactRecord => ({
  id: Number(row.id),
  run_id: Number(row.run_id),
  kind: String(row.kind),
  payload: decodeJsonColumn(row.payload) as Obj,
  requires_confirmation: Number(row.requires_confirmation) === 1,
});

const subagentFromRow = (row: SqlRow): SubagentRecord => ({
  id: Number(row.id),
  run_id: Number(row.run_id),
  parent_run_id: row.parent_run_id === null ? null : Number(row.parent_run_id),
  role: String(row.role),
  input: decodeJsonColumn(row.input) as Obj,
  output: decodeJsonColumn(row.output) as Obj,
  status: String(row.status),
});

// 深拷贝走同一种编码：与写进库、再读出来的形状完全一致。
const copy = <T>(value: T): T => decodeJsonColumn(encodeJsonColumn(value)) as T;

/** 存储写入失败之后，内存镜像与库可能已经不一致：拒绝后续操作，等重新打开。 */
export class RunStoreBrokenError extends Error {
  constructor(cause: unknown) {
    super(
      `运行存储写入失败，需要重新打开：${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'RunStoreBrokenError';
  }
}

/**
 * run 存储的 sqlite 实现（P4-1）。run 行在内存里留一份镜像：运行控制要同步读状态，
 * 条件写（结算 / 比较交换）也在调用当下对镜像判定并生效——与内存实现同一时刻、同一语义；
 * 每次改动随即按调用顺序排进串行队列，在一个事务里落库，落完才返回。
 * id 与事件 sequence 在调用当下分配（全局自增、按 run 自增），与内存实现一致。
 */
export class SqlRunStore implements RunStore, RunStatusView {
  private readonly runs = new Map<number, RunRecord>();
  private readonly byPublicId = new Map<string, number>();
  private readonly sequences = new Map<number, number>();
  private readonly queue = new SerialQueue();
  private nextIds = { run: 1, event: 1, artifact: 1, subagent: 1 };
  private broken: RunStoreBrokenError | null = null;

  private constructor(
    private readonly db: Db,
    private readonly now: () => string,
  ) {}

  /** 打开已迁移的库：载入全部 run 行与各表的下一个 id。 */
  static async open(db: Db, now: () => string): Promise<SqlRunStore> {
    const store = new SqlRunStore(db, now);
    for (const row of await db.select(`SELECT id, ${RUN_COLUMNS} FROM agent_runs ORDER BY id`)) {
      const run = runFromRow(row);
      store.runs.set(run.id, run);
      store.byPublicId.set(run.public_id, run.id);
    }
    for (const row of await db.select(
      'SELECT run_id, MAX(sequence) AS sequence FROM agent_run_events GROUP BY run_id',
    ))
      store.sequences.set(Number(row.run_id), Number(row.sequence));
    const next = async (table: string) =>
      Number((await db.select(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM ${table}`))[0].next);
    store.nextIds = {
      run: await next('agent_runs'),
      event: await next('agent_run_events'),
      artifact: await next('agent_artifacts'),
      subagent: await next('subagent_runs'),
    };
    return store;
  }

  private guard() {
    if (this.broken) throw this.broken;
  }

  /** 排进队列落库；失败即把存储标成坏的。 */
  private commit<T>(steps: readonly SqlStep[], then: (rows: SqlRow[]) => T): Promise<T> {
    return this.queue.run(async () => {
      this.guard();
      try {
        return then(await this.db.transaction(steps));
      } catch (error) {
        this.broken ??= new RunStoreBrokenError(error);
        throw this.broken;
      }
    });
  }

  private read<T>(
    sql: string,
    params: readonly (string | number | null)[],
    map: (rows: SqlRow[]) => T,
  ) {
    return this.queue.run(async () => {
      this.guard();
      return map(await this.db.select(sql, params));
    });
  }

  private mirror(id: number): RunRecord {
    const run = this.runs.get(id);
    if (!run) throw new RangeError(`run ${id} 不存在`);
    return run;
  }

  private runUpdate(run: RunRecord): SqlStep {
    return {
      sql:
        'UPDATE agent_runs SET public_id = $1, session_id = $2, assistant_session_id = $3, goal = $4, ' +
        'scope = $5, permission_profile = $6, budget = $7, status = $8, root_plan = $9, current_step = $10, ' +
        'updated_at = $11 WHERE id = $12',
      params: [
        run.public_id,
        run.session_id,
        run.assistant_session_id,
        run.goal,
        encodeJsonColumn(run.scope),
        run.permission_profile,
        encodeJsonColumn(run.budget),
        run.status,
        encodeJsonColumn(run.root_plan),
        run.current_step,
        this.now(),
        run.id,
      ],
    };
  }

  private eventInsert(event: RunEventRecord): SqlStep {
    const at = this.now();
    return {
      sql:
        'INSERT INTO agent_run_events (id, run_id, event_type, actor, message, payload, sequence, created_at, updated_at) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)',
      params: [
        event.id,
        event.run_id,
        event.event_type,
        event.actor,
        event.message,
        encodeJsonColumn(event.payload),
        event.sequence,
        at,
      ],
    };
  }

  private newEvent(fields: RunEventFields): RunEventRecord {
    const sequence = (this.sequences.get(fields.run_id) ?? 0) + 1;
    this.sequences.set(fields.run_id, sequence);
    return { id: this.nextIds.event++, sequence, ...copy(fields) };
  }

  peek(id: number) {
    const run = this.mirror(id);
    return { status: run.status, current_step: run.current_step };
  }

  async findRun(publicId: string): Promise<RunRecord | null> {
    this.guard();
    const id = this.byPublicId.get(publicId);
    return id === undefined ? null : copy(this.mirror(id));
  }

  async getRun(id: number): Promise<RunRecord> {
    this.guard();
    return copy(this.mirror(id));
  }

  async insertRun(fields: Omit<RunRecord, 'id'>): Promise<RunRecord> {
    this.guard();
    if (this.byPublicId.has(fields.public_id)) throw new RunPublicIdConflictError(fields.public_id);
    const run: RunRecord = { id: this.nextIds.run++, ...copy(fields) };
    this.runs.set(run.id, run);
    this.byPublicId.set(run.public_id, run.id);
    const at = this.now();
    return this.commit(
      [
        {
          sql:
            `INSERT INTO agent_runs (id, ${RUN_COLUMNS}, created_at, updated_at) ` +
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)',
          params: [
            run.id,
            run.public_id,
            run.session_id,
            run.assistant_session_id,
            run.goal,
            encodeJsonColumn(run.scope),
            run.permission_profile,
            encodeJsonColumn(run.budget),
            run.status,
            encodeJsonColumn(run.root_plan),
            run.current_step,
            at,
          ],
        },
      ],
      () => copy(run),
    );
  }

  async updateRun(id: number, patch: RunPatch): Promise<RunRecord> {
    this.guard();
    const run = this.mirror(id);
    Object.assign(run, copy(patch));
    return this.commit([this.runUpdate(run)], () => copy(run));
  }

  async settleRun(
    id: number,
    from: string,
    patch: RunPatch,
    event: (run: RunRecord) => RunEventFields,
  ): Promise<{ run: RunRecord; event: RunEventRecord } | null> {
    this.guard();
    const run = this.mirror(id);
    if (run.status !== from) return null;
    // 先算事件：回调抛错时什么都没写（对应事务回滚）。
    const fields = event({ ...copy(run), ...copy(patch) });
    Object.assign(run, copy(patch));
    const recorded = this.newEvent(fields);
    return this.commit([this.runUpdate(run), this.eventInsert(recorded)], () => ({
      run: copy(run),
      event: copy(recorded),
    }));
  }

  async updateRunIf(
    id: number,
    expected: { status: string | readonly string[]; current_step?: string | null },
    patch: RunPatch,
  ): Promise<RunRecord | null> {
    this.guard();
    const run = this.mirror(id);
    const statuses: readonly string[] =
      typeof expected.status === 'string' ? [expected.status] : expected.status;
    if (!statuses.includes(run.status)) return null;
    if (expected.current_step !== undefined && run.current_step !== expected.current_step)
      return null;
    Object.assign(run, copy(patch));
    return this.commit([this.runUpdate(run)], () => copy(run));
  }

  async appendEvent(fields: RunEventFields): Promise<RunEventRecord> {
    this.guard();
    this.mirror(fields.run_id);
    const event = this.newEvent(fields);
    return this.commit([this.eventInsert(event)], () => copy(event));
  }

  async updateEvent(id: number, payload: Obj): Promise<RunEventRecord> {
    this.guard();
    return this.commit(
      [
        {
          sql: 'UPDATE agent_run_events SET payload = $1, updated_at = $2 WHERE id = $3',
          params: [encodeJsonColumn(payload), this.now(), id],
        },
        { sql: 'SELECT * FROM agent_run_events WHERE id = $1', params: [id] },
      ],
      (rows) => {
        if (!rows.length) throw new RangeError(`event ${id} 不存在`);
        return eventFromRow(rows[0]);
      },
    );
  }

  async insertArtifact(fields: Omit<ArtifactRecord, 'id'>): Promise<ArtifactRecord> {
    this.guard();
    this.mirror(fields.run_id);
    const artifact: ArtifactRecord = { id: this.nextIds.artifact++, ...copy(fields) };
    const at = this.now();
    return this.commit(
      [
        {
          sql:
            'INSERT INTO agent_artifacts (id, run_id, kind, payload, requires_confirmation, created_at, updated_at) ' +
            'VALUES ($1, $2, $3, $4, $5, $6, $6)',
          params: [
            artifact.id,
            artifact.run_id,
            artifact.kind,
            encodeJsonColumn(artifact.payload),
            artifact.requires_confirmation ? 1 : 0,
            at,
          ],
        },
      ],
      () => copy(artifact),
    );
  }

  async updateArtifact(id: number, payload: Obj): Promise<ArtifactRecord> {
    this.guard();
    return this.commit(
      [
        {
          sql: 'UPDATE agent_artifacts SET payload = $1, updated_at = $2 WHERE id = $3',
          params: [encodeJsonColumn(payload), this.now(), id],
        },
        { sql: 'SELECT * FROM agent_artifacts WHERE id = $1', params: [id] },
      ],
      (rows) => {
        if (!rows.length) throw new RangeError(`artifact ${id} 不存在`);
        return artifactFromRow(rows[0]);
      },
    );
  }

  async insertSubagent(fields: Omit<SubagentRecord, 'id'>): Promise<SubagentRecord> {
    this.guard();
    this.mirror(fields.run_id);
    const subagent: SubagentRecord = { id: this.nextIds.subagent++, ...copy(fields) };
    const at = this.now();
    return this.commit(
      [
        {
          sql:
            'INSERT INTO subagent_runs (id, run_id, parent_run_id, role, input, output, status, created_at, updated_at) ' +
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)',
          params: [
            subagent.id,
            subagent.run_id,
            subagent.parent_run_id,
            subagent.role,
            encodeJsonColumn(subagent.input),
            encodeJsonColumn(subagent.output),
            subagent.status,
            at,
          ],
        },
      ],
      () => copy(subagent),
    );
  }

  events(runId: number): Promise<readonly RunEventRecord[]> {
    return this.read(
      'SELECT * FROM agent_run_events WHERE run_id = $1 ORDER BY sequence, id',
      [runId],
      (rows) => rows.map(eventFromRow),
    );
  }

  artifacts(runId: number): Promise<readonly ArtifactRecord[]> {
    return this.read(
      'SELECT * FROM agent_artifacts WHERE run_id = $1 ORDER BY id',
      [runId],
      (rows) => rows.map(artifactFromRow),
    );
  }

  artifact(id: number): Promise<ArtifactRecord | null> {
    return this.read('SELECT * FROM agent_artifacts WHERE id = $1', [id], (rows) =>
      rows.length ? artifactFromRow(rows[0]) : null,
    );
  }

  artifactsOfKind(kind: string): Promise<readonly ArtifactRecord[]> {
    return this.read('SELECT * FROM agent_artifacts WHERE kind = $1 ORDER BY id', [kind], (rows) =>
      rows.map(artifactFromRow),
    );
  }

  eventsOfTypes(types: readonly string[]): Promise<readonly RunEventRecord[]> {
    const marks = types.map((_type, index) => `$${index + 1}`).join(', ');
    return this.read(
      `SELECT * FROM agent_run_events WHERE event_type IN (${marks || 'NULL'}) ORDER BY id`,
      types,
      (rows) => rows.map(eventFromRow),
    );
  }

  async runsOfAssistantSession(assistantSessionId: number): Promise<readonly RunRecord[]> {
    this.guard();
    return [...this.runs.values()]
      .filter((run) => run.assistant_session_id === assistantSessionId)
      .map((run) => copy(run));
  }

  async allRuns(): Promise<readonly RunRecord[]> {
    this.guard();
    return [...this.runs.values()].map((run) => copy(run));
  }

  /** 测试与对账用：某个 id 之后新增的行（读的是库，不是镜像）。 */
  rowsAfter(cursor: { events: number; artifacts: number; subagents: number }) {
    return this.queue.run(async () => ({
      events: (
        await this.db.select('SELECT * FROM agent_run_events WHERE id > $1 ORDER BY id', [
          cursor.events,
        ])
      ).map(eventFromRow),
      artifacts: (
        await this.db.select('SELECT * FROM agent_artifacts WHERE id > $1 ORDER BY id', [
          cursor.artifacts,
        ])
      ).map(artifactFromRow),
      subagents: (
        await this.db.select('SELECT * FROM subagent_runs WHERE id > $1 ORDER BY id', [
          cursor.subagents,
        ])
      ).map(subagentFromRow),
    }));
  }
}
