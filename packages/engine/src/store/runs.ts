import { cloneJson, type JsonValue } from '../kernel/json';

/**
 * Agent run 的存储端口：runs / run_events / artifacts / subagent_runs 四张表的行。
 * P4 前只有内存实现（窗口生命周期内有效）；P4 换成 sqlite，接口不变。
 * id 全局自增、事件 sequence 按 run 自增，与 Python 库一致（帧与证据里都看得到这两个数）。
 */

export type Obj = { [key: string]: unknown };

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
  /** 追加一条事件：id 全局递增，sequence = 该 run 当前最大值 + 1。 */
  appendEvent(fields: RunEventFields): Promise<RunEventRecord>;
  insertArtifact(fields: Omit<ArtifactRecord, 'id'>): Promise<ArtifactRecord>;
  /** 整行覆盖一个 artifact 的载荷（模型请求证据逐次结算用）。 */
  updateArtifact(id: number, payload: Obj): Promise<ArtifactRecord>;
  insertSubagent(fields: Omit<SubagentRecord, 'id'>): Promise<SubagentRecord>;
  events(runId: number): Promise<readonly RunEventRecord[]>;
  artifacts(runId: number): Promise<readonly ArtifactRecord[]>;
  runsOfAssistantSession(assistantSessionId: number): Promise<readonly RunRecord[]>;
}

// JsonFloat 要保留类身份（structuredClone 会把它变成普通对象）。
const clone = <T>(value: T): T => cloneJson(value as JsonValue) as T;

/** 内存实现：返回值都是副本，调用方改了不影响存储（与重新读库同义）。 */
export class MemoryRunStore implements RunStore {
  private readonly runs: RunRecord[] = [];
  private readonly eventRows: RunEventRecord[] = [];
  private readonly artifactRows: ArtifactRecord[] = [];
  private readonly subagentRows: SubagentRecord[] = [];

  async findRun(publicId: string): Promise<RunRecord | null> {
    const run = this.runs.find((item) => item.public_id === publicId);
    return run ? clone(run) : null;
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

  async appendEvent(fields: RunEventFields): Promise<RunEventRecord> {
    return this.pushEvent(fields);
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
    return clone(artifact);
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

  async runsOfAssistantSession(assistantSessionId: number): Promise<readonly RunRecord[]> {
    return clone(this.runs.filter((run) => run.assistant_session_id === assistantSessionId));
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
