export type ContextBlockRef = {
  readonly block_id: string;
  readonly kind: string;
  readonly source_ref: string;
  readonly token_count: number;
  readonly priority: string;
  readonly reason: string;
  readonly order?: number | null;
};

export type ContextSnapshot = {
  readonly compiled_context_id: string;
  readonly book_id: number;
  readonly chapter_id: number;
  readonly scene_id: number;
  readonly budget: {
    readonly token_budget: number;
    readonly used_tokens: number;
    readonly dropped_tokens: number;
    readonly truncated: boolean;
  };
  readonly injected_blocks: readonly ContextBlockRef[];
  readonly dropped_blocks: readonly ContextBlockRef[];
  readonly debug_summary: readonly string[];
};

export type ContextInspectorEntry = {
  readonly kind: 'model_run' | 'repair' | 'approve' | string;
  readonly label: string;
  readonly href?: string | null;
};

export type ContextInspectorProps = {
  readonly snapshot?: ContextSnapshot;
  readonly evictedAt?: string;
  readonly entries?: readonly ContextInspectorEntry[];
};

export function ContextInspector({ snapshot, evictedAt, entries = [] }: ContextInspectorProps) {
  if (!snapshot) {
    return (
      <section className="rounded-xl border border-amber-700 bg-amber-950/40 p-6 text-amber-100">
        <h2 className="text-xl font-semibold">Context Inspector</h2>
        <p className="mt-3 text-sm">snapshot evicted at {evictedAt ?? 'unknown'}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-stone-800 bg-stone-900 p-6 text-stone-100">
      <header>
        <p className="text-xs uppercase tracking-wide text-stone-400">Context Inspector</p>
        <h2 className="mt-1 text-xl font-semibold">{snapshot.compiled_context_id}</h2>
        <p className="mt-2 text-sm text-stone-300">
          Book #{snapshot.book_id} / Chapter #{snapshot.chapter_id} / Scene #{snapshot.scene_id}
        </p>
      </header>

      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-stone-950 p-3">
          <dt className="text-stone-400">预算</dt>
          <dd className="mt-1 font-semibold">
            {snapshot.budget.used_tokens}/{snapshot.budget.token_budget} tokens
          </dd>
        </div>
        <div className="rounded-lg bg-stone-950 p-3">
          <dt className="text-stone-400">裁剪 tokens</dt>
          <dd className="mt-1 font-semibold">{snapshot.budget.dropped_tokens}</dd>
        </div>
        <div className="rounded-lg bg-stone-950 p-3">
          <dt className="text-stone-400">注入块</dt>
          <dd className="mt-1 font-semibold">注入块 {snapshot.injected_blocks.length}</dd>
        </div>
        <div className="rounded-lg bg-stone-950 p-3">
          <dt className="text-stone-400">裁剪块</dt>
          <dd className="mt-1 font-semibold">裁剪块 {snapshot.dropped_blocks.length}</dd>
        </div>
      </dl>

      <ContextBlockList title="Injected Blocks" blocks={snapshot.injected_blocks} />
      <ContextBlockList title="Dropped Blocks" blocks={snapshot.dropped_blocks} />
      <ContextEntryList compiledContextId={snapshot.compiled_context_id} entries={entries} />

      <section>
        <h3 className="text-sm font-semibold text-stone-200">Debug Summary</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-300">
          {snapshot.debug_summary.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function ContextEntryList({
  compiledContextId,
  entries,
}: {
  readonly compiledContextId: string;
  readonly entries: readonly ContextInspectorEntry[];
}) {
  if (entries.length === 0) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold text-stone-200">来源入口</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {entries.map((entry) => (
          <li
            key={`${entry.kind}:${entry.label}`}
            className="rounded-lg border border-sky-900 bg-sky-950/30 p-3"
            data-context-entry-kind={entry.kind}
            data-compiled-context-id={compiledContextId}
            data-context-entry-href={entry.href ?? undefined}
          >
            {entry.href ? (
              <a href={entry.href} className="text-sky-100">
                {entry.label}
              </a>
            ) : (
              <span className="text-sky-100">{entry.label}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContextBlockList({
  title,
  blocks,
}: {
  readonly title: string;
  readonly blocks: readonly ContextBlockRef[];
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-stone-200">{title}</h3>
      {blocks.length === 0 ? (
        <p className="mt-2 text-sm text-stone-400">无记录</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {blocks.map((block) => (
            <li
              key={`${title}:${block.block_id}`}
              className="rounded-lg border border-stone-800 bg-stone-950 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong>{block.block_id}</strong>
                <span className="rounded bg-stone-800 px-2 py-0.5 text-xs">{block.kind}</span>
                <span className="rounded bg-stone-800 px-2 py-0.5 text-xs">{block.priority}</span>
                {block.order ? (
                  <span className="text-xs text-stone-400">order {block.order}</span>
                ) : null}
              </div>
              <p className="mt-2 text-stone-300">{block.reason}</p>
              <p className="mt-1 text-xs text-stone-500">
                {block.source_ref} · {block.token_count} tokens
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
