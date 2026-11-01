import { withNativeDelivery } from '../../lib/host/native-delivery';
import { useCallback } from 'react';

import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import { revisionLoopSemanticPayload, type RevisionLoopRecord } from '../../lib/author-loop';
import { isWholeFileDrifted } from '../../lib/patch-hunks';
import type { IssueCounts, IssueResolution } from '../../lib/suggestion-ops';
import { invalidateContextBundleCache } from '../../lib/project-context';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import { TauriFileSystem } from '../../lib/host/tauri-fs';
import { snapshotBeforeWrite } from '../../lib/versions';
import { shouldSettleActiveEditor } from '../../lib/writeback';
import { emitToast } from '../../lib/toast';
import { performReceiptedWriteback } from '../../lib/writeback-receipts';
import type { WritebackReceipt } from '../../lib/writeback-receipt-types';
import {
  forgetPendingSuggestion,
  loadPendingSuggestion,
  recoverSuggestionOperations,
  settleSuggestionRun,
  rememberSuggestionRequest,
} from '../../lib/suggestion-recovery';
import {
  firstChangedLine,
  suggestionOperationStates,
  type SuggestionOpState,
} from './suggestion-op-state';
import type { SuggestionState, UseSuggestionWritebackParams } from './useSuggestionState';

// 写回红线的唯一实现：派生目录只读 → 写前快照 → 推进分支头 → 带回执的原子写 → 版本记录。
// 整份接受、分块接受、撤销与行间对话（Ctrl+K / 续写）都经这里落盘。

export function useGuardedSuggestionWrite(
  {
    advanceBranchHead,
    emitAuthorLoopResult,
    enqueueWriteback,
    cleanVersionIdRef,
    editorRef,
    filePathRef,
    getActiveBranchSnapshot,
    modelCacheRef,
    normalizeEol,
    originalContentRef,
    projectPathRef,
    recordRevisionLoop,
    setIsDirty,
    setLoadedContentPreview,
  }: UseSuggestionWritebackParams,
  { assistantSessionIdRef, mountedRef }: SuggestionState,
) {
  const writeAcceptedSuggestion = useCallback(
    async (
      suggestion: AssistantFileSuggestion,
      path: string,
      previous: string,
      nextContent: string,
      overrides: {
        summary?: string;
        note?: string;
        operationKind?: string;
        issueResolutions?: IssueResolution[];
        issueCounts?: IssueCounts;
        /** false 表示这些问题拿不到行范围；记录里显式写「未归属」，不报 0/N。 */
        issueAttributed?: boolean;
        /** The reverse request belongs to the original live proposal's descriptor slot. */
        recoveryOwner?: SuggestionOpState;
        /** Read from the immutable audit; Native must still prove the exact request applied. */
        recoveredRecord?: RevisionLoopRecord;
        /** 仅同一次活动撤销可同步已查证回执，历史回执不得覆盖后来输入。 */
        recoveredSettlementGuard?: () => boolean;
      } = {},
    ) => {
      const projectRoot = projectPathRef.current;
      if (!projectRoot) throw new Error('未打开作品，不能写入修订结果');
      // 派生缓存由后端重建，写进去下次扫描即被覆盖。saveCurrentFile 一直有这道闸，
      // AI 写回这条路以前漏了；自动档下补丁不再经人眼，漏了就会静默写坏。
      if (isReadOnlyDerivedProjectPath(path)) {
        throw new Error('canon 派生缓存是只读的，不能写入修订结果');
      }
      const targetStateAtStart = modelCacheRef.current.get(path);
      if (!targetStateAtStart) throw new Error('缺少修订目标的磁盘基线，请重新读取后确认');
      const branch = getActiveBranchSnapshot();
      const assistantSessionId = suggestion.assistantSessionId ?? assistantSessionIdRef.current;
      return enqueueWriteback(() =>
        withNativeDelivery(projectRoot, async (deliveryTicket) => {
          // 写前快照那条版本记录：批量写章要把它存进批量记录，撤销一批时用。
          let snapshotPath: string | null = null;
          const expected = targetStateAtStart.diskBaseline;
          const summary = overrides.summary ?? suggestion.summary;
          const note = overrides.note ?? suggestion.note;
          const changeSet = suggestionOperationStates.get(suggestion)?.changeSet;
          const contentChanged = expected.kind === 'missing' || expected.content !== nextContent;
          // 这次写入是不是「凭空建出这个文件」。撤销一次新建要删文件而不是写回空串，
          // 否则盘上会留一个空文件，看着像回退了其实没有。
          const request = {
            operationKey: `${suggestion.id}:${overrides.operationKind ?? 'whole'}`,
            source: JSON.stringify([
              suggestion.id,
              changeSet?.before ?? suggestion.before,
              changeSet?.after ?? suggestion.after,
              suggestion.runId ?? null,
            ]),
            path,
            content: nextContent,
          };
          const record: RevisionLoopRecord = overrides.recoveredRecord ?? {
            projectPath: projectRoot,
            filePath: path,
            before: suggestion.before,
            after: nextContent,
            summary,
            note,
            userIntent: note.split('\n')[0]?.replace(/^用户意图：/, '') ?? '审查并改进当前文件',
            assistantSessionId,
            patchId: suggestion.id,
            issueIds: suggestion.issueIds,
            issueResolutions: overrides.issueResolutions,
            issueCounts: overrides.issueCounts,
            issueAttributed: overrides.issueAttributed,
            contextFiles: suggestion.contextFiles,
          };
          const recordReceipt = (receipt: WritebackReceipt, ticket = deliveryTicket) =>
            recordRevisionLoop({
              ...record,
              retainRecoveryPayload: true,
              operationId: receipt.operationId,
              deliveryTicket: ticket,
            });
          // F27：快照失败必须阻断写回。snapshot 抛错时 performGuardedWriteback 直接向上传播，
          // writeFile 不执行——绝不在没有版本安全网时落盘。
          const loopRecord = await performReceiptedWriteback(contentChanged, {
            inspect: () => TauriFileSystem.inspectWritebackReceipt(projectRoot, request),
            repairCaches: () => TauriFileSystem.repairWritebackCanonCache(projectRoot, request),
            validate: () => {
              if (overrides.recoveredRecord)
                throw new Error('原写入回执缺失，结果未知；审计记录不能授权再次写入');
              if (
                !overrides.operationKind &&
                isWholeFileDrifted(previous, suggestion.before, normalizeEol)
              ) {
                throw new Error(
                  '当前文件内容已变化，旧修订不能直接写进文件。请重新生成修订，或手动处理冲突。',
                );
              }
            },
            snapshot: async () => {
              const result = await snapshotBeforeWrite(
                projectRoot,
                path,
                previous,
                {
                  source: 'Agent',
                  summary,
                  patchId: suggestion.id,
                  assistantSessionId,
                  issueIds: suggestion.issueIds,
                  contextFiles: suggestion.contextFiles,
                  branchId: branch.id,
                  branchLabel: branch.label,
                  parentId: branch.headNodeId,
                  runId: suggestion.runId,
                  // AI 写回仍归入 checkpoints/，用于版本 UI 区分“Agent 动手前”节点；
                  // 长期保留由影子 Git 专用 ref 负责，不再与 autosave 竞争 20 条配额。
                  checkpoint: true,
                },
                deliveryTicket,
              );
              snapshotPath = result?.path ?? null;
              return result;
            },
            advanceBranchHead: async (timestamp) => {
              await advanceBranchHead(timestamp, {
                projectPath: projectRoot,
                filePath: path,
                branchId: branch.id,
                deliveryTicket,
              });
            },
            write: async (checkpointTimestamp) => {
              const owner = overrides.recoveryOwner ?? suggestionOperationStates.get(suggestion);
              if (owner) {
                if (!owner.recovery || owner.recovery.projectPath !== projectRoot)
                  throw new Error('原提案恢复信息未保存，没有写进文件；请重新生成修订');
                await owner.recovery.ready;
                await rememberSuggestionRequest(
                  projectRoot,
                  owner.recovery.descriptor,
                  request,
                  revisionLoopSemanticPayload(record),
                  deliveryTicket,
                );
              }
              return TauriFileSystem.writeFileWithReceipt(
                projectRoot,
                request,
                expected,
                checkpointTimestamp,
                deliveryTicket,
              ).then((receipt) => {
                // C10：写回成功即失效 context bundle 缓存，30 秒 TTL 内不得把旧摘录发给后端。
                invalidateContextBundleCache(projectRoot);
                return receipt;
              });
            },
            settle: (restored) => {
              if (modelCacheRef.current.get(path) === targetStateAtStart)
                targetStateAtStart.diskBaseline = { kind: 'content', content: nextContent };
              // 红线：写回期间作者可能切走页签，绝不能把本文件内容灌进当前活动缓冲
              // （旧代码无条件 editorRef.setValue，A 文件内容会落进 B 缓冲并被 autosave 写盘）。
              // 盘上已落，故按「目标 model」结算而非「当前活动 model」结算：
              // 目标缓冲永远同步（切回来看到的就是已写回的内容），活动编辑器 UI 态只在目标仍在前台时动。
              const targetState = modelCacheRef.current.get(path) ?? null;
              const retainedTarget = targetState && targetState === targetStateAtStart;
              let replaced = false;
              if (retainedTarget) {
                targetState.originalContent = nextContent;
                // Never replace typing that happened while snapshot/write/record awaited.
                if (
                  (!restored || overrides.recoveredSettlementGuard?.()) &&
                  normalizeEol(targetState.model.getValue()) === normalizeEol(previous)
                ) {
                  targetState.model.setValue(nextContent);
                  replaced = true;
                }
              }
              const targetStillActive = shouldSettleActiveEditor(
                path,
                retainedTarget ? targetState.model : null,
                filePathRef.current,
                editorRef.current?.getModel() ?? null,
              );
              if (
                mountedRef.current &&
                projectPathRef.current === projectRoot &&
                targetStillActive
              ) {
                originalContentRef.current = nextContent;
                // 整篇换内容会把光标和滚动都拉回开头：停到第一处改动，作者接受完就看得到改了什么。
                const changedLine = replaced ? firstChangedLine(previous, nextContent) : null;
                if (changedLine !== null) {
                  editorRef.current?.setPosition?.({ lineNumber: changedLine, column: 1 });
                  editorRef.current?.revealLineInCenter?.(changedLine);
                }
                const currentContent = targetState!.model.getValue();
                const dirty = normalizeEol(currentContent) !== normalizeEol(nextContent);
                cleanVersionIdRef.current = dirty
                  ? null
                  : targetState!.model.getAlternativeVersionId();
                setLoadedContentPreview(currentContent.slice(0, 120));
                setIsDirty(dirty);
              }
            },
            record: recordReceipt,
          });
          if (
            overrides.recoveredRecord &&
            !loopRecord.auditError &&
            loopRecord.receipt.receiptPersisted
          ) {
            const owner = suggestionOperationStates.get(suggestion)?.recovery;
            if (!owner || owner.projectPath !== projectRoot)
              throw new Error('原修订恢复归属缺失，不能结算已写进文件的结果');
            await owner.ready;
            await rememberSuggestionRequest(
              projectRoot,
              owner.descriptor,
              request,
              revisionLoopSemanticPayload(record),
              deliveryTicket,
            );
          }
          const settlementWarning = loopRecord.auditError
            ? `正文已写入，但闭环记录未完成：${loopRecord.auditError}。请重试记录，不要重新应用修订。`
            : !loopRecord.receipt.receiptPersisted
              ? '正文已写入，但结果回执未持久化；已保留操作意图，请核对文件与版本，勿重新应用。'
              : loopRecord.receipt.current === 'unreadable'
                ? '此修订已写入，但当前文件无法读取核对；本次未覆盖编辑器，请核对文件与版本。'
                : loopRecord.receipt.current !== 'after'
                  ? '此修订此前已写入，文件随后又发生变化；本次未覆盖当前文件。'
                  : null;
          const warning = loopRecord.receipt.detail
            ? `${settlementWarning ?? '正文已写入。'} 后续处理提示：${loopRecord.receipt.detail}。请核对作品状态，不要重新应用修订。`
            : settlementWarning;
          const retryCaches =
            loopRecord.receipt.detailKind === 'canon-cache-stale' &&
            loopRecord.receipt.receiptPersisted
              ? async () => {
                  if (projectPathRef.current !== projectRoot)
                    throw new Error('请返回原作品后修复缓存');
                  const repaired = await TauriFileSystem.repairWritebackCanonCache(
                    projectRoot,
                    request,
                  );
                  if (repaired.state !== 'applied' || repaired.detail)
                    throw new Error(repaired.detail ?? '缓存修复结果未确认');
                  emitToast('派生缓存已清理，正文未再次写入', { tone: 'info' });
                }
              : undefined;
          return {
            auditComplete: !loopRecord.auditError && loopRecord.receipt.receiptPersisted,
            receipt: loopRecord.receipt,
            recordPath: loopRecord.record?.recordPath ?? null,
            createdFile: loopRecord.receipt.createdFile,
            snapshotPath,
            warning,
            writebackWarning: warning,
            retryCaches,
            retryAudit:
              loopRecord.auditError && loopRecord.receipt.receiptPersisted
                ? async (onRepaired?: (receipt: WritebackReceipt) => void) => {
                    if (projectPathRef.current !== projectRoot)
                      throw new Error('请返回原作品后补记写入记录');
                    const receipt = await TauriFileSystem.inspectWritebackReceipt(
                      projectRoot,
                      request,
                    );
                    if (receipt?.state !== 'applied')
                      throw new Error('写入结果未知，不能自动补记成功记录');
                    await withNativeDelivery(projectRoot, (ticket) =>
                      recordReceipt(receipt, ticket),
                    );
                    if (!onRepaired && suggestion.runId) {
                      const owner = suggestionOperationStates.get(suggestion)?.recovery;
                      const stored = await loadPendingSuggestion(projectRoot, path);
                      if (!owner || !stored || owner.descriptor.owner !== stored.owner)
                        throw new Error('写入记录已补齐，但原恢复归属已变化；请核对原运行');
                      const recovered = await recoverSuggestionOperations(projectRoot, stored);
                      if (
                        recovered.changeSet.operations.every((op) =>
                          recovered.appliedOpIds.has(op.id),
                        )
                      ) {
                        const runStatus = await settleSuggestionRun(projectRoot, stored);
                        await forgetPendingSuggestion(projectRoot, stored);
                        emitAuthorLoopResult({
                          filePath: path,
                          status: 'completed',
                          action: 'revision_accepted',
                          message: retryCaches
                            ? `原写入记录已补齐并结算运行；${loopRecord.receipt.detail}。未再次写入正文`
                            : '原写入记录已补齐并结算运行；未再次写入正文',
                          ...(retryCaches ? { warning: loopRecord.receipt.detail } : {}),
                          runId: suggestion.runId,
                          projectPath: projectRoot,
                          assistantSessionId: suggestion.assistantSessionId,
                          runStatus,
                        });
                      }
                    }
                    if (onRepaired) {
                      const repaired = await TauriFileSystem.inspectWritebackReceipt(
                        projectRoot,
                        request,
                      );
                      if (repaired) onRepaired(repaired);
                    }
                    if (retryCaches) {
                      emitToast(`写入记录已补齐；${loopRecord.receipt.detail}。正文未再次写入。`, {
                        tone: 'info',
                        action: { label: '修复缓存（不重写正文）', run: retryCaches },
                      });
                    } else {
                      emitToast('写入记录已补齐；未再次写入正文', { tone: 'success' });
                    }
                  }
                : null,
            recovered: loopRecord.recovered,
          };
        }),
      );
    },
    [
      advanceBranchHead,
      emitAuthorLoopResult,
      enqueueWriteback,
      cleanVersionIdRef,
      editorRef,
      filePathRef,
      getActiveBranchSnapshot,
      modelCacheRef,
      normalizeEol,
      originalContentRef,
      projectPathRef,
      recordRevisionLoop,
      setIsDirty,
      setLoadedContentPreview,
      assistantSessionIdRef,
      mountedRef,
    ],
  );

  return { writeAcceptedSuggestion };
}

export type GuardedSuggestionWrite = ReturnType<typeof useGuardedSuggestionWrite>;
