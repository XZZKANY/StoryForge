import { readJson } from '../../lib/api-client';

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
  | { readonly status: 'ready'; readonly runs: readonly EvaluationRunItem[] }
  | { readonly status: 'error'; readonly message: string };

type EvaluationRunDetail = {
  readonly run: EvaluationRunItem;
  readonly trend_points: readonly Record<string, unknown>[];
  readonly failed_sample_count: number;
  readonly studio_feedback_href: string | null;
};

type EvaluationRunDetailState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly detail: EvaluationRunDetail }
  | { readonly status: 'error'; readonly message: string };

type EvaluationFailedSample = {
  readonly id: string;
  readonly reason: string;
  readonly chapter_id: number | null;
  readonly artifact_id: number | null;
  readonly repair_hint: string;
  readonly studio_href: string | null;
};

type EvaluationFailedSampleState =
  | { readonly status: 'idle'; readonly message: string }
  | { readonly status: 'ready'; readonly samples: readonly EvaluationFailedSample[] }
  | { readonly status: 'error'; readonly message: string };

const evaluationSections = [
  '评测集',
  '运行记录',
  '指标趋势',
  '失败样例',
  '一致性错误率',
  '修复成功率',
  '用户接受率',
  '未回收 open loop',
];

const evaluationRunsEndpoint = '/api/evaluations/runs';

async function readEvaluationRuns(): Promise<EvaluationRunListState> {
  const result = await readJson<EvaluationRunItem[]>(evaluationRunsEndpoint, {
    validate: isEvaluationRunItemList,
    invalidMessage: '评测运行 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', runs: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '评测运行 API 返回') };
}

async function readEvaluationRunDetail(
  runId: number | undefined,
): Promise<EvaluationRunDetailState> {
  if (runId === undefined) {
    return { status: 'idle', message: '读取评测详情需要先获得评测运行列表。' };
  }
  const result = await readJson(`${evaluationRunsEndpoint}/${runId}`, {
    validate: isEvaluationRunDetail,
    invalidMessage: '评测详情 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', detail: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '评测详情 API 返回') };
}

async function readEvaluationFailedSamples(
  runId: number | undefined,
): Promise<EvaluationFailedSampleState> {
  if (runId === undefined) {
    return { status: 'idle', message: '读取失败样例需要先获得评测运行列表。' };
  }
  const result = await readJson(`${evaluationRunsEndpoint}/${runId}/failed-samples`, {
    validate: isEvaluationFailedSampleList,
    invalidMessage: '失败样例 API 返回格式不符合预期',
  });
  return result.status === 'ready'
    ? { status: 'ready', samples: result.data }
    : { status: 'error', message: result.message.replace('API 返回', '失败样例 API 返回') };
}

function isEvaluationRunDetail(value: unknown): value is EvaluationRunDetail {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<EvaluationRunDetail>;
  return (
    typeof candidate.run === 'object' &&
    candidate.run !== null &&
    Array.isArray(candidate.trend_points) &&
    typeof candidate.failed_sample_count === 'number' &&
    (typeof candidate.studio_feedback_href === 'string' || candidate.studio_feedback_href === null)
  );
}

function isEvaluationRunItem(value: unknown): value is EvaluationRunItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<EvaluationRunItem>;
  return (
    typeof candidate.id === 'number' &&
    (typeof candidate.case_id === 'number' || candidate.case_id === null) &&
    (typeof candidate.workspace_id === 'number' || candidate.workspace_id === null) &&
    (typeof candidate.book_id === 'number' || candidate.book_id === null) &&
    typeof candidate.status === 'string' &&
    typeof candidate.metrics === 'object' &&
    candidate.metrics !== null &&
    typeof candidate.summary === 'string'
  );
}

function isEvaluationRunItemList(value: unknown): value is EvaluationRunItem[] {
  return Array.isArray(value) && value.every(isEvaluationRunItem);
}

function isEvaluationFailedSample(value: unknown): value is EvaluationFailedSample {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<EvaluationFailedSample>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.reason === 'string' &&
    (typeof candidate.chapter_id === 'number' || candidate.chapter_id === null) &&
    (typeof candidate.artifact_id === 'number' || candidate.artifact_id === null) &&
    typeof candidate.repair_hint === 'string' &&
    (typeof candidate.studio_href === 'string' || candidate.studio_href === null)
  );
}

function isEvaluationFailedSampleList(value: unknown): value is EvaluationFailedSample[] {
  return Array.isArray(value) && value.every(isEvaluationFailedSample);
}

function formatMetricValue(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(4).replace(/\.?0+$/u, '') : '未提供';
}

function formatMetricsSummary(metrics: Record<string, unknown>): string {
  return [
    `一致性错误率 ${formatMetricValue(metrics.consistency_error_rate)}`,
    `修复成功率 ${formatMetricValue(metrics.repair_success_rate)}`,
    `用户接受率 ${formatMetricValue(metrics.user_acceptance_rate)}`,
    `未回收 open loop ${formatMetricValue(metrics.open_loop_count)}`,
  ].join('；');
}

function readFailedSampleCount(metrics: Record<string, unknown>): number {
  const value =
    metrics.failed_sample_count ??
    metrics.failed_samples ??
    metrics.failure_count ??
    metrics.failing_examples;
  return typeof value === 'number' ? value : 0;
}

function formatOptionalBookId(bookId: number | null): string {
  return typeof bookId === 'number' ? `Book #${bookId}` : '未关联';
}

export default async function EvaluationsPage() {
  const evaluationRunListState = await readEvaluationRuns();
  const firstRunId =
    evaluationRunListState.status === 'ready' ? evaluationRunListState.runs[0]?.id : undefined;
  const [evaluationRunDetailState, failedSampleState] = await Promise.all([
    readEvaluationRunDetail(firstRunId),
    readEvaluationFailedSamples(firstRunId),
  ]);

  return (
    <main aria-labelledby="evaluations-title">
      <h1 id="evaluations-title">Evaluations 评测诊断</h1>
      <p>核对评测运行、趋势摘要和失败样例，为后续模型与 Prompt 策略迭代提供证据。</p>
      <section aria-labelledby="evaluations-current-scope-title">
        <h2 id="evaluations-current-scope-title">当前对象 / 当前证据 / 当前动作</h2>
        <dl>
          <dt>当前对象</dt>
          <dd>Evaluation Run 列表中的首个运行记录。</dd>
          <dt>当前证据</dt>
          <dd>趋势摘要点、失败样例数量、失败原因、修复建议和 Studio 反馈入口摘要。</dd>
          <dt>当前动作</dt>
          <dd>核对失败样例、记录反馈入口、回到 Studio 处理可追溯修复。</dd>
          <dt>当前边界</dt>
          <dd>本页只展示已验证的最小闭环。未联通能力不会伪装为可用操作。</dd>
        </dl>
      </section>
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
        <p>
          服务端实时读取 {evaluationRunsEndpoint}，展示 evaluation run
          ID、状态、指标摘要、关联作品和失败样例数量。
        </p>
        {evaluationRunListState.status === 'error' ? (
          <p role="status">
            可重试错误摘要：{evaluationRunListState.message}。请刷新页面或稍后重试。
          </p>
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
        <p>评测报告下载和复杂图表仍未实现；当前页面已读取趋势摘要、失败样例和 Studio 反馈入口。</p>
      </section>
      <section aria-labelledby="evaluation-feedback-title">
        <h2 id="evaluation-feedback-title">失败样例与反馈回流</h2>
        <p>
          服务端读取 {evaluationRunsEndpoint}/{'{run_id}'} 与 {evaluationRunsEndpoint}/{'{run_id}'}
          /failed-samples，展示趋势摘要和回到 Studio 的修复入口。
        </p>
        {evaluationRunDetailState.status === 'idle' ? (
          <p>{evaluationRunDetailState.message}</p>
        ) : evaluationRunDetailState.status === 'error' ? (
          <p role="status">可重试错误摘要：{evaluationRunDetailState.message}</p>
        ) : (
          <dl>
            <dt>趋势摘要点</dt>
            <dd>
              {evaluationRunDetailState.detail.trend_points
                .map((point) => `${String(point.metric)}=${String(point.value)}`)
                .join('；')}
            </dd>
            <dt>失败样例数量</dt>
            <dd>{evaluationRunDetailState.detail.failed_sample_count}</dd>
            <dt>Studio 反馈入口</dt>
            <dd>
              {evaluationRunDetailState.detail.studio_feedback_href ?? '暂无 Studio 反馈入口'}
            </dd>
          </dl>
        )}
        {failedSampleState.status === 'idle' ? (
          <p>{failedSampleState.message}</p>
        ) : failedSampleState.status === 'error' ? (
          <p role="status">可重试错误摘要：{failedSampleState.message}</p>
        ) : failedSampleState.samples.length === 0 ? (
          <p>空列表：当前评测运行暂无失败样例。</p>
        ) : (
          <ul>
            {failedSampleState.samples.map((sample) => (
              <li key={sample.id}>
                <strong>{sample.id}</strong>
                <span>原因：{sample.reason}</span>
                <span>关联章节：{sample.chapter_id ?? '未关联'}</span>
                <span>关联制品：{sample.artifact_id ?? '未关联'}</span>
                <span>修复建议：{sample.repair_hint}</span>
                <span>Studio 入口：{sample.studio_href ?? '暂无入口'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
