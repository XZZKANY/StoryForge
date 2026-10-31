import { Button } from './ui';
import { useMemo } from 'react';
import type { AssistantFileSuggestion } from '../lib/assistant-suggestions';
import { isEditableTarget } from '../lib/browser-guards';
import { relativeToProject } from '../lib/project/path';
import {
  buildPatchHunks,
  placePatchHunks,
  type PatchHunk,
  type PlacedPatchHunk,
} from '../lib/patch-hunks';
import { markdownToPlainLine } from '../lib/plain-text';
import {
  actionFailureText,
  buildPatchReviewTraceTitle,
  circledNumber,
  diffStats,
  PATCH_ACTION_LABELS,
  type PatchAction,
} from './editor/patch-review-text';
import { usePatchHunkZones } from './editor/usePatchHunkZones';
import { usePatchDiffEditor } from './editor/usePatchDiffEditor';
import { usePatchReviewActions } from './editor/usePatchReviewActions';
import { usePatchReviewShortcuts } from './editor/usePatchReviewShortcuts';

export { buildPatchReviewTraceTitle } from './editor/patch-review-text';

type PatchReviewPanelProps = {
  suggestion: AssistantFileSuggestion;
  projectPath?: string | null;
  // 接受/拒绝这块 diff 是要逐字核对的决策界面：字号跟随编辑器设置、字体用 CJK 2:1 栈避免中英错位。
  editorFontSize: number;
  editorFontFamily: string;
  actionKind?: PatchAction | null;
  error?: string | null;
  /** 失败时抛出的原错误：按类型判断要不要提示可重试，不看文字。 */
  errorCause?: unknown;
  onAccept: () => void | Promise<void>;
  onAcceptHunk: (hunk: PatchHunk) => void | Promise<void>;
  /** 兑现为 false 表示没否掉（恢复记录写不进去等）：草稿留着。 */
  onReject: (direction: string) => void | Promise<void | boolean>;
  onSaveNote: () => void | Promise<void>;
  onRetryWithoutKnowledge: (knowledgeId: string, relativePath: string) => void | Promise<void>;
  /** 补丁可能没写完、整份接受已武装：「接受」换成「仍然整份接受」，再点一次才写。 */
  truncationArmed?: boolean;
  onCancelTruncatedAccept?: () => void;
};

export function PatchReviewPanel({
  suggestion,
  projectPath = null,
  editorFontSize,
  editorFontFamily,
  onAccept,
  onAcceptHunk,
  onReject,
  onSaveNote,
  onRetryWithoutKnowledge,
  truncationArmed = false,
  onCancelTruncatedAccept,
  actionKind = null,
  error = null,
  errorCause,
}: PatchReviewPanelProps) {
  const actions = usePatchReviewActions({
    suggestion,
    actionKind,
    error,
    errorCause,
    onCancelTruncatedAccept,
  });
  const {
    detailsOpen,
    setDetailsOpen,
    expanded,
    setExpanded,
    setRejection,
    rejectDraft,
    setRejectDraft,
    actionState,
    actionError,
    actionFailure,
    actionInFlightRef,
    panelRef,
    actionBusy,
    runAction,
  } = actions;

  const stats = useMemo(
    () => diffStats(suggestion.before, suggestion.after),
    [suggestion.before, suggestion.after],
  );
  const hunks = useMemo(
    () =>
      suggestion.operationView?.operations ?? buildPatchHunks(suggestion.before, suggestion.after),
    [suggestion.before, suggestion.after, suggestion.operationView],
  );
  const operationConflicts = suggestion.operationView?.conflicts ?? {};
  const hasOperationConflict = Object.keys(operationConflicts).length > 0;
  // 只有一处改动时整份接受就够了，不再逐处给键。
  const placement = useMemo(
    () =>
      hunks.length > 1
        ? placePatchHunks(
            hunks,
            suggestion.before,
            suggestion.after,
            suggestion.operationView?.conflicts,
          )
        : { zones: [], unplaced: [] },
    [hunks, suggestion.before, suggestion.after, suggestion.operationView],
  );
  const lineOrigin = suggestion.operationView ? '原稿' : '';
  const hunkLabel = ({ hunk, index }: PlacedPatchHunk) =>
    `第 ${index + 1} 处 · ${lineOrigin}第 ${hunk.originalStartIndex + 1} 行`;
  const hunkTitle = ({ hunk, index }: PlacedPatchHunk) =>
    `接受第 ${index + 1} 处：${lineOrigin}第 ${hunk.originalStartIndex + 1} 行附近，+${hunk.addedLines} / -${hunk.removedLines}`;
  const traceTitle = useMemo(() => buildPatchReviewTraceTitle(suggestion), [suggestion]);

  // 发出即收起：面板通常随补丁一起消失，但同一实例换下一个补丁时不该还留着上一条草稿。
  const submitRejection = () => {
    if (rejectDraft === null || actionBusy || actionInFlightRef.current) return;
    const direction = rejectDraft;
    const clearSubmittedDraft = () =>
      setRejection((current) =>
        current?.suggestion === suggestion && current.draft === direction ? null : current,
      );
    runAction('reject', () => {
      const result = onReject(direction);
      if (result && typeof result.then === 'function')
        return result.then((rejected) => {
          if (rejected !== false) clearSubmittedDraft();
        });
      clearSubmittedDraft();
    });
  };

  usePatchReviewShortcuts({ suggestion, onAccept, onCancelTruncatedAccept }, actions);

  const { containerRef, diffEditorRef } = usePatchDiffEditor({
    suggestion,
    editorFontSize,
    editorFontFamily,
    expanded,
  });

  // 逐处接受挂在对比区每处改动的正下方（作者试用 #3/#11）；要排在上面同步 model 的 effect 之后，
  // 新补丁的 zone 才按新正文的行号落位。
  const hunkZones = usePatchHunkZones({
    diffEditorRef,
    zones: placement.zones,
    enabled: expanded,
    renderZone: (zone) => (
      <div className="sf-patch-hunk-zone-bar" role="group" aria-label="修订分块操作">
        {zone.hunks.map((placed, position) => (
          <Button
            key={placed.hunk.id}
            type="button"
            onClick={() => runAction('hunk', () => onAcceptHunk(placed.hunk))}
            data-testid="suggestion-accept-hunk"
            disabled={actionBusy || Boolean(operationConflicts[placed.hunk.id])}
            size="compact"
            variant="ghost"
            className="sf-patch-hunk-accept text-2xs"
            title={hunkTitle(placed)}
          >
            接受这处
            {zone.hunks.length > 1 ? ` ${circledNumber(position + 1)}` : ''}
            <span className="sr-only">（{hunkLabel(placed)}）</span>
          </Button>
        ))}
      </div>
    ),
  });

  return (
    <div
      ref={panelRef}
      className={
        expanded
          ? 'absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden bg-panel'
          : 'flex flex-shrink-0 flex-col overflow-hidden border-t border-border bg-panel animate-slide-up-fade'
      }
      data-review-expanded={expanded}
      onKeyDown={(event) => {
        if (
          expanded &&
          event.key === 'Escape' &&
          !event.nativeEvent.isComposing &&
          !isEditableTarget(event.target)
        ) {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
          panelRef.current
            ?.querySelector<HTMLButtonElement>('[data-testid="patch-expand"]')
            ?.focus();
        }
      }}
      data-testid="patch-review"
    >
      {/* AI 的东西用 AI 紫的淡底，和左右两栏分开。 */}
      <div
        className="min-h-0 shrink overflow-y-auto border-b border-agent/30 bg-agent/10"
        data-testid="patch-controls"
      >
        <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-3">
          <div
            className="min-w-0 flex-1 basis-64 break-words"
            title={traceTitle}
            data-testid="patch-trace"
          >
            {/* 一行：标题 · 文件 · 改动数 · 说明；长说明收进下面，免得挡住正文。 */}
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex-shrink-0 text-xs font-semibold text-agent">
                {suggestion.title}
              </span>
              <span
                className="flex min-w-0 items-center gap-2 text-2xs text-muted"
                data-testid="patch-meta"
              >
                <span className="truncate" data-testid="patch-file" title={suggestion.filePath}>
                  {projectPath
                    ? relativeToProject(projectPath, suggestion.filePath)
                    : suggestion.filePath}
                </span>
                <span className="flex-shrink-0" data-testid="patch-stats">
                  +{stats.addedLines} / -{stats.removedLines}
                </span>
              </span>
              <Button
                type="button"
                onClick={() => setDetailsOpen((value) => !value)}
                aria-expanded={detailsOpen}
                data-testid="patch-details-toggle"
                size="xs"
                variant="ghost"
                className="flex-shrink-0 text-2xs"
              >
                {detailsOpen ? '收起说明' : '说明'}
              </Button>
            </div>
            {suggestion.scopeWarning && (
              <p className="mt-1 text-xs text-warning" data-testid="patch-scope-warning">
                ⚠ {suggestion.scopeWarning}
              </p>
            )}
            {suggestion.truncationWarning && (
              <p
                className="mt-1 text-xs font-medium text-error"
                role="alert"
                data-testid="patch-truncation-warning"
              >
                ⚠ {suggestion.truncationWarning}
              </p>
            )}
            {suggestion.lengthHint && (
              <p className="mt-1 text-xs text-warning" data-testid="patch-length-hint">
                {suggestion.lengthHint}
              </p>
            )}
            <div hidden={!detailsOpen} data-testid="patch-details">
              <p className="mt-1 text-xs text-muted">
                {markdownToPlainLine(suggestion.summary) ?? suggestion.summary}
              </p>
            </div>
            {suggestion.knowledgeEntries && suggestion.knowledgeEntries.length > 0 && (
              <div className="mt-2" data-testid="patch-knowledge-context">
                <p className="text-2xs text-muted">本轮实际使用知识</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {suggestion.knowledgeEntries.map((entry) => (
                    <span
                      key={entry.knowledgeId}
                      className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border px-1.5 py-1 text-2xs text-foreground"
                    >
                      <span
                        className="truncate"
                        title={`${entry.relativePath} · ${entry.knowledgeId}`}
                      >
                        {entry.relativePath}
                      </span>
                      <span className="text-muted">
                        {entry.selectionSource === 'author_pinned' ? '已固定' : '相关检索'}
                        {entry.evidenceState === 'stale' ? ' · 来源待复核' : ''}
                      </span>
                      <Button
                        type="button"
                        onClick={() =>
                          runAction('retry', () =>
                            onRetryWithoutKnowledge(entry.knowledgeId, entry.relativePath),
                          )
                        }
                        disabled={actionBusy}
                        size="sm"
                        variant="ghost"
                        className="text-accent"
                        data-testid="patch-knowledge-retry"
                      >
                        移除并重试
                      </Button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div
            className="ml-auto flex max-w-full flex-wrap items-center gap-2"
            role="group"
            aria-label="修订操作"
          >
            <Button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              data-testid="patch-expand"
              aria-expanded={expanded}
              title={`${expanded ? '收起对比 · Esc' : '查看对比'} · Ctrl E`}
              size="xs"
              variant="secondary"
              className="text-xs"
            >
              {expanded ? '收起对比' : '查看对比'}
            </Button>
            {truncationArmed && (
              <span
                role="status"
                className="text-xs font-medium text-error"
                data-testid="patch-truncation-confirm"
              >
                AI 可能没写完：整份接受会删掉原文末尾那几段，再点一次才写
              </span>
            )}
            <Button
              type="button"
              onClick={() => runAction('accept', onAccept)}
              onBlur={truncationArmed ? onCancelTruncatedAccept : undefined}
              onMouseLeave={truncationArmed ? onCancelTruncatedAccept : undefined}
              data-testid="suggestion-accept"
              data-armed={truncationArmed ? 'true' : 'false'}
              title={truncationArmed ? '再点一次才整份写入 · Ctrl Y' : '接受 · Ctrl Y'}
              disabled={actionBusy || hasOperationConflict}
              loading={actionState === 'accept'}
              loadingLabel="接受中"
              size="xs"
              variant={truncationArmed ? 'danger' : 'primary'}
              className="text-xs"
            >
              {truncationArmed ? '仍然整份接受' : '接受'}
            </Button>
            <Button
              type="button"
              onClick={() => runAction('note', onSaveNote)}
              data-testid="suggestion-note"
              disabled={actionBusy}
              loading={actionState === 'note'}
              loadingLabel="保存旁注中"
              size="xs"
              variant="secondary"
              className="text-xs"
            >
              保存旁注
            </Button>
            <Button
              type="button"
              onClick={() => {
                onCancelTruncatedAccept?.();
                setRejectDraft((value) => (value === null ? '' : null));
              }}
              data-testid="suggestion-reject"
              aria-expanded={rejectDraft !== null}
              title="拒绝 · Ctrl N"
              disabled={actionBusy}
              size="xs"
              variant="ghost"
              className="text-xs"
            >
              拒绝
            </Button>
          </div>
        </div>
        {(actionState || actionError) && (
          <div
            className={`border-t border-border px-3 py-1.5 text-2xs ${actionError ? 'text-error' : 'text-accent'}`}
            role="status"
            aria-live="polite"
            data-testid="patch-action-status"
          >
            {actionFailure
              ? actionFailureText(actionFailure.message, actionFailure.cause)
              : `处理中：${PATCH_ACTION_LABELS[actionState!]}`}
          </div>
        )}
        {rejectDraft !== null && (
          <div
            className="flex items-center gap-2 border-t border-border px-3 py-2"
            data-testid="patch-reject-form"
          >
            <input
              autoFocus
              value={rejectDraft}
              onChange={(event) => setRejectDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitRejection();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setRejectDraft(null);
                }
              }}
              data-testid="patch-reject-input"
              aria-label="修改方向（可选）"
              // 问的是「该怎么改」而不是「为什么拒绝」：前者朝向下一版，后者只是归档。
              placeholder="说说该怎么改（回车发出，留空则只否掉这版）"
              className="sf-input min-w-0 flex-1 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-foreground transition-colors placeholder:text-muted"
            />
            <Button
              type="button"
              onClick={submitRejection}
              disabled={actionBusy}
              data-testid="patch-reject-confirm"
              size="sm"
              variant="secondary"
              className="flex-shrink-0 text-xs"
            >
              {rejectDraft.trim() ? '否掉并重来' : '否掉'}
            </Button>
          </div>
        )}
        {hasOperationConflict && (
          <div role="alert" className="border-t border-border px-3 py-2 text-xs text-error">
            原修改区间已变化，无法安全应用；请重新生成修订或手动处理。未定位操作不纳入当前预览。
          </div>
        )}
        {placement.unplaced.length > 0 && (
          // 对比区里认领不到位置的（冲突的、当前稿里找不到唯一对应的）留在横幅这一行。
          <div
            className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap border-t border-agent/20 px-3 py-1 text-2xs text-muted"
            role="group"
            aria-label="修订分块操作"
          >
            <span className="flex-shrink-0">{placement.unplaced.length} 处无法定位</span>
            {placement.unplaced.map((placed) => (
              <Button
                key={placed.hunk.id}
                type="button"
                onClick={() => runAction('hunk', () => onAcceptHunk(placed.hunk))}
                data-testid="suggestion-accept-hunk"
                disabled={actionBusy || Boolean(operationConflicts[placed.hunk.id])}
                size="xs"
                variant="ghost"
                className="flex-shrink-0 text-2xs"
                title={hunkTitle(placed)}
              >
                {hunkLabel(placed)}
              </Button>
            ))}
          </div>
        )}
      </div>
      {/* 收起时只留上面一条操作栏，不在正文下方再劈出半块对比；展开时对比占满剩下的高度。 */}
      <div
        ref={containerRef}
        data-testid="patch-diff"
        className={`sf-patch-diff ${expanded ? 'flex-1' : 'hidden'} min-h-[160px] w-full border-t border-border`}
        hidden={!expanded}
      />
      {hunkZones}
    </div>
  );
}
