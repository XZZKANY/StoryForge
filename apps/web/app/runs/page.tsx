import { phase6DataSources } from "../../lib/phase6-data-sources";

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

const defaultJobRunId = 1;
const runsJobRunEndpoint = "/api/model-runs/job-runs";
const runsRetryExecutionEndpoint = "POST /api/model-runs/job-runs/{job_run_id}/retry";

const getRunsApiBaseUrl = () => process.env.STORYFORGE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function readRunsJobRun(jobRunId = defaultJobRunId): Promise<RunsJobRunState> {
  try {
    const response = await fetch(new URL(`${runsJobRunEndpoint}/${jobRunId}`, getRunsApiBaseUrl()), {
      cache: "no-store",
    });
    if (!response.ok) {
      return { status: "error", message: `运行记录 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!isRunsJobRun(payload)) {
      return { status: "error", message: "运行记录 API 返回格式不符合预期" };
    }

    return { status: "ready", jobRun: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { status: "error", message };
  }
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

export default async function RunsPage() {
  const jobRunState = await readRunsJobRun();

  return (
    <main aria-labelledby="runs-title">
      <h1 id="runs-title">Run Center 运行日志中心</h1>
      <p>查看模型调用摘要、延迟、Token 使用量、Checkpoint 状态和失败重试入口，支撑运行可观测性。</p>
      <section aria-labelledby="runs-sections">
        <h2 id="runs-sections">运行记录视角</h2>
        <ul>
          {runSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="runs-job-run-title">
        <h2 id="runs-job-run-title">读取 JobRun #{defaultJobRunId}</h2>
        <p>当前 Runs 工作台只读取 {runsJobRunEndpoint}/{defaultJobRunId} 这一条运行记录。</p>
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
      <section aria-labelledby="runs-data-sources-title">
        <h2 id="runs-data-sources-title">数据源契约</h2>
        <ul>
          {phase6DataSources.runs.map((source) => (
            <li key={source.name}>
              <strong>{source.name}</strong>：{source.output}（{source.status}）
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
