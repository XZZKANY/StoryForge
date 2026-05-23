import { readJson } from "../../lib/api-client";

type RunsModelRunSummary = {
  readonly id: number;
  readonly provider_name: string;
  readonly model_name: string;
  readonly capability: string;
  readonly status: string;
  readonly latency_ms: number;
  readonly token_usage: number;
  readonly error_message: string | null;
};

type RunsJobRun = {
  readonly id: number;
  readonly job_type: string;
  readonly status: string;
  readonly progress: Record<string, unknown>;
  readonly checkpoint: Record<string, unknown> | null;
  readonly model_runs: readonly RunsModelRunSummary[];
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type RunsJobRunState =
  | { readonly status: "ready"; readonly jobRun: RunsJobRun }
  | { readonly status: "error"; readonly message: string };

const runSections = [
  "模型运行日志",
  "Provider 解析结果",
  "Prompt Pack 来源",
  "Checkpoint 状态",
  "失败重试",
  "ModelRun adapter 契约",
  "任务恢复入口",
];

const runsJobRunEndpoint = "/api/model-runs/job-runs";
const runsRetryExecutionEndpoint = "POST /api/model-runs/job-runs/{job_run_id}/retry";

async function readRunsJobRun(jobRunId: number | undefined): Promise<RunsJobRunState> {
  if (jobRunId === undefined) {
    return { status: "error", message: "缺少 job_run_id，请在 URL query 中提供运行记录 ID。" };
  }
  const result = await readJson(`${runsJobRunEndpoint}/${jobRunId}`, {
    validate: isRunsJobRun,
    invalidMessage: "运行记录 API 返回格式不符合预期",
  });
  return result.status === "ready"
    ? { status: "ready", jobRun: result.data }
    : { status: "error", message: result.message.replace("API 返回", "运行记录 API 返回") };
}

function isRunsJobRun(value: unknown): value is RunsJobRun {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<RunsJobRun>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.job_type === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.progress === "object" &&
    candidate.progress !== null &&
    (typeof candidate.checkpoint === "object" || candidate.checkpoint === null) &&
    Array.isArray(candidate.model_runs) &&
    candidate.model_runs.every(isRunsModelRunSummary) &&
    (typeof candidate.error_message === "string" || candidate.error_message === null) &&
    typeof candidate.created_at === "string" &&
    typeof candidate.updated_at === "string"
  );
}

function isRunsModelRunSummary(value: unknown): value is RunsModelRunSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<RunsModelRunSummary>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.provider_name === "string" &&
    typeof candidate.model_name === "string" &&
    typeof candidate.capability === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.latency_ms === "number" &&
    typeof candidate.token_usage === "number" &&
    (typeof candidate.error_message === "string" || candidate.error_message === null)
  );
}

function readCurrentNode(progress: Record<string, unknown>): string {
  const currentNode = progress.current_node ?? progress.currentNode ?? progress.node;
  return typeof currentNode === "string" && currentNode.length > 0 ? currentNode : "暂无当前节点";
}

function formatCheckpointReference(checkpoint: Record<string, unknown> | null): string {
  if (!checkpoint) {
    return "暂无 checkpoint 引用";
  }

  const reference =
    checkpoint.reference ?? checkpoint.checkpoint_ref ?? checkpoint.checkpoint_id ?? checkpoint.id ?? checkpoint.node_id;
  if (typeof reference === "string" || typeof reference === "number") {
    return String(reference);
  }

  return JSON.stringify(checkpoint);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function RunsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly job_run_id?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const jobRunId = parsePositiveInt(resolvedSearchParams?.job_run_id);
  const jobRunState = await readRunsJobRun(jobRunId);

  return (
    <main aria-labelledby="runs-title">
      <h1 id="runs-title">Runs 运行链路</h1>
      <p>查看模型调用摘要、延迟、Token 使用量、Checkpoint 状态和恢复任务边界，支撑运行可观测性。</p>
      <section aria-labelledby="runs-current-scope-title">
        <h2 id="runs-current-scope-title">当前对象 / 当前证据 / 当前动作</h2>
        <dl>
          <dt>当前对象</dt>
          <dd>URL query 指定的 JobRun。</dd>
          <dt>当前证据</dt>
          <dd>Checkpoint、ModelRun 摘要、错误摘要、Provider 和 Token 使用量。</dd>
          <dt>当前动作</dt>
          <dd>核对恢复边界；retry 语义只代表创建恢复任务。</dd>
          <dt>当前边界</dt>
          <dd>本页只展示已验证的最小闭环。未联通能力不会伪装为可用操作。</dd>
        </dl>
      </section>
      <section aria-labelledby="runs-sections">
        <h2 id="runs-sections">运行记录视角</h2>
        <ul>
          {runSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="runs-job-run-title">
        <h2 id="runs-job-run-title">读取 JobRun {jobRunId === undefined ? "未选择" : `#${jobRunId}`}</h2>
        <p>Runs 工作台从 URL query 读取 job_run_id，不再硬编码固定运行记录。</p>
        {jobRunState.status === "error" ? (
          <p role="status">可重试错误摘要：{jobRunState.message}</p>
        ) : (
          <>
            <dl>
              <div>
                <dt>JobRun 状态</dt>
                <dd>{jobRunState.jobRun.status}</dd>
              </div>
              <div>
                <dt>任务类型</dt>
                <dd>{jobRunState.jobRun.job_type}</dd>
              </div>
              <div>
                <dt>当前节点</dt>
                <dd>{readCurrentNode(jobRunState.jobRun.progress)}</dd>
              </div>
              <div>
                <dt>错误摘要</dt>
                <dd>{jobRunState.jobRun.error_message ?? "暂无错误摘要"}</dd>
              </div>
              <div>
                <dt>Checkpoint 引用</dt>
                <dd>{formatCheckpointReference(jobRunState.jobRun.checkpoint)}</dd>
              </div>
            </dl>
            <section aria-labelledby="runs-model-runs-title">
              <h3 id="runs-model-runs-title">ModelRun 摘要</h3>
              {jobRunState.jobRun.model_runs.length === 0 ? (
                <p>空列表：当前 JobRun 暂无 ModelRun 记录。</p>
              ) : (
                <ul>
                  {jobRunState.jobRun.model_runs.map((modelRun) => (
                    <li key={modelRun.id}>
                      <strong>ModelRun #{modelRun.id}</strong>
                      <span>Provider：{modelRun.provider_name}</span>
                      <span>模型：{modelRun.model_name}</span>
                      <span>能力：{modelRun.capability}</span>
                      <span>状态：{modelRun.status}</span>
                      <span>Token：{modelRun.token_usage}</span>
                      <span>延迟：{modelRun.latency_ms}ms</span>
                      <span>错误：{modelRun.error_message ?? "暂无错误"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </section>
      <section aria-labelledby="runs-retry-execution-title">
        <h2 id="runs-retry-execution-title">失败重试执行入口</h2>
        <p>Endpoint：<code>{runsRetryExecutionEndpoint}</code></p>
        <p>该契约可创建恢复任务：后端基于失败 JobRun checkpoint 创建恢复任务，不是即时续跑 workflow。</p>
        <ul>
          <li>缺少 checkpoint 时不可重试，必须先拥有可恢复的 checkpoint 引用。</li>
          <li>Server Component 当前只展示执行契约，不伪装点击按钮；交互接入留给后续 Client Component 或 Server Action。</li>
        </ul>
      </section>
    </main>
  );
}
