import type { AssistantToolNode } from './assistant-types';

const statusClass = {
  completed: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  running: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  waiting: 'border-border bg-panel text-muted',
  failed: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  needs_approval: 'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400',
} as const;

const statusLabel = {
  completed: '已完成',
  running: '运行中',
  waiting: '等待',
  failed: '失败',
  needs_approval: '需要批准',
} as const;

export function AssistantToolTree({
  toolNodes = [],
}: {
  readonly toolNodes?: readonly AssistantToolNode[];
}) {
  return (
    <section
      aria-labelledby="assistant-tool-tree-title"
      className="!rounded-2xl !border !border-border !bg-panel !p-3 !shadow-none md:!p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="assistant-tool-tree-title" className="m-0 text-sm font-semibold text-foreground">
            Assistant 工具流程树
          </h2>
          <p className="m-0 mt-1 text-xs text-muted">
            耗时、token、预算和成本只来自真实工具节点。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {['展开全部', '只看当前步骤', '暂停流程', '查看审计'].map((label) => (
            <button
              key={label}
              type="button"
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground hover:border-foreground/50"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ol className="!m-0 mt-4 !grid !gap-3 !p-0">
        {toolNodes.length === 0 ? (
          <li className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
            <div className="rounded-xl border border-border bg-panel p-3 text-sm leading-6 text-foreground">
              等待真实任务开始后展示 Goal.analyze、Blueprint.create、Chapter.generate、Judge.review
              和 Repair.suggest 等工具状态。
            </div>
          </li>
        ) : null}
        {toolNodes.map((node) => (
          <li
            key={node.id}
            className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none"
            data-tool-status={node.status}
          >
            <div className="flex gap-2 md:gap-3">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
              <div className="min-w-0 flex-1 rounded-xl border border-border bg-panel p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{node.label}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass[node.status]}`}
                  >
                    {statusLabel[node.status]}
                  </span>
                </div>
                <p className="m-0 mt-1 text-xs text-muted">
                  {node.tool}
                  {node.elapsedLabel ? ` · ${node.elapsedLabel}` : ''}
                  {node.tokenLabel ? ` · ${node.tokenLabel}` : ''}
                  {node.toolUseLabel ? ` · ${node.toolUseLabel}` : ''}
                </p>
                <p className="m-0 mt-2 text-sm leading-6 text-foreground">{node.summary}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
