export type IdePerformanceMetric = {
  readonly name: string;
  readonly durationMs: number;
  readonly measuredAt: string;
};

export type IdePerformanceBaseline = {
  readonly generatedAt: string;
  readonly metrics: readonly IdePerformanceMetric[];
};

export type IdePerformanceBudgets = Readonly<Record<string, number>>;

export type IdePerformanceEvaluation = {
  readonly status: 'pass' | 'fail';
  readonly violations: readonly {
    readonly name: string;
    readonly durationMs: number;
    readonly budgetMs: number;
  }[];
};

export const idePerformanceBudgets: IdePerformanceBudgets = {
  '1000 Problems SSR render': 100,
  '10k ChapterEditor SSR render': 600,
  'CommandPalette 100 command filter': 120,
};

function nowIso(): string {
  return new Date().toISOString();
}

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

export function measureIdePerformance(name: string, operation: () => void): IdePerformanceMetric {
  const start = nowMs();
  operation();
  const durationMs = nowMs() - start;
  return { name, durationMs, measuredAt: nowIso() };
}

export function createIdePerformanceBaseline(
  metrics: readonly IdePerformanceMetric[],
): IdePerformanceBaseline {
  return {
    generatedAt: nowIso(),
    metrics: [...metrics],
  };
}

export function evaluateIdePerformanceBaseline(
  baseline: IdePerformanceBaseline,
  budgets: IdePerformanceBudgets,
): IdePerformanceEvaluation {
  const violations = baseline.metrics
    .map((metric) => ({ metric, budgetMs: budgets[metric.name] }))
    .filter((item): item is { metric: IdePerformanceMetric; budgetMs: number } =>
      Number.isFinite(item.budgetMs),
    )
    .filter(({ metric, budgetMs }) => metric.durationMs > budgetMs)
    .map(({ metric, budgetMs }) => ({
      name: metric.name,
      durationMs: metric.durationMs,
      budgetMs,
    }));
  return { status: violations.length === 0 ? 'pass' : 'fail', violations };
}
