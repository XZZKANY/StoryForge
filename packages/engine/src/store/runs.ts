import { cloneJson, type JsonValue, type Obj } from '../kernel/json';

/**
 * Agent run 的存储端口：runs / run_events / artifacts / subagent_runs 四张表的行。
 * P4 前只有内存实现（窗口生命周期内有效）；P4 换成 sqlite，接口不变。
 * id 全局自增、事件 sequence 按 run 自增，与 Python 库一致（帧与证据里都看得到这两个数）。
 */

export type RunRecord = {
  readonly id: number;
  public_id: string;
  session_id: string;
  assistant_session_id: number | null;
  goal: string;
  scope: Obj;
  permission_profile: string;
  budget: Obj;
  status: string;
  root_plan: unknown[];
  current_step: string | null;
};

export type RunEventRecord = {
  readonly id: number;
  readonly run_id: number;
  readonly event_type: string;
  readonly actor: string;
  readonly message: string;
  readonly payload: Obj;
  readonly sequence: number;
};

export type ArtifactRecord = {
  readonly id: number;
  readonly run_id: number;
  readonly kind: string;
  readonly payload: Obj;
  readonly requires_confirmation: boolean;
};

export type SubagentRecord = {
  readonly id: number;
  readonly run_id: number;
  readonly parent_run_id: number | null;
  readonly role: string;
  readonly input: Obj;
  readonly output: Obj;
  readonly status: string;
};

export type RunPatch = Partial<Omit<RunRecord, 'id'>>;
export type RunEventFields = Omit<RunEventRecord, 'id' | 'sequence'>;

/** public_id 唯一约束被违反（等价 Python 库 `agent_runs.public_id` 的 unique 索引）。 */
export class RunPublicIdConflictError extends Error {
  constructor(publicId: string) {
    super(`run ${publicId} 已存在`);
    this.name = 'RunPublicIdConflictError';
  }
}

export interface RunStore {
  findRun(publicId: string): Promise<RunRecord | null>;
  getRun(id: number): Promise<RunRecord>;
  /** public_id 已存在时抛 RunPublicIdConflictError，不覆盖、不重复插入。 */
  insertRun(fields: Omit<RunRecord, 'id'>): Promise<RunRecord>;
  updateRun(id: number, patch: RunPatch): Promise<RunRecord>;
  /**
   * 条件结算：仅当 run 当前状态是 `from` 时写入 patch 并追加 event（同一原子边界，
   * 等价 Python 的 `UPDATE … WHERE status = 'running'` 与同事务记事件）；否则什么都不写、返回 null。
   * 控制通道在结算前落下的 paused / stopped 因此不会被覆盖，也不会多出终态事件。
   */
  settleRun(
    id: number,
    from: string,
    patch: RunPatch,
    event: (run: RunRecord) => RunEventFields,
  ): Promise<{ run: RunRecord; event: RunEventRecord } | null>;
  /**
   * 控制通道的比较交换：仅当 run 的状态与步骤仍是读到的值时写入 patch，否则不写、返回 null
   * （Python 的 `UPDATE … WHERE status = ? AND current_step = ?`）。
   */
  updateRunIf(
    id: number,
    expected: { status: string | readonly string[]; current_step?: string | null },
    patch: RunPatch,
  ): Promise<RunRecord | null>;
  /** 控制事件先占序号、裁决后回写载荷（Python 同一事务里改这一行）。 */
  updateEvent(id: number, payload: Obj): Promise<RunEventRecord>;
  /** 追加一条事件：id 全局递增，sequence = 该 run 当前最大值 + 1。 */
  appendEvent(fields: RunEventFields): Promise<RunEventRecord>;
  insertArtifact(fields: Omit<ArtifactRecord, 'id'>): Promise<ArtifactRecord>;
  /** 整行覆盖一个 artifact 的载荷（模型请求证据逐次结算用）。 */
  updateArtifact(id: number, payload: Obj): Promise<ArtifactRecord>;
  insertSubagent(fields: Omit<SubagentRecord, 'id'>): Promise<SubagentRecord>;
  events(runId: number): Promise<readonly RunEventRecord[]>;
  artifacts(runId: number): Promise<readonly ArtifactRecord[]>;
  artifact(id: number): Promise<ArtifactRecord | null>;
  /** 所有 run 里某种 artifact，按 id 升序（知识提议跨 run 去重要用）。 */
  artifactsOfKind(kind: string): Promise<readonly ArtifactRecord[]>;
  /** 所有 run 里这几种事件，按 id 升序（知识收件箱按事件推导提议状态）。 */
  eventsOfTypes(types: readonly string[]): Promise<readonly RunEventRecord[]>;
  runsOfAssistantSession(assistantSessionId: number): Promise<readonly RunRecord[]>;
  /** 全部 run，按 id 升序（起服收尸要用）。 */
  allRuns(): Promise<readonly RunRecord[]>;
  /** artifact 落库的时间（库里的存储格式；章节检查历史要用），不存在时为 null。 */
  artifactCreatedAt(id: number): Promise<string | null>;
}

/** 同步读出某个 run 当前的状态与步骤（运行控制在传输层的同步检查要用）。 */
export interface RunStatusView {
  peek(id: number): { readonly status: string; readonly current_step: string | null };
}

// JsonFloat 要保留类身份（structuredClone 会把它变成普通对象）。
const clone = <T>(value: T): T => cloneJson(value as JsonValue) as T;

/** 内存实现：返回值都是副本，调用方改了不影响存储（与重新读库同义）。 */
export class MemoryRunStore implements RunStore, RunStatusView {
  private readonly runs: RunRecord[] = [];
  private readonly eventRows: RunEventRecord[] = [];
  private readonly artifactRows: ArtifactRecord[] = [];
  private readonly subagentRows: SubagentRecord[] = [];
  private readonly artifactTimes = new Map<number, string>();

  /** `now`：artifact 的落库时间，格式同库里的存储（UTC、精确到秒）。 */
  constructor(
    private readonly now: () => string = () =>
      new Date().toISOString().slice(0, 19).replace('T', ' '),
  ) {}

  async findRun(publicId: string): Promise<RunRecord | null> {
    const run = this.runs.find((item) => item.public_id === publicId);
    return run ? clone(run) : null;
  }

  peek(id: number) {
    const run = this.runs.find((item) => item.id === id);
    if (!run) throw new RangeError(`run ${id} 不存在`);
    return { status: run.status, current_step: run.current_step };
  }

  async getRun(id: number): Promise<RunRecord> {
    const run = this.runs.find((item) => item.id === id);
    if (!run) throw new RangeError(`run ${id} 不存在`);
    return clone(run);
  }

  async insertRun(fields: Omit<RunRecord, 'id'>): Promise<RunRecord> {
    if (this.runs.some((item) => item.public_id === fields.public_id))
      throw new RunPublicIdConflictError(fields.public_id);
    const run = { id: this.runs.length + 1, ...clone(fields) };
    this.runs.push(run);
    return clone(run);
  }

  async updateRun(id: number, patch: RunPatch): Promise<RunRecord> {
    const run = this.runs.find((item) => item.id === id);
    if (!run) throw new RangeError(`run ${id} 不存在`);
    Object.assign(run, clone(patch));
    return clone(run);
  }

  // 检查、写入与记事件之间没有 await：其他调用插不进来。
  async settleRun(
    id: number,
    from: string,
    patch: RunPatch,
    event: (run: RunRecord) => RunEventFields,
  ): Promise<{ run: RunRecord; event: RunEventRecord } | null> {
    const run = this.runs.find((item) => item.id === id);
    if (!run) throw new RangeError(`run ${id} 不存在`);
    if (run.status !== from) return null;
    // 先算事件：回调抛错时什么都没写（对应事务回滚）。
    const fields = event({ ...clone(run), ...clone(patch) });
    Object.assign(run, clone(patch));
    return { run: clone(run), event: this.pushEvent(fields) };
  }

  async updateRunIf(
    id: number,
    expected: { status: string | readonly string[]; current_step?: string | null },
    patch: RunPatch,
  ): Promise<RunRecord | null> {
    const run = this.runs.find((item) => item.id === id);
    if (!run) throw new RangeError(`run ${id} 不存在`);
    const statuses: readonly string[] =
      typeof expected.status === 'string' ? [expected.status] : expected.status;
    if (!statuses.includes(run.status)) return null;
    if (expected.current_step !== undefined && run.current_step !== expected.current_step)
      return null;
    Object.assign(run, clone(patch));
    return clone(run);
  }

  async appendEvent(fields: RunEventFields): Promise<RunEventRecord> {
    return this.pushEvent(fields);
  }

  async updateEvent(id: number, payload: Obj): Promise<RunEventRecord> {
    const index = this.eventRows.findIndex((item) => item.id === id);
    if (index < 0) throw new RangeError(`event ${id} 不存在`);
    this.eventRows[index] = { ...this.eventRows[index], payload: clone(payload) };
    return clone(this.eventRows[index]);
  }

  private pushEvent(fields: RunEventFields): RunEventRecord {
    const sequence =
      this.eventRows
        .filter((event) => event.run_id === fields.run_id)
        .reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
    const event = { id: this.eventRows.length + 1, sequence, ...clone(fields) };
    this.eventRows.push(event);
    return clone(event);
  }

  async insertArtifact(fields: Omit<ArtifactRecord, 'id'>): Promise<ArtifactRecord> {
    const artifact = { id: this.artifactRows.length + 1, ...clone(fields) };
    this.artifactRows.push(artifact);
    this.artifactTimes.set(artifact.id, this.now());
    return clone(artifact);
  }

  async artifactCreatedAt(id: number): Promise<string | null> {
    return this.artifactTimes.get(id) ?? null;
  }

  async updateArtifact(id: number, payload: Obj): Promise<ArtifactRecord> {
    const index = this.artifactRows.findIndex((item) => item.id === id);
    if (index < 0) throw new RangeError(`artifact ${id} 不存在`);
    this.artifactRows[index] = { ...this.artifactRows[index], payload: clone(payload) };
    return clone(this.artifactRows[index]);
  }

  async insertSubagent(fields: Omit<SubagentRecord, 'id'>): Promise<SubagentRecord> {
    const subagent = { id: this.subagentRows.length + 1, ...clone(fields) };
    this.subagentRows.push(subagent);
    return clone(subagent);
  }

  async events(runId: number): Promise<readonly RunEventRecord[]> {
    return clone(
      this.eventRows
        .filter((event) => event.run_id === runId)
        .sort((a, b) => a.sequence - b.sequence || a.id - b.id),
    );
  }

  async artifacts(runId: number): Promise<readonly ArtifactRecord[]> {
    return clone(this.artifactRows.filter((artifact) => artifact.run_id === runId));
  }

  async artifact(id: number): Promise<ArtifactRecord | null> {
    const row = this.artifactRows.find((artifact) => artifact.id === id);
    return row ? clone(row) : null;
  }

  async artifactsOfKind(kind: string): Promise<readonly ArtifactRecord[]> {
    return clone(
      this.artifactRows.filter((artifact) => artifact.kind === kind).sort((a, b) => a.id - b.id),
    );
  }

  async eventsOfTypes(types: readonly string[]): Promise<readonly RunEventRecord[]> {
    return clone(
      this.eventRows
        .filter((event) => types.includes(event.event_type))
        .sort((a, b) => a.id - b.id),
    );
  }

  async runsOfAssistantSession(assistantSessionId: number): Promise<readonly RunRecord[]> {
    return clone(this.runs.filter((run) => run.assistant_session_id === assistantSessionId));
  }

  async allRuns(): Promise<readonly RunRecord[]> {
    return clone(this.runs);
  }

  /** 测试与对账用：某个 id 之后新增的行。 */
  rowsAfter(cursor: { events: number; artifacts: number; subagents: number }) {
    return {
      events: clone(this.eventRows.filter((row) => row.id > cursor.events)),
      artifacts: clone(this.artifactRows.filter((row) => row.id > cursor.artifacts)),
      subagents: clone(this.subagentRows.filter((row) => row.id > cursor.subagents)),
    };
  }
}
