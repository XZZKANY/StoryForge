export type StoryMemoryFilter = {
  readonly book_id: number;
  readonly entity_type?: string | null;
  readonly entity_id?: string | null;
  readonly fact_type?: string | null;
  readonly chapter?: number | null;
  readonly conflict_status: string;
};

export type StoryMemoryItem = {
  readonly memory_id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly fact_type: string;
  readonly value: string;
  readonly source_ref: string;
  readonly source_chapter_id?: number | null;
  readonly valid_from_chapter: number;
  readonly valid_to_chapter?: number | null;
  readonly confidence: number;
  readonly immutable: boolean;
  readonly revision: number;
  readonly conflict_ids: readonly string[];
};

export type StoryMemoryConflict = {
  readonly conflict_id: string;
  readonly entity_id: string;
  readonly fact_type: string;
  readonly left_memory_id: string;
  readonly right_memory_id: string;
  readonly severity: string;
  readonly reason: string;
  readonly source_refs: readonly string[];
};

export type StoryMemoryResult = {
  readonly filters: StoryMemoryFilter;
  readonly items: readonly StoryMemoryItem[];
  readonly conflict_queue: readonly StoryMemoryConflict[];
  readonly total: number;
  readonly conflicted_count: number;
};

export type StoryMemoryExplorerProps = {
  readonly result?: StoryMemoryResult;
};

const emptyResult: StoryMemoryResult = {
  filters: { book_id: 0, conflict_status: 'all' },
  items: [],
  conflict_queue: [],
  total: 0,
  conflicted_count: 0,
};

export function StoryMemoryExplorer({ result = emptyResult }: StoryMemoryExplorerProps) {
  const filterLabels = filterSummary(result.filters);
  return (
    <section className="space-y-4 rounded-xl border border-stone-800 bg-stone-900 p-4 text-stone-100">
      <header>
        <p className="text-xs uppercase tracking-wide text-stone-400">Story Memory Explorer</p>
        <h2 className="mt-1 text-lg font-semibold">长效记忆</h2>
        <p className="mt-2 text-sm text-stone-300">
          共 {result.total} 条，冲突 {result.conflicted_count} 条。
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs text-stone-300">
        {filterLabels.map((label) => (
          <span key={label} className="rounded bg-stone-800 px-2 py-1">
            {label}
          </span>
        ))}
      </div>

      {result.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-700 p-4 text-sm text-stone-400">
          当前没有匹配的长效记忆
        </p>
      ) : (
        <ul className="space-y-2">
          {result.items.map((item) => (
            <li
              key={item.memory_id}
              className="rounded-lg border border-stone-800 bg-stone-950 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong>{item.entity_id}</strong>
                <span className="rounded bg-stone-800 px-2 py-0.5 text-xs">{item.fact_type}</span>
                <span className="rounded bg-stone-800 px-2 py-0.5 text-xs">{item.memory_id}</span>
                {item.immutable ? (
                  <span className="rounded bg-amber-700 px-2 py-0.5 text-xs">不可变</span>
                ) : null}
              </div>
              <p className="mt-2 text-stone-200">{item.value}</p>
              <p className="mt-1 text-xs text-stone-500">
                {item.source_ref} · 第 {item.valid_from_chapter} 章起
                {item.valid_to_chapter ? ` 至第 ${item.valid_to_chapter} 章` : ''} · confidence{' '}
                {item.confidence}
              </p>
              {item.conflict_ids.length > 0 ? (
                <p className="mt-2 text-xs text-red-300">冲突：{item.conflict_ids.join(', ')}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-lg border border-stone-800 bg-stone-950 p-3">
        <h3 className="text-sm font-semibold">冲突队列</h3>
        {result.conflict_queue.length === 0 ? (
          <p className="mt-2 text-sm text-stone-400">暂无阻塞级冲突。</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {result.conflict_queue.map((conflict) => (
              <li
                key={conflict.conflict_id}
                className="rounded border border-red-900/70 bg-red-950/30 p-2"
              >
                <div className="flex flex-wrap gap-2">
                  <strong>{conflict.conflict_id}</strong>
                  <span>{conflict.severity}</span>
                  <span>{conflict.entity_id}</span>
                  <span>{conflict.fact_type}</span>
                </div>
                <p className="mt-1 text-red-100">{conflict.reason}</p>
                <p className="mt-1 text-xs text-red-200">
                  {conflict.left_memory_id} ↔ {conflict.right_memory_id}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function filterSummary(filters: StoryMemoryFilter): readonly string[] {
  return [
    `book=${filters.book_id}`,
    filters.entity_type ? `entity_type=${filters.entity_type}` : null,
    filters.entity_id ? `entity=${filters.entity_id}` : null,
    filters.fact_type ? `fact_type=${filters.fact_type}` : null,
    filters.chapter ? `chapter=${filters.chapter}` : null,
    `conflict=${filters.conflict_status}`,
  ].filter((label): label is string => label !== null);
}
