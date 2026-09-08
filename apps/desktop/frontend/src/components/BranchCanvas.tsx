/**
 * 剧情分支画布（Source Control Graph for Fiction）视图。
 * 展示型组件：把 buildGraph 组好的 DAG 按分支泳道渲染成 git-graph 式列表，
 * 提供查看正文 / 从此开分支 / 与父版本对比。取数与分支清单写盘由 Editor 负责。
 */

import { useRef, useState } from 'react';
import type { BranchGraph, GraphNode } from '../lib/branches';
import { buildPatchHunks } from '../lib/patch-hunks';
import type { VersionState } from '../lib/versions';

type BranchCanvasProps = {
  graph: BranchGraph;
  activeBranchId: string;
  selectedNodeId: number | null;
  onSelectNode: (nodeId: number) => void;
  onSelectBranch: (branchId: string) => void;
  onCheckout: (node: GraphNode) => void;
  onBranchFrom: (node: GraphNode) => void;
  readNodeState: (node: GraphNode) => Promise<VersionState>;
};

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function BranchCanvas({
  graph,
  activeBranchId,
  selectedNodeId,
  onSelectNode,
  onSelectBranch,
  onCheckout,
  onBranchFrom,
  readNodeState,
}: BranchCanvasProps) {
  // 与编辑器历史列表一致：最新在上。
  const nodes = [...graph.nodes].sort((a, b) => b.timestamp - a.timestamp);
  const colorOf = new Map(graph.branches.map((branch) => [branch.id, branch.color]));
  const labelOf = new Map(graph.branches.map((branch) => [branch.id, branch.label]));
  const laneCount = Math.max(
    1,
    ...graph.branches.map((branch) => (graph.laneOf[branch.id] ?? 0) + 1),
  );

  if (nodes.length === 0) {
    return (
      <div
        className="p-4 text-sm text-muted"
        data-testid="branch-canvas-empty"
        role="status"
        aria-live="polite"
      >
        还没有版本节点。保存修改后会自动记录，可在此开分支并比较平行写法。
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="branch-canvas">
      <div
        className="flex flex-wrap gap-1 border-b border-border p-2"
        data-testid="branch-legend"
        role="group"
        aria-label="剧情分支"
      >
        {graph.branches.map((branch) => {
          const active = branch.id === activeBranchId;
          return (
            <button
              key={branch.id}
              type="button"
              onClick={() => onSelectBranch(branch.id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
                active ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-foreground/10'
              }`}
              data-testid="branch-legend-item"
              data-branch-id={branch.id}
              data-branch-active={active ? 'true' : 'false'}
              aria-pressed={active}
              title={active ? '当前活动分支（新保存挂在这里）' : '切换为活动分支'}
            >
              <span
                className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: branch.color }}
              />
              <span className="max-w-[10rem] truncate">{branch.label}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2" role="list" aria-label="版本节点">
        {nodes.map((node) => (
          <BranchNodeRow
            key={node.id}
            node={node}
            laneCount={laneCount}
            color={colorOf.get(node.branchId) ?? '#888888'}
            branchLabel={labelOf.get(node.branchId) ?? node.branchId}
            selected={node.id === selectedNodeId}
            parent={graph.nodes.find((candidate) => candidate.id === node.parentId) ?? null}
            onSelect={() => onSelectNode(node.id)}
            onCheckout={() => onCheckout(node)}
            onBranchFrom={() => onBranchFrom(node)}
            readNodeState={readNodeState}
          />
        ))}
      </div>
    </div>
  );
}

type DiffState = { added: number; removed: number; hunks: number } | 'loading' | 'error' | null;

function BranchNodeRow({
  node,
  laneCount,
  color,
  branchLabel,
  selected,
  parent,
  onSelect,
  onCheckout,
  onBranchFrom,
  readNodeState,
}: {
  node: GraphNode;
  laneCount: number;
  color: string;
  branchLabel: string;
  selected: boolean;
  parent: GraphNode | null;
  onSelect: () => void;
  onCheckout: () => void;
  onBranchFrom: () => void;
  readNodeState: (node: GraphNode) => Promise<VersionState>;
}) {
  const [diff, setDiff] = useState<DiffState>(null);
  const compareRequest = useRef(0);
  const compareBusy = useRef(false);
  const actionsId = `branch-node-actions-${node.id}`;

  const compareWithParent = async () => {
    if (!parent || compareBusy.current) return;
    compareBusy.current = true;
    const requestId = ++compareRequest.current;
    setDiff('loading');
    try {
      const [beforeState, afterState] = await Promise.all([
        readNodeState(parent),
        readNodeState(node),
      ]);
      const before = beforeState.exists ? beforeState.content : '';
      const after = afterState.exists ? afterState.content : '';
      const hunks = buildPatchHunks(before, after);
      if (requestId !== compareRequest.current) return;
      setDiff({
        hunks: hunks.length,
        added: hunks.reduce((sum, hunk) => sum + hunk.addedLines, 0),
        removed: hunks.reduce((sum, hunk) => sum + hunk.removedLines, 0),
      });
    } catch {
      if (requestId !== compareRequest.current) return;
      setDiff('error');
    } finally {
      if (requestId === compareRequest.current) compareBusy.current = false;
    }
  };

  return (
    <div
      className={`rounded-md border p-2 transition-colors ${
        selected ? 'border-accent bg-surface' : 'border-transparent hover:bg-foreground/5'
      }`}
      data-testid="branch-node"
      data-node-id={node.id}
      data-branch-id={node.branchId}
      role="listitem"
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-expanded={selected}
        aria-controls={selected ? actionsId : undefined}
        aria-label={`${formatTimestamp(node.timestamp)}，${branchLabel}，${node.summary ?? '版本快照'}`}
        className="flex w-full items-center gap-2 text-left"
        style={{ paddingLeft: `${(laneCount > 1 ? node.lane : 0) * 14}px` }}
      >
        <span
          className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-background"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 flex-1">
          <span className="block min-w-0 truncate text-xs text-foreground" title={branchLabel}>
            {formatTimestamp(node.timestamp)}
            <span className="ml-2 text-2xs text-muted">{branchLabel}</span>
          </span>
          <span className="block truncate text-2xs text-muted">
            {node.source ? `${node.source} · ` : ''}
            {node.summary ?? '版本快照'}
            {node.patchId ? ` · patch ${node.patchId}` : ''}
          </span>
        </span>
      </button>

      {selected && (
        <div
          id={actionsId}
          role="region"
          aria-label={`${branchLabel} ${formatTimestamp(node.timestamp)} 的操作`}
          className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-1"
        >
          <button
            type="button"
            onClick={onCheckout}
            disabled={!!node.version.unavailableReason}
            className="rounded-md bg-accent px-2 py-1 text-2xs text-accent-foreground hover:opacity-90"
            data-testid="branch-node-checkout"
          >
            恢复到编辑器
          </button>
          <button
            type="button"
            onClick={onBranchFrom}
            disabled={!!node.version.unavailableReason}
            className="rounded-md border border-border px-2 py-1 text-2xs text-foreground hover:bg-foreground/10"
            data-testid="branch-node-fork"
          >
            从此开分支
          </button>
          {parent && (
            <button
              type="button"
              onClick={compareWithParent}
              disabled={diff === 'loading'}
              className="rounded-md border border-border px-2 py-1 text-2xs text-muted hover:bg-foreground/10"
              data-testid="branch-node-compare"
            >
              {diff === 'error' ? '重试对比' : '对比父版本'}
            </button>
          )}
          {node.version.unavailableReason && (
            <span className="text-2xs text-error">{node.version.unavailableReason}</span>
          )}
          {diff === 'loading' && (
            <span className="text-2xs text-muted" role="status" aria-live="polite">
              对比中…
            </span>
          )}
          {diff === 'error' && (
            <span className="text-2xs text-error" role="alert">
              对比失败，请重试
            </span>
          )}
          {diff && diff !== 'loading' && diff !== 'error' && (
            <span
              className="max-w-full break-words text-2xs text-muted"
              data-testid="branch-node-diff-summary"
              role="status"
              aria-live="polite"
            >
              {diff.hunks === 0
                ? '与父版本无差异'
                : `${diff.hunks} 处改动 · +${diff.added} / -${diff.removed} 行`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
