import { phase6DataSources } from "../../lib/phase6-data-sources";

type EvaluationRunItem = {
  readonly id: number;
  readonly case_id: number | null;
  readonly workspace_id: number | null;
  readonly book_id: number | null;
  readonly status: string;
  readonly metrics: Record<string, unknown>;
  readonly summary: string;
};

type EvaluationRunListState =
  | { readonly status: "ready"; readonly runs: readonly EvaluationRunItem[] }
  | { readonly status: "error"; readonly message: string };

const evaluationSections = [
  "评测集",
  "运行记录",
  "指标趋势",
  "失败样例",
  "一致性错误率",
  "修复成功率",
  "用户接受率",
  "未回收 open loop",
];

const evaluationRunsEndpoint = "/api/evaluations/runs";

const getEvaluationsApiBaseUrl = () => process.env.STORYFORGE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function readEvaluationRuns(): Promise<EvaluationRunListState> {
  try {
    const response = await fetch(new URL(evaluationRunsEndpoint, getEvaluationsApiBaseUrl()), { cache: "no-store" });
    if (!response.ok) {
      return { status: "error", message: `评测运行 API 返回 ${response.status}` };
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return { status: "error", message: "评测运行 API 返回格式不符合预期" };
    }

    return { status: "ready", runs: payload as EvaluationRunItem[] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { status: "error", message };
  }
}

function formatMetricValue(value: unknown): string {
  return typeof value === "number" ? value.toFixed(4).replace(/\.?0+$/u, "") : "未提供";
}

function formatMetricsSummary(metrics: Record<string, unknown>): string {
  return [
    `一致性错误率 ${formatMetricValue(metrics.consistency_error_rate)}`,
    `修复成功率 ${formatMetricValue(metrics.repair_success_rate)}`,
    `用户接受率 ${formatMetricValue(metrics.user_acceptance_rate)}`,
    `未回收 open loop ${formatMetricValue(metrics.open_loop_count)}`,
  ].join("；");
}

function readFailedSampleCount(metrics: Record<string, unknown>): number {
  const value =
    metrics.failed_sample_count ?? metrics.failed_samples ?? metrics.failure_count ?? metrics.failing_examples;
  return typeof value === "number" ? value : 0;
}

function formatOptionalBookId(bookId: number | null): string {
  return typeof bookId === "number" ? `Book #${bookId}` : "未关联";
}

export default async function EvaluationsPage() {
  const evaluationRunListState = await readEvaluationRuns();

  return (
    <main aria-labelledby="evaluations-title">
      <h1 id="evaluations-title">Evaluation Lab 评测实验面板</h1>
      <p>维护评测集、运行记录、指标趋势和失败样例，为后续模型与 Prompt 策略迭代提供依据。</p>
      <section aria-labelledby="evaluation-sections">
        <h2 id="evaluation-sections">评测指标</h2>
        <ul>
          {evaluationSections.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="evaluation-runs-live-data-title">
        <h2 id="evaluation-runs-live-data-title">评测运行真实读取</h2>
        <p>服务端实时读取 {evaluationRunsEndpoint}，展示 evaluation run ID、状态、指标摘要、关联作品和失败样例数量。</p>
        {evaluationRunListState.status === "error" ? (
          <p role="status">可重试错误摘要：{evaluationRunListState.message}。请刷新页面或稍后重试。</p>
        ) : evaluationRunListState.runs.length === 0 ? (
          <p>空列表：当前没有可展示的评测运行记录。</p>
        ) : (
          <ul>
            {evaluationRunListState.runs.map((run) => (
              <li key={run.id}>
                <strong>Evaluation Run #{run.id}</strong>
                <span>状态：{run.status}</span>
                <span>指标摘要：{run.summary || formatMetricsSummary(run.metrics)}</span>
                <span>关联作品：{formatOptionalBookId(run.book_id)}</span>
                <span>失败样例数量：{readFailedSampleCount(run.metrics)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="evaluations-unimplemented-title">
        <h2 id="evaluations-unimplemented-title">未实现边界</h2>
        <p>评测报告下载、指标趋势图和报告详情页仍未实现；当前页面只做只读运行记录展示。</p>
      </section>
      <section aria-labelledby="evaluations-data-sources-title">
        <h2 id="evaluations-data-sources-title">数据源契约</h2>
        <ul>
          {phase6DataSources.evaluations.map((source) => (
            <li key={source.name}>
              <strong>{source.name}</strong>：{source.output}（{source.status}）
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
