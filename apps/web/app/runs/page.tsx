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

type RunsWorkflowSessionSummary = {
  readonly session_id: string | null;
  readonly thread_id: string | null;
  readonly job_run_id: string;
  readonly status: string;
  readonly current_node: string;
  readonly approval_status: string | null;
  readonly last_heartbeat_ms: number | null;
  readonly prompt_count: number;
};

type RunsWorkflowLifecycleSummary = {
  readonly status: string;
  readonly current_node: string;
  readonly message: string;
  readonly failure_kind: string | null;
  readonly recoverable: boolean | null;
};

type RunsProviderSummary = {
  readonly provider_name: string;
  readonly model_name: string;
  readonly capability: string;
  readonly status: string;
  readonly latency_ms: number;
  readonly token_usage: number;
  readonly error_message: string | null;
};

type RunsModelUsageSummary = {
  readonly model_run_count: number;
  readonly failed_model_run_count: number;
  readonly total_token_usage: number;
  readonly max_latency_ms: number;
};

type RunsRuntimeToolSummary = {
  readonly name: string;
  readonly domain: string;
  readonly required_capabilities: readonly string[];
  readonly evidence_fields: readonly string[];
  readonly workflow_nodes: readonly string[];
};

type RunsRuntimeDiagnostics = {
  readonly workflow_session: RunsWorkflowSessionSummary;
  readonly workflow_lifecycle: RunsWorkflowLifecycleSummary;
  readonly provider: RunsProviderSummary | null;
  readonly model_usage: RunsModelUsageSummary;
  readonly runtime_tools: readonly RunsRuntimeToolSummary[];
};

type RunsJobRun = {
  readonly id: number;
  readonly job_type: string;
  readonly status: string;
  readonly progress: Record<string, unknown>;
  readonly checkpoint: Record<string, unknown> | null;
  readonly model_runs: readonly RunsModelRunSummary[];
  readonly runtime_diagnostics: RunsRuntimeDiagnostics;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type RuntimeToolReferences = {
  readonly page_refs: readonly string[];
  readonly api_paths: readonly string[];
  readonly workflow_nodes: readonly string[];
};

type RuntimeTool = {
  readonly name: string;
  readonly domain: string;
  readonly input_schema: Record<string, unknown>;
  readonly output_schema: Record<string, unknown>;
  readonly required_capabilities: readonly string[];
  readonly evidence_fields: readonly string[];
  readonly references: RuntimeToolReferences;
};

type RunsJobRunState =
  | { readonly status: "ready"; readonly jobRun: RunsJobRun }
  | { readonly status: "error"; readonly message: string };

type RuntimeToolsState =
  | { readonly status: "ready"; readonly runtimeTools: readonly RuntimeTool[] }
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
const runtimeToolsEndpoint = "/api/runtime-tools";

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

async function readRuntimeTools(): Promise<RuntimeToolsState> {
  const result = await readJson<RuntimeTool[]>(runtimeToolsEndpoint, {
    validate: isRuntimeToolList,
    invalidMessage: "运行时工具 API 返回格式不符合预期",
  });
  return result.status === "ready"
    ? { status: "ready", runtimeTools: result.data }
    : { status: "error", message: result.message.replace("API 返回", "运行时工具 API 返回") };
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
    isRunsRuntimeDiagnostics(candidate.runtime_diagnostics) &&
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

function isRunsRuntimeDiagnostics(value: unknown): value is RunsRuntimeDiagnostics {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRunsWorkflowSessionSummary(value.workflow_session) &&
    isRunsWorkflowLifecycleSummary(value.workflow_lifecycle) &&
    (isRunsProviderSummary(value.provider) || value.provider === null) &&
    isRunsModelUsageSummary(value.model_usage) &&
    Array.isArray(value.runtime_tools) &&
    value.runtime_tools.every(isRunsRuntimeToolSummary)
  );
}

function isRunsWorkflowSessionSummary(value: unknown): value is RunsWorkflowSessionSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (typeof value.session_id === "string" || value.session_id === null) &&
    (typeof value.thread_id === "string" || value.thread_id === null) &&
    typeof value.job_run_id === "string" &&
    typeof value.status === "string" &&
    typeof value.current_node === "string" &&
    (typeof value.approval_status === "string" || value.approval_status === null) &&
    (typeof value.last_heartbeat_ms === "number" || value.last_heartbeat_ms === null) &&
    typeof value.prompt_count === "number"
  );
}

function isRunsWorkflowLifecycleSummary(value: unknown): value is RunsWorkflowLifecycleSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.status === "string" &&
    typeof value.current_node === "string" &&
    typeof value.message === "string" &&
    (typeof value.failure_kind === "string" || value.failure_kind === null) &&
    (typeof value.recoverable === "boolean" || value.recoverable === null)
  );
}

function isRunsProviderSummary(value: unknown): value is RunsProviderSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.provider_name === "string" &&
    typeof value.model_name === "string" &&
    typeof value.capability === "string" &&
    typeof value.status === "string" &&
    typeof value.latency_ms === "number" &&
    typeof value.token_usage === "number" &&
    (typeof value.error_message === "string" || value.error_message === null)
  );
}

function isRunsModelUsageSummary(value: unknown): value is RunsModelUsageSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.model_run_count === "number" &&
    typeof value.failed_model_run_count === "number" &&
    typeof value.total_token_usage === "number" &&
    typeof value.max_latency_ms === "number"
  );
}

function isRunsRuntimeToolSummary(value: unknown): value is RunsRuntimeToolSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === "string" &&
    typeof value.domain === "string" &&
    isStringList(value.required_capabilities) &&
    isStringList(value.evidence_fields) &&
    isStringList(value.workflow_nodes)
  );
}

function isRuntimeToolList(value: unknown): value is RuntimeTool[] {
  return Array.isArray(value) && value.every(isRuntimeTool);
}

function isRuntimeTool(value: unknown): value is RuntimeTool {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === "string" &&
    typeof value.domain === "string" &&
    isRecord(value.input_schema) &&
    isRecord(value.output_schema) &&
    isStringList(value.required_capabilities) &&
    isStringList(value.evidence_fields) &&
    isRuntimeToolReferences(value.references)
  );
}

function isRuntimeToolReferences(value: unknown): value is RuntimeToolReferences {
  if (!isRecord(value)) {
    return false;
  }
  return isStringList(value.page_refs) && isStringList(value.api_paths) && isStringList(value.workflow_nodes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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

function formatRecoverable(recoverable: boolean | null): string {
  if (recoverable === true) {
    return "可恢复";
  }
  if (recoverable === false) {
    return "不可恢复";
  }
  return "暂无可恢复性判断";
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
  const [jobRunState, runtimeToolsState] = await Promise.all([readRunsJobRun(jobRunId), readRuntimeTools()]);

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
      <section aria-labelledby="runs-runtime-tools-title">
        <h2 id="runs-runtime-tools-title">运行时工具能力摘要</h2>
        <p>本摘要读取 {runtimeToolsEndpoint}，由 API 从 CreativeToolRegistry 序列化，不在 Web 维护重复工具清单。</p>
        {runtimeToolsState.status === "error" ? (
          <p role="status">可重试错误摘要：{runtimeToolsState.message}</p>
        ) : (
          <ul>
            {runtimeToolsState.runtimeTools.map((tool) => (
              <li key={tool.name}>
                <strong>{tool.name}</strong>
                <span>Domain：{tool.domain}</span>
                <span>
                  所需能力：
                  {tool.required_capabilities.length === 0 ? "无额外运行时能力" : tool.required_capabilities.join("、")}
                </span>
                <span>证据字段：{tool.evidence_fields.length === 0 ? "暂无证据字段" : tool.evidence_fields.join("、")}</span>
                <span>API 契约：{tool.references.api_paths.length === 0 ? "暂无 API 引用" : tool.references.api_paths.join("；")}</span>
              </li>
            ))}
          </ul>
        )}
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
            <section aria-labelledby="runs-runtime-diagnostics-title">
              <h3 id="runs-runtime-diagnostics-title">运行时诊断摘要</h3>
              <dl aria-labelledby="runs-runtime-diagnostics-title">
                <div>
                  <dt>WorkflowSession</dt>
                  <dd>
                    {jobRunState.jobRun.runtime_diagnostics.workflow_session.session_id ?? "暂无 session_id"} /{" "}
                    {jobRunState.jobRun.runtime_diagnostics.workflow_session.status}
                  </dd>
                </div>
                <div>
                  <dt>WorkflowLifecycle</dt>
                  <dd>
                    {jobRunState.jobRun.runtime_diagnostics.workflow_lifecycle.status}，
                    {formatRecoverable(jobRunState.jobRun.runtime_diagnostics.workflow_lifecycle.recoverable)}
                  </dd>
                </div>
                <div>
                  <dt>失败分类 failure_kind</dt>
                  <dd>{jobRunState.jobRun.runtime_diagnostics.workflow_lifecycle.failure_kind ?? "暂无失败分类"}</dd>
                </div>
                <div>
                  <dt>生命周期消息</dt>
                  <dd>{jobRunState.jobRun.runtime_diagnostics.workflow_lifecycle.message}</dd>
                </div>
                <div>
                  <dt>ProviderAdapter 摘要</dt>
                  <dd>
                    {jobRunState.jobRun.runtime_diagnostics.provider === null
                      ? "暂无 provider 调用摘要"
                      : `${jobRunState.jobRun.runtime_diagnostics.provider.provider_name} / ${jobRunState.jobRun.runtime_diagnostics.provider.model_name} / ${jobRunState.jobRun.runtime_diagnostics.provider.capability}`}
                  </dd>
                </div>
                <div>
                  <dt>Token / 延迟聚合</dt>
                  <dd>
                    Token {jobRunState.jobRun.runtime_diagnostics.model_usage.total_token_usage}，最大延迟{" "}
                    {jobRunState.jobRun.runtime_diagnostics.model_usage.max_latency_ms}ms，失败 ModelRun{" "}
                    {jobRunState.jobRun.runtime_diagnostics.model_usage.failed_model_run_count}/
                    {jobRunState.jobRun.runtime_diagnostics.model_usage.model_run_count}
                  </dd>
                </div>
              </dl>
              <section aria-labelledby="runs-runtime-diagnostic-tools-title">
                <h4 id="runs-runtime-diagnostic-tools-title">本次运行涉及的工具能力</h4>
                {jobRunState.jobRun.runtime_diagnostics.runtime_tools.length === 0 ? (
                  <p>空列表：当前运行摘要暂未命中 CreativeToolRegistry 工具能力。</p>
                ) : (
                  <ul>
                    {jobRunState.jobRun.runtime_diagnostics.runtime_tools.map((tool) => (
                      <li key={tool.name}>
                        <strong>{tool.name}</strong>
                        <span>Domain：{tool.domain}</span>
                        <span>
                          所需能力：
                          {tool.required_capabilities.length === 0 ? "无额外运行时能力" : tool.required_capabilities.join("、")}
                        </span>
                        <span>证据字段：{tool.evidence_fields.length === 0 ? "暂无证据字段" : tool.evidence_fields.join("、")}</span>
                        <span>Workflow 节点：{tool.workflow_nodes.length === 0 ? "暂无节点引用" : tool.workflow_nodes.join("、")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </section>
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
