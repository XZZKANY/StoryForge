import { useEffect, useMemo, useState } from 'react';

import {
  buildGraph,
  type BranchManifest,
  type GraphNode,
} from '../../lib/branches';
import { listVersions, readVersion, type VersionEntry } from '../../lib/versions';
import { BranchCanvas } from '../BranchCanvas';

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function VersionHistory({
  projectPath,
  filePath,
  manifest,
  onRestore,
  onCheckoutNode,
  onBranchFromNode,
  onSelectBranch,
  onClose,
}: {
  projectPath: string | null;
  filePath: string;
  manifest: BranchManifest;
  onRestore: (content: string) => void;
  onCheckoutNode: (node: GraphNode) => void;
  onBranchFromNode: (node: GraphNode) => void;
  onSelectBranch: (branchId: string) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'Editor' | 'Agent'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listVersions(projectPath, filePath);
        if (!cancelled) setVersions(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取版本失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, filePath]);

  const restore = async (snapshotPath: string) => {
    setBusy(true);
    try {
      const content = await readVersion(snapshotPath);
      onRestore(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复版本失败');
    } finally {
      setBusy(false);
    }
  };
  const graph = useMemo(() => buildGraph(versions ?? [], manifest), [versions, manifest]);
  const visibleVersions = versions?.filter((version) =>
    sourceFilter === 'all' ? true : version.source === sourceFilter,
  );

  return (
    <div
      className="absolute top-[var(--sf-bar-height)] right-0 bottom-0 w-80 bg-panel border-l border-border flex flex-col shadow-2xl z-30 animate-slide-up-fade"
      data-testid="version-history"
    >
      <div className="sf-panel-header border-border">
        <span className="text-sm font-semibold">版本记录</span>
        <div className="ml-auto flex items-center gap-1" data-testid="version-view-toggle">
          {(['list', 'graph'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`rounded-md px-2 py-1 text-xs ${viewMode === value ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-foreground/10'}`}
              onClick={() => setViewMode(value)}
              data-testid={`version-view-${value}`}
            >
              {value === 'list' ? '列表' : '分支图'}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          title="关闭"
          className="sf-icon-button text-muted transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      {viewMode === 'graph' ? (
        <div className="min-h-0 flex-1">
          {error ? (
            <p className="p-2 text-sm text-error">{error}</p>
          ) : versions === null ? (
            <p className="p-2 text-sm text-muted">加载中...</p>
          ) : (
            <BranchCanvas
              graph={graph}
              activeBranchId={manifest.activeBranchId}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onSelectBranch={onSelectBranch}
              onCheckout={onCheckoutNode}
              onBranchFrom={onBranchFromNode}
              readNodeContent={readVersion}
            />
          )}
        </div>
      ) : (
        <>
          <div
            className="flex flex-shrink-0 gap-1 border-b border-border p-2"
            data-testid="version-source-filter"
          >
            {(['all', 'Editor', 'Agent'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded-md px-2 py-1 text-xs ${sourceFilter === value ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-foreground/10'}`}
                onClick={() => setSourceFilter(value)}
                data-testid={`version-filter-${value}`}
              >
                {value === 'all' ? '全部' : value === 'Editor' ? '手动' : 'Agent'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {error ? (
              <p className="text-sm text-error p-2">{error}</p>
            ) : versions === null ? (
              <p className="text-sm text-muted p-2">加载中...</p>
            ) : visibleVersions?.length === 0 ? (
              <p className="text-sm text-muted p-2">还没有历史版本。保存修改后会自动记录。</p>
            ) : (
              visibleVersions?.map((v) => (
                <div
                  key={v.path}
                  className="rounded-md border border-border bg-surface p-2"
                  data-testid="version-entry"
                  data-version-source={v.source ?? ''}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-xs text-foreground truncate"
                      title={formatTimestamp(v.timestamp)}
                    >
                      {formatTimestamp(v.timestamp)}
                    </span>
                    <button
                      disabled={busy}
                      onClick={() => restore(v.path)}
                      className="text-xs px-2.5 py-1 rounded-md bg-accent text-accent-foreground hover:opacity-90 active:opacity-100 disabled:opacity-40 flex-shrink-0 transition-opacity"
                    >
                      恢复
                    </button>
                  </div>
                  <div
                    className="mt-1 truncate text-[11px] text-muted"
                    title={v.summary ?? v.file ?? ''}
                  >
                    {v.source ? `${v.source} · ` : ''}
                    {v.summary ?? v.file ?? '版本快照'}
                  </div>
                  {(v.patchId || v.assistantSessionId || v.issueIds?.length) && (
                    <div
                      className="mt-1 truncate text-[11px] text-muted"
                      data-testid="version-agent-meta"
                    >
                      {v.patchId ? `patch ${v.patchId}` : ''}
                      {v.assistantSessionId ? ` · session ${v.assistantSessionId}` : ''}
                      {v.issueIds?.length ? ` · ${v.issueIds.join(', ')}` : ''}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
