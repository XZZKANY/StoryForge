import { useCallback } from 'react';

import { replacePendingFileSuggestion } from '../../lib/assistant-events';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import { deleteCreatedFile } from '../../lib/created-file-delete';
import { projectRemainingSuggestion } from '../../lib/suggestion-change-set';
import { TauriFileSystem } from '../../lib/tauri-fs';
import { canUndoWriteback } from '../../lib/writeback';
import { emitToast } from '../../lib/toast';
import type { WritebackReceipt } from '../../lib/writeback-receipt-types';
import { suggestionOperationStates } from './suggestion-op-state';
import type { GuardedSuggestionWrite } from './useGuardedSuggestionWrite';
import type { SuggestionState, UseSuggestionWritebackParams } from './useSuggestionState';

export function useSuggestionUndo(
  {
    editorRef,
    filePathRef,
    modelCacheRef,
    normalizeEol,
    onRequestVersionHistory,
    projectPathRef,
  }: UseSuggestionWritebackParams,
  {
    mountedRef,
    actionInFlightRef,
    pendingSuggestionRef,
    suggestionOpsRef,
    recoveryEpochRef,
    dropOpenFilePathRef,
    beginAction,
    isCurrentAction,
    finishAction,
    updatePendingSuggestion,
  }: SuggestionState,
  { writeAcceptedSuggestion }: GuardedSuggestionWrite,
) {
  /**
   * 写回成功后弹一条带「撤销」的通知：撤销就是把 previous 再走一遍同一条守卫写回
   * （快照 → 推进分支头 → 写盘 → 记录），所以撤销本身也有独立回执与安全网。
   *
   * 三种情况分开处理，都不留死路：
   *  - 这次写入**创建**了文件 → 撤销是删掉它，不是写回一份空内容（空文件不等于没有这个文件）。
   *  - 文件之后又变了 → 一键撤销确实不能用了（会吃掉新输入），但检查点还躺在
   *    `.storyforge/versions/<file>/checkpoints/` 里，把版本历史开过去即可，不是错误终点。
   *  - 其余 → 原路写回。
   *
   * step：分块连续接受时多个撤销 toast 会并排列着，每条只认自己那一次写回（canUndoWriteback
   * 校验），点旧 toast 只会提示去看版本历史——所以必须在文案里点明撤的是哪一步，
   * 也绝不能写得像「可以从最近一步起逐步全撤」。
   */
  const offerUndo = useCallback(
    (
      suggestion: AssistantFileSuggestion,
      path: string,
      restoreTo: string,
      wrote: string,
      createdFile: boolean,
      operationId: string,
      step?: string,
      previousAcceptedOpIds?: ReadonlySet<string>,
    ) => {
      const projectRoot = projectPathRef.current;
      const targetModel = editorRef.current?.getModel() ?? null;
      const operationState = suggestionOperationStates.get(suggestion);
      let undoAttemptVersion: number | null = null;
      const text = createdFile
        ? '新文件已写入，已留检查点'
        : step
          ? `分块修改已写进文件（${step}），已留检查点`
          : '修订已写进文件，已留检查点';
      const undoLabel = createdFile
        ? '撤销（删除该文件）'
        : step
          ? '撤销这次写入（回到该分块写进文件前）'
          : '撤销';
      emitToast(text, {
        tone: 'success',
        action: {
          label: undoLabel,
          run: async () => {
            if (
              !mountedRef.current ||
              projectPathRef.current !== projectRoot ||
              filePathRef.current !== path ||
              editorRef.current?.getModel() !== targetModel
            ) {
              throw new Error('请返回原文件后撤销；写前检查点仍在版本历史中');
            }
            if (actionInFlightRef.current) throw new Error('修订操作仍在处理中，请稍后撤销');
            const current = editorRef.current?.getValue() ?? null;
            if (current === null || !canUndoWriteback(current, wrote, normalizeEol)) {
              emitToast('文件在此期间又变了，一键撤销会吃掉新内容——检查点仍在版本历史里', {
                tone: 'info',
                action: onRequestVersionHistory
                  ? { label: '打开版本历史', run: () => onRequestVersionHistory() }
                  : undefined,
              });
              return;
            }
            const actionToken = beginAction('undo', pendingSuggestionRef.current ?? suggestion);
            if (!actionToken) throw new Error('修订操作仍在处理中，请稍后撤销');
            const undoOwner = pendingSuggestionRef.current;
            const ownsAction = () => actionInFlightRef.current?.token === actionToken;
            const restoreUndoOperations = (receipt: WritebackReceipt, token: symbol) => {
              const pending = pendingSuggestionRef.current;
              if (
                !isCurrentAction(token) ||
                projectPathRef.current !== projectRoot ||
                filePathRef.current !== path ||
                editorRef.current?.getModel() !== targetModel ||
                !operationState ||
                suggestionOpsRef.current !== operationState ||
                !pending ||
                pending !== undoOwner ||
                receipt.state !== 'applied' ||
                !receipt.receiptPersisted ||
                receipt.current !== 'after'
              )
                return;
              operationState.lastUndoOperationId = receipt.operationId;
              operationState.appliedOpIds.clear();
              for (const id of previousAcceptedOpIds ?? []) operationState.appliedOpIds.add(id);
              const displayedCurrent = editorRef.current?.getValue() ?? restoreTo;
              const projection = projectRemainingSuggestion(
                displayedCurrent,
                operationState.changeSet,
                operationState.appliedOpIds,
              );
              const restored = projection.finished
                ? null
                : {
                    ...pending,
                    before: displayedCurrent,
                    after: projection.after,
                    operationView: projection.view,
                  };
              replacePendingFileSuggestion(pending, restored);
              updatePendingSuggestion(restored);
            };
            // 失败继续拒绝 Promise，让 ToastHost 保留同一个撤销动作以便显式重试。
            try {
              if (createdFile) {
                if (!projectRoot) throw new Error('未打开作品，不能撤销新建');
                const epoch = recoveryEpochRef.current;
                const version = targetModel?.getVersionId?.();
                const targetState = modelCacheRef.current.get(path);
                const disk = await TauriFileSystem.readProjectFile(projectRoot, path);
                // 只撤销本次接受生成的精确正文；编辑器没变不代表外部程序没改盘。
                if (disk !== wrote) throw new Error('磁盘内容已变化，不能撤销新建；请查看版本历史');
                if (
                  !mountedRef.current ||
                  recoveryEpochRef.current !== epoch ||
                  !ownsAction() ||
                  projectPathRef.current !== projectRoot ||
                  filePathRef.current !== path ||
                  editorRef.current?.getModel() !== targetModel ||
                  targetModel?.getVersionId?.() !== version ||
                  !canUndoWriteback(targetModel?.getValue() ?? '', wrote, normalizeEol)
                )
                  throw new Error('文件在核对期间已变化，已取消撤销新建');
                // 此处只阻断已观察到的漂移；删文件、清缓存、计划里退回未写与批量清单上的撤销共用一条路。
                await deleteCreatedFile(projectRoot, path);
                // 删除/计划更新期间仍能输入或切页，只清理未变的原 model；不丢弃后来新稿。
                const canRetireTarget = () =>
                  mountedRef.current &&
                  projectPathRef.current === projectRoot &&
                  targetModel !== null &&
                  modelCacheRef.current.get(path) === targetState &&
                  targetState?.model === targetModel &&
                  !targetModel.isDisposed() &&
                  targetModel.getVersionId?.() === version &&
                  (filePathRef.current !== path || editorRef.current?.getModel() === targetModel);
                if (
                  !canRetireTarget() ||
                  (await TauriFileSystem.projectPathExists(projectRoot, path)) ||
                  !canRetireTarget()
                ) {
                  emitToast('删除已完成；后续内容或页签状态已变化，已保留当前编辑', {
                    tone: 'info',
                  });
                  return;
                }
                // 未改动的原页签须摘掉，避免 autosave 重建；切页后的结算使用最新回调。
                dropOpenFilePathRef.current?.(path);
                emitToast('已撤销，该文件回到「不存在」', { tone: 'success' });
                return;
              }
              undoAttemptVersion ??= targetModel?.getVersionId?.() ?? null;
              const undoRecord = await writeAcceptedSuggestion(
                {
                  ...suggestion,
                  id: `${suggestion.id}-undo`,
                  before: wrote,
                  after: restoreTo,
                },
                path,
                wrote,
                restoreTo,
                {
                  operationKind: `undo:${operationId}`,
                  recoveryOwner: operationState,
                  recoveredSettlementGuard: () =>
                    targetModel !== null &&
                    modelCacheRef.current.get(path)?.model === targetModel &&
                    undoAttemptVersion !== null &&
                    targetModel.getVersionId?.() === undoAttemptVersion,
                  summary: `撤销：${suggestion.summary}`,
                  note: '用户意图：撤销刚写进文件的修订',
                },
              );
              if (undoRecord.warning) {
                const retryAudit = undoRecord.retryAudit;
                emitToast(undoRecord.warning, {
                  tone: 'info',
                  action: retryAudit
                    ? {
                        label: '重试记录（不重写正文）',
                        run: async () => {
                          if (
                            !mountedRef.current ||
                            projectPathRef.current !== projectRoot ||
                            filePathRef.current !== path ||
                            editorRef.current?.getModel() !== targetModel
                          )
                            throw new Error('请返回原文件后补记撤销记录');
                          const retryToken = beginAction(
                            'undo',
                            pendingSuggestionRef.current ?? suggestion,
                          );
                          if (!retryToken) throw new Error('修订操作仍在处理中，请稍后补记');
                          try {
                            await retryAudit((receipt) =>
                              restoreUndoOperations(receipt, retryToken),
                            );
                          } finally {
                            finishAction(retryToken);
                          }
                        },
                      }
                    : undefined,
                });
                return;
              }
              // 正常交付和只补记录共用同一结算；历史回执和迟到完成不授予旧提案权限。
              restoreUndoOperations(undoRecord.receipt, actionToken);
              emitToast('已撤销，文件回到这次写入之前', { tone: 'success' });
            } finally {
              finishAction(actionToken);
            }
          },
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖数组照拆分前原样；漏列的是上层传入、身份不变的 ref / setter
    [
      beginAction,
      editorRef,
      filePathRef,
      finishAction,
      isCurrentAction,
      modelCacheRef,
      normalizeEol,
      onRequestVersionHistory,
      projectPathRef,
      updatePendingSuggestion,
      writeAcceptedSuggestion,
    ],
  );

  return { offerUndo };
}

export type SuggestionUndo = ReturnType<typeof useSuggestionUndo>;
