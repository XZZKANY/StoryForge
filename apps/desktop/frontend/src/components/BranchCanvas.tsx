/**
 * 剧情分支画布（Source Control Graph for Fiction）视图。
 * 展示型组件：把 buildGraph 组好的 DAG 按分支泳道渲染成 git-graph 式列表，
 * 提供查看正文 / 从此开分支 / 与父版本对比。取数与分支清单写盘由 Editor 负责。
 */

import { useState } from 'react';
import type { BranchGraph, GraphNode } from '../lib/branches';
import { buildPatchHunks } from '../lib/patch-hunks';

type BranchCanvasProps = {
  graph: BranchGraph;
  activeBranchId: string;
  selectedNodeId: number | null;
  onSelectNode: (nodeId: number) => void;
  onSelectBranch: (branchId: string) => void;
  onCheckout: (node: GraphNode) => void;
  onBranchFrom: (node: GraphNode) => void;
  readNodeContent: (path: string) => Promise<string>;
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
  readNodeContent,
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
      <div className="p-4 text-sm text-muted" data-testid="branch-canvas-empty">
        还没有版本节点。保存修改后会自动记录，可在此开分支并比较平行写法。
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="branch-canvas">
      <div className="flex flex-wrap gap-1 border-b border-border p-2" data-testid="branch-legend">
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

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
            readNodeContent={readNodeContent}
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
  readNodeContent,
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
  readNodeContent: (path: string) => Promise<string>;
}) {
  const [diff, setDiff] = useState<DiffState>(null);

  const compareWithParent = async () => {
    if (!parent) return;
    setDiff('loading');
    try {
      const [before, after] = await Promise.all([
        readNodeContent(parent.path),
        readNodeContent(node.path),
      ]);
      const hunks = buildPatchHunks(before, after);
      setDiff({
        hunks: hunks.length,
        added: hunks.reduce((sum, hunk) => sum + hunk.addedLines, 0),
        removed: hunks.reduce((sum, hunk) => sum + hunk.removedLines, 0),
      });
    } catch {
      setDiff('error');
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
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-2 text-left"
        style={{ paddingLeft: `${(laneCount > 1 ? node.lane : 0) * 14}px` }}
      >
        <span
          className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-background"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-foreground">
            {formatTimestamp(node.timestamp)}
            <span className="ml-2 text-[11px] text-muted">{branchLabel}</span>
          </span>
          <span className="block truncate text-[11px] text-muted">
            {node.source ? `${node.source} · ` : ''}
            {node.summary ?? '版本快照'}
            {node.patchId ? ` · patch ${node.patchId}` : ''}
          </span>
        </span>
      </button>

      {selected && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-1">
          <button
            type="button"
            onClick={onCheckout}
            className="rounded-md bg-accent px-2 py-1 text-[11px] text-accent-foreground hover:opacity-90"
            data-testid="branch-node-checkout"
          >
            恢复到编辑器
          </button>
          <button
            type="button"
            onClick={onBranchFrom}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:bg-foreground/10"
            data-testid="branch-node-fork"
          >
            从此开分支
          </button>
          {parent && (
            <button
              type="button"
              onClick={compareWithParent}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:bg-foreground/10"
              data-testid="branch-node-compare"
            >
              对比父版本
            </button>
          )}
          {diff === 'loading' && <span className="text-[11px] text-muted">对比中…</span>}
          {diff === 'error' && <span className="text-[11px] text-error">对比失败</span>}
          {diff && diff !== 'loading' && diff !== 'error' && (
            <span className="text-[11px] text-muted" data-testid="branch-node-diff-summary">
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
