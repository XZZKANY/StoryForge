import { useEffect, useMemo, useState } from 'react';

import { buildGraph, type BranchManifest, type GraphNode } from '../../lib/branches';
import { buildPatchHunks, type PatchHunk } from '../../lib/patch-hunks';
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
  getCurrentContent,
}: {
  projectPath: string | null;
  filePath: string;
  manifest: BranchManifest;
  onRestore: (content: string) => void;
  onCheckoutNode: (node: GraphNode) => void;
  onBranchFromNode: (node: GraphNode) => void;
  onSelectBranch: (branchId: string) => void;
  onClose: () => void;
  // 列表模式「对比当前」用：返回编辑器实时正文，与选中快照 diff 出 +/- 概要，恢复前不再盲选。
  getCurrentContent?: () => string;
}) {
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'Editor' | 'Agent'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{
    path: string;
    hunks: PatchHunk[];
    added: number;
    removed: number;
  } | null>(null);

  // 「对比当前」：读该快照，与编辑器实时正文 diff（before=当前 → after=此版，即恢复会怎样改）。再点收起。
  const togglePreview = async (snapshotPath: string) => {
    if (preview?.path === snapshotPath) {
      setPreview(null);
      return;
    }
    if (!getCurrentContent) return;
    try {
      const versionContent = await readVersion(snapshotPath);
      const hunks = buildPatchHunks(getCurrentContent(), versionContent);
      const added = hunks.reduce((sum, hunk) => sum + hunk.addedLines, 0);
      const removed = hunks.reduce((sum, hunk) => sum + hunk.removedLines, 0);
      setPreview({ path: snapshotPath, hunks, added, removed });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取版本失败');
    }
  };

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
      className="absolute top-[var(--sf-bar-height)] right-0 bottom-0 w-80 bg-panel border-l border-border flex flex-col shadow-[var(--shadow-dialog)] z-30 animate-slide-up-fade"
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
          className="sf-icon-button text-muted transition-colors"
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
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {getCurrentContent && (
                        <button
                          onClick={() => void togglePreview(v.path)}
                          className="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
                          data-testid="version-preview-toggle"
                        >
                          {preview?.path === v.path ? '收起' : '对比当前'}
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => restore(v.path)}
                        className="rounded-md bg-accent px-2.5 py-1 text-xs text-accent-foreground transition-opacity hover:opacity-90 active:opacity-100 disabled:opacity-40"
                      >
                        恢复
                      </button>
                    </div>
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
                  {preview?.path === v.path && (
                    <div className="mt-2 border-t border-border pt-2" data-testid="version-preview">
                      <div className="text-[11px] text-muted">
                        {preview.hunks.length === 0
                          ? '与当前无差异'
                          : `恢复到此版：+${preview.added} / -${preview.removed} 行`}
                      </div>
                      {preview.hunks.length > 0 && (
                        <div className="mt-1 max-h-52 overflow-y-auto rounded border border-border bg-background p-1 font-mono text-[11px] leading-5">
                          {preview.hunks.map((hunk) => (
                            <div key={hunk.id} className="mb-1.5">
                              <div className="text-subtle">
                                第 {hunk.originalStartIndex + 1} 行附近
                              </div>
                              {hunk.beforeText && (
                                <div className="whitespace-pre-wrap break-words text-error">
                                  {hunk.beforeText}
                                </div>
                              )}
                              {hunk.afterText && (
                                <div className="whitespace-pre-wrap break-words text-success">
                                  {hunk.afterText}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
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
