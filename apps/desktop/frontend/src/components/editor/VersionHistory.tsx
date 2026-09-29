import { useEffect, useMemo, useState } from 'react';

import { buildGraph, type BranchManifest, type GraphNode } from '../../lib/branches';
import { buildPatchHunks, type PatchHunk } from '../../lib/patch-hunks';
import {
  listVersions,
  readVersionState,
  type VersionEntry,
  type VersionState,
} from '../../lib/versions';
import { PanelError } from '../shell/PanelError';
import { BranchCanvas } from '../BranchCanvas';
import { Clock, X } from '../icons/shell-icons';
import { LiveStatus } from '../shell/LiveStatus';
import { IconButton } from '../ui';

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
  onRestore: (state: VersionState, entry: VersionEntry) => Promise<void> | void;
  onCheckoutNode: (node: GraphNode) => void;
  onBranchFromNode: (node: GraphNode) => void;
  onSelectBranch: (branchId: string) => void;
  onClose: () => void;
  // 列表模式「对比当前」用：返回编辑器实时正文，与选中快照 diff 出 +/- 概要，恢复前不再盲选。
  getCurrentContent?: () => string;
}) {
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 恢复中的条目路径：只有被点的那一行显示「恢复中…」，其余行仅禁用。
  const [busyPath, setBusyPath] = useState<string | null>(null);
  // 「对比当前」读取快照期间的条目路径：防并发点击把预览张冠李戴。
  const [previewLoadingPath, setPreviewLoadingPath] = useState<string | null>(null);
  // 读版本目录失败后的本地重试计数。
  const [retryNonce, setRetryNonce] = useState(0);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'Editor' | 'Agent'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{
    path: string;
    exists: boolean;
    hunks: PatchHunk[];
    added: number;
    removed: number;
  } | null>(null);

  // 「对比当前」：读该快照，与编辑器实时正文 diff（before=当前 → after=此版，即恢复会怎样改）。再点收起。
  const readEntryState = async (entry: VersionEntry): Promise<VersionState> => {
    if (!projectPath) throw new Error('未打开项目，无法读取版本');
    return await readVersionState(projectPath, entry);
  };

  const togglePreview = async (entry: VersionEntry) => {
    if (preview?.path === entry.path) {
      setPreview(null);
      return;
    }
    if (!getCurrentContent || previewLoadingPath) return;
    setPreviewLoadingPath(entry.path);
    try {
      const state = await readEntryState(entry);
      const versionContent = state.exists ? state.content : '';
      const hunks = buildPatchHunks(getCurrentContent(), versionContent);
      const added = hunks.reduce((sum, hunk) => sum + hunk.addedLines, 0);
      const removed = hunks.reduce((sum, hunk) => sum + hunk.removedLines, 0);
      setPreview({ path: entry.path, exists: state.exists, hunks, added, removed });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取版本失败');
    } finally {
      setPreviewLoadingPath(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listVersions(projectPath, filePath);
        if (!cancelled) {
          setVersions(list);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取版本失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, filePath, retryNonce]);

  const retryLoad = () => {
    setError(null);
    setVersions(null);
    setRetryNonce((value) => value + 1);
  };

  const restore = async (entry: VersionEntry) => {
    setBusyPath(entry.path);
    try {
      const state = await readEntryState(entry);
      await onRestore(state, entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复版本失败');
    } finally {
      setBusyPath(null);
    }
  };
  const graph = useMemo(() => buildGraph(versions ?? [], manifest), [versions, manifest]);
  const visibleVersions = versions?.filter((version) =>
    sourceFilter === 'all' ? true : version.source === sourceFilter,
  );
  // 相位级播报：读取中 / 失败 / 读取完成（带条数），空态与有列表同一句恒定文案。
  const liveText = error
    ? '读取版本历史失败'
    : versions === null
      ? '正在读取版本历史…'
      : `版本历史读取完成，共 ${visibleVersions?.length ?? 0} 条。`;

  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-80 bg-panel border-l border-border flex flex-col shadow-panel-lift z-30 animate-slide-up-fade"
      data-testid="version-history"
    >
      <LiveStatus text={liveText} testid="version-history-live" />
      <div className="sf-panel-header">
        <span className="text-sm font-semibold">版本记录</span>
        <div className="ml-auto flex items-center gap-1" data-testid="version-view-toggle">
          {(['list', 'graph'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={viewMode === value}
              className={`rounded-md px-2 py-1 text-xs transition-colors ${viewMode === value ? 'bg-agent/10 text-agent' : 'text-muted hover:bg-elevated'}`}
              onClick={() => setViewMode(value)}
              data-testid={`version-view-${value}`}
            >
              {value === 'list' ? '列表' : '分支图'}
            </button>
          ))}
        </div>
        <IconButton
          label="关闭版本历史"
          tooltip="关闭"
          icon={<X size={15} strokeWidth={1.7} />}
          onClick={onClose}
        />
      </div>
      {viewMode === 'graph' ? (
        <div className="min-h-0 flex-1">
          {error ? (
            <PanelError
              title="读取版本历史失败"
              hint="快照目录 .storyforge/versions 可能不可读；正文本身不受影响。"
              detail={error}
              onRetry={retryLoad}
            />
          ) : versions === null ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-3 text-center"
              data-testid="version-history-loading"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
                <Clock size={20} strokeWidth={1.4} className="text-subtle" aria-hidden="true" />
              </div>
              <p className="text-xs text-subtle">正在读取版本历史…</p>
            </div>
          ) : (
            <BranchCanvas
              graph={graph}
              activeBranchId={manifest.activeBranchId}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onSelectBranch={onSelectBranch}
              onCheckout={onCheckoutNode}
              onBranchFrom={onBranchFromNode}
              readNodeState={(node) => readEntryState(node.version)}
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
                aria-pressed={sourceFilter === value}
                title={value === 'Agent' ? 'Agent 操作产生的快照' : undefined}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${sourceFilter === value ? 'bg-agent/10 text-agent' : 'text-muted hover:bg-elevated'}`}
                onClick={() => setSourceFilter(value)}
                data-testid={`version-filter-${value}`}
              >
                {value === 'all' ? '全部' : value === 'Editor' ? '手动' : 'AI'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {error ? (
              <PanelError
                title="读取版本历史失败"
                hint="快照目录 .storyforge/versions 可能不可读；正文本身不受影响。"
                detail={error}
                onRetry={retryLoad}
              />
            ) : versions === null ? (
              <div
                className="flex h-full flex-col items-center justify-center gap-3 text-center"
                data-testid="version-history-loading"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
                  <Clock size={20} strokeWidth={1.4} className="text-subtle" aria-hidden="true" />
                </div>
                <p className="text-xs text-subtle">正在读取版本历史…</p>
              </div>
            ) : visibleVersions?.length === 0 ? (
              <div
                className="flex h-full flex-col items-center justify-center gap-3 text-center"
                data-testid="version-history-empty"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
                  <Clock size={20} strokeWidth={1.4} className="text-subtle" aria-hidden="true" />
                </div>
                <p className="text-xs text-subtle">还没有历史版本。保存修改后会自动记录。</p>
              </div>
            ) : (
              // Safari 对 list-style:none 的 ul 会丢掉列表语义，显式 role="list" 兜底。
              <ul role="list" className="space-y-1">
                {visibleVersions?.map((v) => (
                  <li
                    key={v.path}
                    className="rounded-md border border-border bg-surface p-2"
                    data-testid="version-entry"
                    data-version-source={v.source ?? ''}
                    data-version-checkpoint={v.checkpoint ? 'true' : 'false'}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="flex min-w-0 items-center gap-1.5 text-xs text-foreground"
                        title={formatTimestamp(v.timestamp)}
                      >
                        <span className="truncate">{formatTimestamp(v.timestamp)}</span>
                        {v.checkpoint && (
                          <span
                            className="flex-shrink-0 rounded-sm border border-border px-1 text-2xs text-muted"
                            title="Agent 动手前的检查点，不会被日常保存挤掉"
                            data-testid="version-checkpoint-badge"
                          >
                            检查点
                          </span>
                        )}
                        {v.created && (
                          <span
                            className="flex-shrink-0 rounded-sm border border-border px-1 text-2xs text-muted"
                            title="此版本之前该文件并不存在；恢复会在确认后删除当前文件"
                            data-testid="version-created-badge"
                          >
                            新建前
                          </span>
                        )}
                      </span>
                      <div className="flex flex-shrink-0 items-center gap-1.5">
                        {getCurrentContent && (
                          <button
                            disabled={!!v.unavailableReason || previewLoadingPath !== null}
                            onClick={() => void togglePreview(v)}
                            title="与编辑器当前内容对比"
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
                            data-testid="version-preview-toggle"
                          >
                            {previewLoadingPath === v.path
                              ? '读取中…'
                              : preview?.path === v.path
                                ? '收起'
                                : '对比当前'}
                          </button>
                        )}
                        <button
                          disabled={busyPath !== null || !!v.unavailableReason}
                          aria-busy={busyPath === v.path || undefined}
                          onClick={() => void restore(v)}
                          className="interactive-press rounded-md bg-agent px-2.5 py-1 text-xs text-agent-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyPath === v.path ? '恢复中…' : v.created ? '恢复为不存在' : '恢复'}
                        </button>
                      </div>
                    </div>
                    <div
                      className="mt-1 truncate text-2xs text-muted"
                      title={v.summary ?? v.file ?? ''}
                    >
                      {v.source ? `${v.source} · ` : ''}
                      {v.summary ?? v.file ?? '版本快照'}
                    </div>
                    {v.unavailableReason && (
                      <div className="mt-1 text-2xs text-error" data-testid="version-unavailable">
                        {v.unavailableReason}
                      </div>
                    )}
                    {(v.patchId || v.assistantSessionId || v.issueIds?.length) && (
                      <div
                        className="mt-1 truncate text-2xs text-muted"
                        data-testid="version-agent-meta"
                      >
                        {v.patchId ? `patch ${v.patchId}` : ''}
                        {v.assistantSessionId ? ` · session ${v.assistantSessionId}` : ''}
                        {v.issueIds?.length ? ` · ${v.issueIds.join(', ')}` : ''}
                      </div>
                    )}
                    {preview?.path === v.path && (
                      <div
                        className="mt-2 border-t border-border pt-2"
                        data-testid="version-preview"
                      >
                        <div className="text-2xs text-muted">
                          {!preview.exists ? (
                            '恢复到此版会删除当前文件'
                          ) : preview.hunks.length === 0 ? (
                            '与当前无差异'
                          ) : (
                            <>
                              恢复到此版：
                              <span className="text-success">+{preview.added}</span>
                              {' / '}
                              <span className="text-error">-{preview.removed}</span>
                              {' 行'}
                            </>
                          )}
                        </div>
                        {preview.hunks.length > 0 && (
                          <div className="mt-1 max-h-52 overflow-y-auto rounded-sm border border-border bg-background p-1 font-mono text-2xs leading-5">
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
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
