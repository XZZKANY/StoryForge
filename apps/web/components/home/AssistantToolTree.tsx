import type { AssistantToolNode } from './assistant-types';

const statusClass = {
  completed: 'border-[#5a725a] bg-[#213022] text-[#bfe3c1]',
  running: 'border-[#b1774d] bg-[#332417] text-[#ffd4b5]',
  waiting: 'border-[#45433e] bg-[#252523] text-[#aaa39a]',
  failed: 'border-[#8c4a4a] bg-[#331e1e] text-[#f4bbbb]',
  needs_approval: 'border-[#7a6ab0] bg-[#29243a] text-[#d8ccff]',
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
      className="!rounded-2xl !border !border-[#373631] !bg-[#20201e] !p-3 !shadow-none md:!p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="assistant-tool-tree-title" className="m-0 text-sm font-semibold text-[#f2e8d8]">
            Assistant 工具流程树
          </h2>
          <p className="m-0 mt-1 text-xs text-[#8f887f]">
            耗时、token、预算和成本只来自真实工具节点。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {['展开全部', '只看当前步骤', '暂停流程', '查看审计'].map((label) => (
            <button
              key={label}
              type="button"
              className="rounded-lg border border-[#4b4943] px-2.5 py-1 text-xs text-[#ddd4c8] hover:border-[#d8cab8]"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ol className="!m-0 mt-4 !grid !gap-3 !p-0">
        {toolNodes.length === 0 ? (
          <li className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
            <div className="rounded-xl border border-[#34332f] bg-[#181817] p-3 text-sm leading-6 text-[#d5ccbf]">
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
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#d96f43]" aria-hidden />
              <div className="min-w-0 flex-1 rounded-xl border border-[#34332f] bg-[#181817] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[#eee4d2]">{node.label}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass[node.status]}`}
                  >
                    {statusLabel[node.status]}
                  </span>
                </div>
                <p className="m-0 mt-1 text-xs text-[#b7afa4]">
                  {node.tool}
                  {node.elapsedLabel ? ` · ${node.elapsedLabel}` : ''}
                  {node.tokenLabel ? ` · ${node.tokenLabel}` : ''}
                  {node.toolUseLabel ? ` · ${node.toolUseLabel}` : ''}
                </p>
                <p className="m-0 mt-2 text-sm leading-6 text-[#d5ccbf]">{node.summary}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
