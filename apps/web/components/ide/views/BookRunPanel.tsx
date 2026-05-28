export type BookRunPanelRun = {
  readonly id: number;
  readonly status: string;
  readonly current_chapter_index: number;
  readonly total_chapters: number;
  readonly token_budget: number | null;
  readonly tokens_used: number;
  readonly elapsed_time_sec: number;
  readonly time_budget_sec: number | null;
  readonly estimated_cost: number;
  readonly checkpoint: readonly Record<string, unknown>[];
  readonly blocked_chapter?: Record<string, unknown> | null;
  readonly provider_fallback?: Record<string, unknown> | null;
};

export type BookRunPanelProps = {
  readonly run?: BookRunPanelRun;
};

const commandLabels = [
  'Start',
  'Pause',
  'Resume',
  'Stop',
  'Retry from checkpoint',
  'Open audit',
] as const;

export function BookRunPanel({ run }: BookRunPanelProps) {
  if (!run) {
    return (
      <section className="space-y-3 rounded-xl border border-stone-800 bg-stone-900 p-4 text-stone-100">
        <header>
          <p className="text-xs uppercase tracking-wide text-stone-400">BookRun Run Panel</p>
          <h2 className="mt-1 text-lg font-semibold">运行控制台</h2>
        </header>
        <p className="rounded-lg border border-dashed border-stone-700 p-4 text-sm text-stone-400">
          当前没有选中的 BookRun
        </p>
        <CommandBar />
      </section>
    );
  }

  const tokenBudgetLabel = run.token_budget === null ? 'unlimited' : String(run.token_budget);
  const remainingTokens =
    run.token_budget === null ? null : Math.max(run.token_budget - run.tokens_used, 0);

  return (
    <section className="space-y-4 rounded-xl border border-stone-800 bg-stone-900 p-4 text-stone-100">
      <header>
        <p className="text-xs uppercase tracking-wide text-stone-400">BookRun Run Panel</p>
        <h2 className="mt-1 text-lg font-semibold">BookRun #{run.id}</h2>
        <p className="mt-2 text-sm text-stone-300">{run.status}</p>
      </header>

      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <Metric label="章节进度" value={`${run.current_chapter_index} / ${run.total_chapters}`} />
        <Metric label="Token 预算" value={`${run.tokens_used} / ${tokenBudgetLabel}`} />
        <Metric
          label="已用时间"
          value={`${run.elapsed_time_sec}s / ${run.time_budget_sec ?? 'unlimited'}s`}
        />
        <Metric label="预估成本" value={`$${run.estimated_cost}`} />
      </dl>

      {remainingTokens === null ? null : (
        <p className="text-xs text-stone-400">tokens remaining {remainingTokens}</p>
      )}

      <section className="rounded-lg border border-stone-800 bg-stone-950 p-3">
        <h3 className="text-sm font-semibold">checkpoint</h3>
        {run.checkpoint.length === 0 ? (
          <p className="mt-2 text-sm text-stone-400">暂无 checkpoint</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm text-stone-300">
            {run.checkpoint.map((item, index) => (
              <li
                key={`checkpoint:${index}`}
                className="rounded border border-stone-800 bg-stone-900 p-2"
              >
                {formatRecord(item)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {run.blocked_chapter ? (
        <section className="rounded-lg border border-red-900/70 bg-red-950/30 p-3 text-sm">
          <h3 className="font-semibold text-red-100">
            blocked chapter {String(run.blocked_chapter.chapter_index ?? 'unknown')}
          </h3>
          <p className="mt-2 text-red-100">{formatRecord(run.blocked_chapter)}</p>
        </section>
      ) : null}

      {run.provider_fallback ? (
        <section className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm">
          <h3 className="font-semibold text-amber-100">provider fallback</h3>
          <p className="mt-2 text-amber-100">{formatRecord(run.provider_fallback)}</p>
        </section>
      ) : null}

      <CommandBar />
    </section>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg bg-stone-950 p-3">
      <dt className="text-stone-400">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

function CommandBar() {
  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950 p-3">
      <p className="text-xs text-stone-400">
        写操作将在 P5 通过 CommandRegistry 接入，当前仅展示审计入口。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {commandLabels.map((label) => (
          <button
            key={label}
            type="button"
            disabled
            className="rounded bg-stone-800 px-2 py-1 text-xs text-stone-300"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function formatRecord(record: Record<string, unknown>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' · ');
}
