import { withNativeDelivery } from '../../lib/native-delivery';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type * as monaco from 'monaco-editor';

import {
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
  APPLY_FILE_SUGGESTION_EVENT,
  REJECT_CURRENT_FILE_SUGGESTION_EVENT,
  SUGGESTION_RESULT_EVENT,
  bufferPendingFileSuggestion,
  emitPatchRejected,
  takePendingFileSuggestion,
  replacePendingFileSuggestion,
  type FileSuggestionTarget,
  type PatchRejection,
  type AuthorLoopResult,
  type SuggestionResult,
} from '../../lib/assistant-events';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import {
  revisionLoopSemanticPayload,
  type RevisionLoopRecord,
  type RevisionLoopResult,
} from '../../lib/author-loop';
import type { BranchInfo } from '../../lib/branches';
import type { EditorModelCache } from './useMonacoEditor';
import { isWholeFileDrifted, type PatchHunk } from '../../lib/patch-hunks';
import {
  associateIssuesToOps,
  hasIssueAttribution,
  planHunkAccept,
  planWholeAccept,
  resolveIssueStatuses,
  summarizeIssueResolutions,
  verifiedAppliedOpIds,
  type IssueCounts,
  type IssueResolution,
} from '../../lib/suggestion-ops';
import {
  createSuggestionChangeSet,
  matchChangeSetOperation,
  projectRemainingSuggestion,
  type SuggestionChangeSet,
} from '../../lib/suggestion-change-set';
import { shouldAutoAcceptSuggestion } from '../../lib/agent-permission';
import { invalidateContextBundleCache } from '../../lib/project-context';
import { isReadOnlyDerivedProjectPath } from '../../lib/project/entry-visibility';
import { markChapterWrittenInPlan, unmarkChapterWrittenInPlan } from '../../lib/serial-plan';
import { TauriFileSystem } from '../../lib/tauri-fs';
import { snapshotBeforeWrite } from '../../lib/versions';
import {
  canUndoWriteback,
  shouldSettleActiveEditor,
  type WritebackQueue,
} from '../../lib/writeback';
import { emitToast } from '../../lib/toast';
import { performReceiptedWriteback } from '../../lib/writeback-receipts';
import type { WritebackReceipt } from '../../lib/writeback-receipt-types';
import {
  capturePendingSuggestion,
  forgetPendingSuggestion,
  loadPendingSuggestion,
  recoverSuggestionOperations,
  rememberSuggestionRequest,
  persistPendingSuggestion,
  type PendingSuggestionDescriptor,
} from '../../lib/suggestion-recovery';
import {
  useExternalWritebackEditor,
  type ExternalWriteOverrides,
} from './useExternalWritebackEditor';

export type SuggestionStatusTone = 'success' | 'error' | 'info';

export type SuggestionActionKind = 'accept' | 'hunk' | 'note' | 'reject' | 'retry' | 'undo';
export type SuggestionActionState = {
  kind: SuggestionActionKind;
  suggestionId: string;
} | null;

type SuggestionOpState = {
  suggestionId: string;
  readonly changeSet: SuggestionChangeSet;
  appliedOpIds: Set<string>;
  /** 原 Native 撤销回执的派生引用，只区分后续作者重选；不是新的写入真值。 */
  lastUndoOperationId: string | null;
  opIssueIds: Map<string, string[]>;
  recovery: {
    projectPath: string;
    descriptor: PendingSuggestionDescriptor;
    ready: Promise<void>;
  } | null;
};

// 原始操作属于补丁对象而非编辑器 lifetime。缓冲/重新领取/重挂载都沿用同一份状态；
// WeakMap 按对象身份隔离同 id 的新提案，补丁释放后可回收，不新增全局强引用队列。
const suggestionOperationStates = new WeakMap<AssistantFileSuggestion, SuggestionOpState>();

function createOperationState(suggestion: AssistantFileSuggestion): SuggestionOpState {
  const changeSet = createSuggestionChangeSet(suggestion.before, suggestion.after);
  return {
    suggestionId: suggestion.id,
    changeSet,
    appliedOpIds: new Set<string>(),
    lastUndoOperationId: null,
    opIssueIds: associateIssuesToOps(changeSet.operations, suggestion.issueScopes ?? []),
    recovery: null,
  };
}

/** 面向作者的归属读数：本次写回解决了几个审稿问题，其余仍 open。 */
function issueResolutionNote(
  resolutions?: IssueResolution[],
  attributed = true,
  counts = resolutions ? summarizeIssueResolutions(resolutions) : undefined,
): string {
  if (!resolutions || resolutions.length === 0) return '';
  // 问题拿不到行范围时不能报 0/N——那会被读成「一个都没解决」，应显式说明无法归属。
  if (!attributed) return ' · 问题未归属（无行范围），本次不作解决计数';
  if (!counts) return '';
  return ` · 问题已解决 ${counts.resolved}/${counts.observed}（作者确认 ${counts.authorConfirmed}）`;
}

type UseSuggestionWritebackParams = {
  enqueueWriteback: WritebackQueue;
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
  originalContentRef: MutableRefObject<string>;
  cleanVersionIdRef: MutableRefObject<number | null>;
  filePathRef: MutableRefObject<string | null>;
  projectPathRef: MutableRefObject<string | null>;
  modelCacheRef: MutableRefObject<EditorModelCache>;
  setLoadedContentPreview: (preview: string) => void;
  setIsDirty: (dirty: boolean) => void;
  normalizeEol: (text: string) => string;
  getActiveBranchSnapshot: () => BranchInfo;
  advanceBranchHead: (
    timestamp: number,
    target?: { projectPath: string; filePath: string; branchId: string; deliveryTicket?: string },
  ) => Promise<void>;
  recordRevisionLoop: (record: RevisionLoopRecord) => Promise<RevisionLoopResult>;
  emitAuthorLoopResult: (result: AuthorLoopResult) => void;
  /** 撤销一次「新建」要连页签一起摘掉，否则 autosave 会把刚删的文件原样写回来。 */
  dropOpenFilePath?: (path: string) => void;
  /** 一键撤销失效时把作者送到版本历史，而不是丢一句错误了事。 */
  onRequestVersionHistory?: () => void;
};

export function useSuggestionWriteback({
  enqueueWriteback,
  editorRef,
  originalContentRef,
  cleanVersionIdRef,
  filePathRef,
  projectPathRef,
  modelCacheRef,
  setLoadedContentPreview,
  setIsDirty,
  normalizeEol,
  getActiveBranchSnapshot,
  advanceBranchHead,
  recordRevisionLoop,
  emitAuthorLoopResult,
  dropOpenFilePath,
  onRequestVersionHistory,
}: UseSuggestionWritebackParams) {
  const [pendingSuggestion, setPendingSuggestion] = useState<AssistantFileSuggestion | null>(null);
  // E15：接受/拒绝/旁注/导出/锚点失效等一次性结果统一走自动消退 toast，不再赖在编辑器顶栏；
  // 顶栏只保留真正持续的态（isReviseLoading）。沿用 setSuggestionStatus 名以少动调用点。
  const setSuggestionStatus = useCallback((text: string, tone: SuggestionStatusTone = 'info') => {
    if (text) emitToast(text, { tone });
  }, []);
  const [isReviseLoading, setIsReviseLoading] = useState(false);
  const assistantSessionIdRef = useRef<number | null>(null);
  const pendingSuggestionRef = useRef<AssistantFileSuggestion | null>(null);
  const actionInFlightRef = useRef<{
    kind: SuggestionActionKind;
    suggestion: AssistantFileSuggestion;
    projectPath: string | null;
    filePath: string | null;
    token: symbol;
  } | null>(null);
  const [actionState, setActionState] = useState<SuggestionActionState>(null);

  const [actionFailure, setActionFailure] = useState<{
    suggestion: AssistantFileSuggestion;
    message: string;
  } | null>(null);
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // T07：整份接受不再写冻结 after，需要记住补丁不可变的原始 op 与已应用集合，才能把
  // 剩余 op 逐处映射到当前稿、范围外一律不动。
  const suggestionOpsRef = useRef<SuggestionOpState | null>(null);
  const recoveryEpochRef = useRef(0);
  const updatePendingSuggestion = useCallback(
    (next: AssistantFileSuggestion | null, options?: { fresh?: boolean }) => {
      if (!next) {
        suggestionOpsRef.current = null;
      } else if (options?.fresh) {
        let state = suggestionOperationStates.get(next);
        if (!state) {
          state = createOperationState(next);
          const project = projectPathRef.current;
          if (project) {
            try {
              const descriptor = capturePendingSuggestion(project, next);
              const ready = enqueueWriteback(() =>
                withNativeDelivery(project, (ticket) =>
                  persistPendingSuggestion(project, descriptor, ticket),
                ),
              );
              state.recovery = {
                projectPath: project,
                descriptor,
                ready,
              };
              void ready.catch((error: unknown) => {
                if (
                  mountedRef.current &&
                  projectPathRef.current === project &&
                  suggestionOpsRef.current === state
                )
                  setSuggestionStatus(
                    `原提案未持久保存，已阻止写回；请重新生成修订：${String(error)}`,
                    'error',
                  );
              });
            } catch (error) {
              setSuggestionStatus(
                `修订恢复信息未保存，写回前请重新生成：${String(error)}`,
                'error',
              );
            }
          }
        }
        suggestionOperationStates.set(next, state);
        suggestionOpsRef.current = state;
      } else if (suggestionOpsRef.current?.suggestionId === next.id) {
        // remaining.before 是展示用当前稿，不得作为下一次领取时的原始提案基线。
        suggestionOperationStates.set(next, suggestionOpsRef.current);
      }
      pendingSuggestionRef.current = next;
      setPendingSuggestion(next);
    },
    [enqueueWriteback, projectPathRef, setSuggestionStatus],
  );

  const beginAction = useCallback(
    (kind: SuggestionActionKind, suggestion: AssistantFileSuggestion) => {
      if (!mountedRef.current || actionInFlightRef.current) return null;
      const token = Symbol(kind);
      actionInFlightRef.current = {
        kind,
        suggestion,
        token,
        projectPath: projectPathRef.current,
        filePath: filePathRef.current,
      };
      setActionFailure(null);
      setActionState({ kind, suggestionId: suggestion.id });
      return token;
    },
    [filePathRef, projectPathRef],
  );

  const isCurrentAction = useCallback(
    (token: symbol) => {
      const action = actionInFlightRef.current;
      return (
        mountedRef.current &&
        action?.token === token &&
        action.suggestion === pendingSuggestionRef.current &&
        action.projectPath === projectPathRef.current &&
        action.filePath === filePathRef.current
      );
    },
    [filePathRef, projectPathRef],
  );

  const failAction = useCallback(
    (token: symbol, message: string) => {
      if (!isCurrentAction(token)) return;
      const action = actionInFlightRef.current;
      if (action) {
        // 失败已就地写进补丁面板状态条（面板此刻必然可见：isCurrentAction 钉住了
        // 同一文件同一补丁），同文案 error toast 是双响，省略。
        setActionFailure({ suggestion: action.suggestion, message });
      } else {
        setSuggestionStatus(message, 'error');
      }
    },
    [isCurrentAction, setSuggestionStatus],
  );

  const finishAction = useCallback((token: symbol) => {
    if (actionInFlightRef.current?.token !== token) return;
    actionInFlightRef.current = null;
    if (mountedRef.current) setActionState(null);
  }, []);

  const resetSuggestionWriteback = useCallback(() => {
    recoveryEpochRef.current += 1;
    // P2c：切走当前文件前把未确认补丁回填缓冲，切回同一文件可重新领取，不静默丢弃。
    const pending = pendingSuggestionRef.current;
    if (pending) bufferPendingFileSuggestion(pending);
    updatePendingSuggestion(null);
    setIsReviseLoading(false);
    // Navigation invalidates UI ownership, not an already authorized write transaction.
  }, [updatePendingSuggestion]);

  useEffect(() => {
    const onSuggestion = (event: Event) => {
      const suggestion = (event as CustomEvent<AssistantFileSuggestion>).detail;
      if (!suggestion || suggestion.filePath !== filePathRef.current) return;
      // 目标文件已打开：直接消费缓冲，避免切换文件后被重复领取。
      takePendingFileSuggestion(suggestion.filePath);
      updatePendingSuggestion(suggestion, { fresh: true });
    };
    window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    return () => {
      window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, onSuggestion);
    };
  }, [filePathRef, updatePendingSuggestion]);

  // 补丁指向的文件刚被（自动）打开时，从缓冲领取等待中的建议。
  const adoptPendingSuggestion = useCallback(
    (path: string | null) => {
      const pending = takePendingFileSuggestion(path);
      if (pending) {
        updatePendingSuggestion(pending, { fresh: true });
      }
    },
    [updatePendingSuggestion],
  );

  // Called after Monaco attaches the loaded target, not during the file loader's earlier setState.
  const recoverPendingSuggestion = useCallback(
    async function recover(path: string | null): Promise<void> {
      const project = projectPathRef.current;
      const targetModel = editorRef.current?.getModel();
      if (
        !project ||
        !path ||
        !targetModel ||
        pendingSuggestionRef.current ||
        modelCacheRef.current.get(path)?.model !== targetModel ||
        actionInFlightRef.current
      )
        return;
      const epoch = ++recoveryEpochRef.current;
      const current = () =>
        mountedRef.current &&
        recoveryEpochRef.current === epoch &&
        projectPathRef.current === project &&
        filePathRef.current === path &&
        editorRef.current?.getModel() === targetModel &&
        !pendingSuggestionRef.current &&
        !actionInFlightRef.current;
      try {
        const descriptor = await loadPendingSuggestion(project, path);
        if (!descriptor) return;
        const recovered = await recoverSuggestionOperations(project, descriptor);
        if ((await loadPendingSuggestion(project, path))?.owner !== descriptor.owner || !current())
          return;
        const displayed = targetModel.getValue();
        const projection = projectRemainingSuggestion(
          displayed,
          recovered.changeSet,
          recovered.appliedOpIds,
        );
        if (projection.finished) {
          await forgetPendingSuggestion(project, descriptor);
          return;
        }
        const restored = {
          ...descriptor.proposal,
          before: displayed,
          after: projection.after,
          requiresConfirmation: true,
          operationView: projection.view,
        };
        suggestionOperationStates.set(restored, {
          suggestionId: restored.id,
          ...recovered,
          opIssueIds: associateIssuesToOps(
            recovered.changeSet.operations,
            restored.issueScopes ?? [],
          ),
          recovery: { projectPath: project, descriptor, ready: Promise.resolve() },
        });
        updatePendingSuggestion(restored, { fresh: true });
        setSuggestionStatus('已核验并恢复待确认修订；只保留原剩余修改，请确认后写回');
      } catch (error) {
        if (!current()) return;
        emitToast(`修订恢复未完成：${error instanceof Error ? error.message : String(error)}`, {
          tone: 'error',
          action: {
            label: '重试核验（不写正文）',
            run: async () => {
              if (current()) await recover(path);
            },
          },
        });
      }
    },
    [
      editorRef,
      filePathRef,
      modelCacheRef,
      projectPathRef,
      setSuggestionStatus,
      updatePendingSuggestion,
    ],
  );

  const forgetSuggestionRecovery = useCallback(
    async (suggestion: AssistantFileSuggestion) => {
      const recovery = suggestionOperationStates.get(suggestion)?.recovery;
      if (!recovery) return;
      try {
        await recovery.ready;
        await enqueueWriteback(() =>
          forgetPendingSuggestion(recovery.projectPath, recovery.descriptor),
        );
      } catch (error) {
        // Cleanup is after the author decision/write. It cannot undo delivery or retain the action lock.
        emitToast(
          `本次处理已完成，但恢复缓存未清理：${String(error)}。重开时请核对原决定，勿重复应用。`,
          {
            tone: 'info',
          },
        );
      }
    },
    [enqueueWriteback],
  );

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
      } & ExternalWriteOverrides = {},
    ) => {
      const projectRoot = projectPathRef.current;
      if (!projectRoot) throw new Error('未打开项目，不能写入修订结果');
      // 派生缓存由后端重建，写进去下次扫描即被覆盖。saveCurrentFile 一直有这道闸，
      // AI 写回这条路以前漏了；自动档下补丁不再经人眼，漏了就会静默写坏。
      if (isReadOnlyDerivedProjectPath(path)) {
        throw new Error('canon 派生缓存是只读的，不能写入修订结果');
      }
      const targetStateAtStart = modelCacheRef.current.get(path);
      if (!targetStateAtStart) throw new Error('缺少补丁目标的磁盘基线，请重新读取后确认');
      overrides.admissionGuard?.();
      const branch = overrides.frozenBranch ?? getActiveBranchSnapshot();
      const assistantSessionId = suggestion.assistantSessionId ?? assistantSessionIdRef.current;
      return enqueueWriteback(() =>
        withNativeDelivery(projectRoot, async (deliveryTicket) => {
          const expected = targetStateAtStart.diskBaseline;
          const summary = overrides.summary ?? suggestion.summary;
          const note = overrides.note ?? suggestion.note;
          const changeSet = suggestionOperationStates.get(suggestion)?.changeSet;
          const contentChanged = expected.kind === 'missing' || expected.content !== nextContent;
          // 这次写入是不是「凭空建出这个文件」。撤销一次新建要删文件而不是写回空串，
          // 否则盘上会留一个空文件，看着像回退了其实没有。
          const request = overrides.externalRequest ?? {
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
          const record: RevisionLoopRecord = {
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
              operationId: receipt.operationId,
              deliveryTicket: ticket,
            });
          // F27：快照失败必须阻断写回。snapshot 抛错时 performGuardedWriteback 直接向上传播，
          // writeFile 不执行——绝不在没有版本安全网时落盘。
          const loopRecord = await performReceiptedWriteback(contentChanged, {
            inspect: () => TauriFileSystem.inspectWritebackReceipt(projectRoot, request),
            validate: () => {
              overrides.admissionGuard?.();
              if (
                !overrides.operationKind &&
                isWholeFileDrifted(previous, suggestion.before, normalizeEol)
              ) {
                throw new Error(
                  '当前文件内容已变化，旧补丁不能直接写回。请重新生成修订，或手动处理冲突。',
                );
              }
            },
            snapshot: async () => {
              overrides.admissionGuard?.();
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
              overrides.admissionGuard?.();
              return result;
            },
            advanceBranchHead: async (timestamp) => {
              overrides.admissionGuard?.();
              await advanceBranchHead(timestamp, {
                projectPath: projectRoot,
                filePath: path,
                branchId: branch.id,
                deliveryTicket,
              });
              overrides.admissionGuard?.();
            },
            write: async (checkpointTimestamp) => {
              await overrides.beforeNativeAdmission?.();
              overrides.admissionGuard?.();
              if (!overrides.externalRequest) {
                const owner = overrides.recoveryOwner ?? suggestionOperationStates.get(suggestion);
                if (owner) {
                  if (!owner.recovery || owner.recovery.projectPath !== projectRoot)
                    throw new Error('原提案恢复信息未保存，已阻止写回；请重新生成修订');
                  await owner.recovery.ready;
                  await rememberSuggestionRequest(
                    projectRoot,
                    owner.recovery.descriptor,
                    request,
                    revisionLoopSemanticPayload(record),
                    deliveryTicket,
                  );
                }
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
              if (retainedTarget) {
                targetState.originalContent = nextContent;
                // Never replace typing that happened while snapshot/write/record awaited.
                if (
                  !restored &&
                  normalizeEol(targetState.model.getValue()) === normalizeEol(previous)
                )
                  targetState.model.setValue(nextContent);
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
          const warning = loopRecord.auditError
            ? `正文已写入，但闭环记录未完成：${loopRecord.auditError}。请重试记录，不要重新应用补丁。`
            : !loopRecord.receipt.receiptPersisted
              ? '正文已写入，但结果回执未持久化；已保留操作意图，请核对文件与版本，勿重新应用。'
              : loopRecord.receipt.current === 'unreadable'
                ? '此补丁已写入，但当前文件无法读取核对；本次未覆盖编辑器，请核对文件与版本。'
                : loopRecord.receipt.current !== 'after'
                  ? '此补丁此前已写入，文件随后又发生变化；本次未覆盖当前文件。'
                  : null;
          return {
            receipt: loopRecord.receipt,
            recordPath: loopRecord.record?.recordPath ?? null,
            createdFile: loopRecord.receipt.createdFile,
            warning,
            writebackWarning: warning,
            retryAudit:
              loopRecord.auditError && loopRecord.receipt.receiptPersisted
                ? async (onRepaired?: (receipt: WritebackReceipt) => void) => {
                    if (projectPathRef.current !== projectRoot)
                      throw new Error('请返回原项目后补记写回记录');
                    const receipt = await TauriFileSystem.inspectWritebackReceipt(
                      projectRoot,
                      request,
                    );
                    if (receipt?.state !== 'applied')
                      throw new Error('写回结果未知，不能自动补记成功记录');
                    await withNativeDelivery(projectRoot, (ticket) =>
                      recordReceipt(receipt, ticket),
                    );
                    if (onRepaired) {
                      const repaired = await TauriFileSystem.inspectWritebackReceipt(
                        projectRoot,
                        request,
                      );
                      if (repaired) onRepaired(repaired);
                    }
                    emitToast('写回记录已补齐；未再次写入正文', { tone: 'success' });
                  }
                : null,
            recovered: loopRecord.recovered,
          };
        }),
      );
    },
    [
      advanceBranchHead,
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
    ],
  );

  const externalIsBusy = useCallback(() => actionInFlightRef.current !== null, []);
  useExternalWritebackEditor({
    projectPathRef,
    filePathRef,
    modelCacheRef,
    mountedRef,
    isBusy: externalIsBusy,
    branch: getActiveBranchSnapshot,
    normalize: normalizeEol,
    write: writeAcceptedSuggestion,
  });

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
      const text = createdFile
        ? '新文件已写入，已留检查点'
        : step
          ? `已写回分块修改（${step}），已留检查点`
          : '修订已写回，已留检查点';
      const undoLabel = createdFile
        ? '撤销（删除该文件）'
        : step
          ? '撤销本次写回（回到该分块写回前）'
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
            if (actionInFlightRef.current) throw new Error('补丁操作仍在处理中，请稍后撤销');
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
            if (!actionToken) throw new Error('补丁操作仍在处理中，请稍后撤销');
            const undoOwner = pendingSuggestionRef.current;
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
            try {
              if (createdFile) {
                if (!projectRoot) throw new Error('未打开项目，不能撤销新建');
                await TauriFileSystem.deletePath(projectRoot, path);
                invalidateContextBundleCache(projectRoot);
                // 正文没了，这章就不再是「写完的」——把接受时标上的 done 退回 pending。
                // 只在这一支做：修订的撤销走下面的反向写回，文件还在，那章依然是写完的。
                await unmarkChapterWrittenInPlan(projectRoot, path);
                // 页签留着的话，开着 autosave 时下一次防抖就会把文件原样写回来。
                dropOpenFilePath?.(path);
                emitToast('已撤销，该文件回到「不存在」', { tone: 'success' });
                return;
              }
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
                  summary: `撤销：${suggestion.summary}`,
                  note: '用户意图：撤销刚写回的修订',
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
                          if (!retryToken) throw new Error('补丁操作仍在处理中，请稍后补记');
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
              emitToast('已撤销，文件回到写回前', { tone: 'success' });
            } catch (err) {
              emitToast(`撤销失败：${err instanceof Error ? err.message : String(err)}`, {
                tone: 'error',
              });
            } finally {
              finishAction(actionToken);
            }
          },
        },
      });
    },
    [
      beginAction,
      dropOpenFilePath,
      editorRef,
      filePathRef,
      finishAction,
      isCurrentAction,
      normalizeEol,
      onRequestVersionHistory,
      projectPathRef,
      updatePendingSuggestion,
      writeAcceptedSuggestion,
    ],
  );

  const handleAcceptSuggestion = useCallback(async () => {
    const suggestion = pendingSuggestionRef.current;
    const path = filePathRef.current;
    if (!suggestion || !path || suggestion.filePath !== path || !editorRef.current) {
      emitAuthorLoopResult({
        filePath: path ?? '',
        status: 'error',
        action: 'revision_accepted',
        message: '当前没有待写回的修订。',
      });
      return;
    }

    const projectRoot = projectPathRef.current;
    const actionToken = beginAction('accept', suggestion);
    if (!actionToken) return;

    try {
      const currentContent = editorRef.current.getValue();
      const opState =
        suggestionOpsRef.current?.suggestionId === suggestion.id
          ? suggestionOpsRef.current
          : createOperationState(suggestion);
      // 已消费的 op 不因作者改回整篇 before 而重新获得权限；无消费历史才允许整篇快路径。
      const plan = planWholeAccept(
        currentContent,
        opState.changeSet.before,
        opState.changeSet.after,
        opState.appliedOpIds,
        normalizeEol,
        opState.changeSet.operations,
      );
      const nextContent = plan.content;
      const opsForIssues = opState.changeSet.operations;
      const settledForIssues = verifiedAppliedOpIds(
        nextContent,
        opState.changeSet.before,
        opsForIssues,
        plan.settledOpIds,
      );
      for (const { op } of plan.applied) settledForIssues.add(op.id);
      const issuesAttributed = hasIssueAttribution(
        suggestion.issueIds ?? [],
        suggestion.issueScopes ?? [],
      );
      const wholeIssueResolutions = suggestion.issueIds?.length
        ? resolveIssueStatuses(
            suggestion.issueIds,
            suggestion.issueScopes ?? [],
            opsForIssues,
            settledForIssues,
          )
        : undefined;
      const wholeIssueCounts = wholeIssueResolutions
        ? summarizeIssueResolutions(
            wholeIssueResolutions,
            resolveIssueStatuses(
              suggestion.issueIds ?? [],
              suggestion.issueScopes ?? [],
              opsForIssues,
              new Set([...opState.appliedOpIds, ...plan.settledOpIds]),
            ),
          )
        : undefined;
      // 无撤销历史沿用 :whole；明确撤销后的重选使用 Native 回执链，不能复用旧 applied。
      // 显式 operationKind 仍让整文件漂移闸让位给逐 op 映射。
      const loopRecord = await writeAcceptedSuggestion(
        suggestion,
        path,
        currentContent,
        nextContent,
        {
          operationKind: opState.lastUndoOperationId
            ? `whole:after-undo:${opState.lastUndoOperationId}`
            : 'whole',
          issueResolutions: wholeIssueResolutions,
          issueCounts: wholeIssueCounts,
          issueAttributed: wholeIssueResolutions ? issuesAttributed : undefined,
        },
      );
      // 正文已落盘，这才轮到连载计划把该章标 done（补丁未确认时后端会拒绝标记）。
      // 刻意只挂在「接受整个补丁」这一层：分块接受与行间对话 Ctrl+K 是段落级微调，
      // 接受一次不等于这章写完了；撤销走的是反向写回，届时正文没了，后端自会拒绝。
      await markChapterWrittenInPlan(projectRoot, path);
      replacePendingFileSuggestion(suggestion, null);
      await forgetSuggestionRecovery(suggestion);
      if (!isCurrentAction(actionToken)) return;
      updatePendingSuggestion(null);
      if (loopRecord.warning) {
        emitToast(loopRecord.warning, {
          tone: 'info',
          action: loopRecord.retryAudit
            ? { label: '重试记录（不重写正文）', run: loopRecord.retryAudit }
            : undefined,
        });
        emitAuthorLoopResult({
          filePath: path,
          status: 'completed',
          action: 'revision_accepted',
          message: loopRecord.warning,
          warning: loopRecord.warning,
        });
        return;
      }
      offerUndo(
        suggestion,
        path,
        currentContent,
        nextContent,
        loopRecord.createdFile,
        loopRecord.receipt.operationId,
      );
      setSuggestionStatus(
        (loopRecord.recordPath
          ? '已写入当前文件 · 已留写前快照与闭环记录，可点通知里的「撤销」一键回退'
          : '已写入当前文件 · 已留写前快照，可点通知里的「撤销」一键回退') +
          issueResolutionNote(wholeIssueResolutions, issuesAttributed, wholeIssueCounts),
        'success',
      );
      emitAuthorLoopResult({
        filePath: path,
        status: 'completed',
        action: 'revision_accepted',
        message: loopRecord.recordPath ? '修订已写回并记录闭环' : '修订已写回',
        recordPath: loopRecord.recordPath ?? undefined,
      });
    } catch (err) {
      if (!isCurrentAction(actionToken)) return;
      failAction(actionToken, `接受失败: ${err instanceof Error ? err.message : String(err)}`);
      emitAuthorLoopResult({
        filePath: path,
        status: 'error',
        action: 'revision_accepted',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      finishAction(actionToken);
    }
  }, [
    beginAction,
    failAction,
    isCurrentAction,
    updatePendingSuggestion,
    editorRef,
    emitAuthorLoopResult,
    filePathRef,
    offerUndo,
    projectPathRef,
    setSuggestionStatus,
    finishAction,
    forgetSuggestionRecovery,
    normalizeEol,
    writeAcceptedSuggestion,
  ]);

  /**
   * 自动档：补丁自己带着「不必等点击」就直接走同一条接受路径。
   *
   * 放宽的只有「作者点一下」这一层——快照 → 写盘 → 版本记录、漂移拒写、派生目录只读、
   * 项目边界全都照旧执行，撤销 toast 也照旧弹。任何一条守卫拦下来，补丁就留在
   * PatchReviewPanel 里退回手动确认，绝不静默丢弃。
   */
  const autoAcceptingRef = useRef(false);
  const autoAcceptedSuggestionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingSuggestion || !shouldAutoAcceptSuggestion(pendingSuggestion)) {
      if (!pendingSuggestion) autoAcceptedSuggestionIdRef.current = null;
      return;
    }
    if (actionState) return;
    if (autoAcceptedSuggestionIdRef.current === pendingSuggestion.id) return;
    if (autoAcceptingRef.current) return;
    autoAcceptedSuggestionIdRef.current = pendingSuggestion.id;
    autoAcceptingRef.current = true;
    void handleAcceptSuggestion().finally(() => {
      autoAcceptingRef.current = false;
    });
  }, [actionState, pendingSuggestion, handleAcceptSuggestion]);

  const handleAcceptHunk = useCallback(
    async (hunk: PatchHunk) => {
      const suggestion = pendingSuggestionRef.current;
      const path = filePathRef.current;
      if (!suggestion || !path || suggestion.filePath !== path || !editorRef.current) {
        setSuggestionStatus('当前没有待写回的修订。');
        return;
      }

      const actionToken = beginAction('hunk', suggestion);
      if (!actionToken) return;

      try {
        const currentContent = editorRef.current.getValue();
        const opState =
          suggestionOpsRef.current?.suggestionId === suggestion.id
            ? suggestionOpsRef.current
            : null;
        if (!opState) throw new Error('缺少原始操作集合，不能接受分块。');
        const matched = matchChangeSetOperation(opState.changeSet, hunk);
        if (!matched) {
          // 分块无法一一对应回原始修订的某一处 op（作者改动落在该处，或出现歧义重复），
          // 拒绝这次半选，避免把作者的内容当成补丁改动写掉。
          throw new Error(
            '这个修改块对应不上原始修订的任何一处改动（该处可能已被改写或存在歧义），已拒绝接受；请重新生成修订或手动处理。',
          );
        }
        // 分块接受改走与整份接受同一套锚定定位器：定位不到唯一目标即抛冲突、零写入，
        // 不再用「取部分上下文最佳分」的旧定位（重复块 + 目标上下文被改会静默写错处）。
        const hunkPlan = planHunkAccept(
          currentContent,
          matched ?? hunk,
          opState?.changeSet.before ?? suggestion.before,
        );
        const nextContent = hunkPlan.content;
        // 消费/确认是历史，解决归属须重新核验实际写入稿；不能因旧 op 曾接受就算仍在稿内。
        const previousAcceptedOpIds = new Set(opState.appliedOpIds);
        const appliedAfterHunk = new Set(previousAcceptedOpIds);
        if (matched) appliedAfterHunk.add(matched.id);
        const opsForIssues = opState?.changeSet.operations ?? [];
        const settledAfterHunk = verifiedAppliedOpIds(
          nextContent,
          opState.changeSet.before,
          opsForIssues,
          appliedAfterHunk,
        );
        // 本次实际施加的原 op 有规划证据；只观察到某处已有结果则仍须核验原位置。
        if (matched && !hunkPlan.alreadyApplied) settledAfterHunk.add(matched.id);
        const issuesAttributed = hasIssueAttribution(
          suggestion.issueIds ?? [],
          suggestion.issueScopes ?? [],
        );
        const hunkIssueResolutions =
          suggestion.issueIds?.length && opState
            ? resolveIssueStatuses(
                suggestion.issueIds,
                suggestion.issueScopes ?? [],
                opsForIssues,
                settledAfterHunk,
              )
            : undefined;
        const hunkIssueCounts = hunkIssueResolutions
          ? summarizeIssueResolutions(
              hunkIssueResolutions,
              resolveIssueStatuses(
                suggestion.issueIds ?? [],
                suggestion.issueScopes ?? [],
                opsForIssues,
                appliedAfterHunk,
              ),
            )
          : undefined;
        const loopRecord = await writeAcceptedSuggestion(
          suggestion,
          path,
          currentContent,
          nextContent,
          {
            operationKind: `hunk:${matched.id}${opState.lastUndoOperationId ? `:after-undo:${opState.lastUndoOperationId}` : ''}`,
            summary: `${suggestion.summary}（接受分块）`,
            note: `${suggestion.note}\n\n分块接受：第 ${hunk.originalStartIndex + 1} 行附近，+${hunk.addedLines} / -${hunk.removedLines}`,
            issueResolutions: hunkIssueResolutions,
            issueCounts: hunkIssueCounts,
            issueAttributed: hunkIssueResolutions ? issuesAttributed : undefined,
          },
        );
        if (opState && matched) opState.appliedOpIds.add(matched.id);
        const displayedCurrent = isCurrentAction(actionToken)
          ? (editorRef.current?.getValue() ?? nextContent)
          : nextContent;
        const projection = projectRemainingSuggestion(
          displayedCurrent,
          opState.changeSet,
          opState.appliedOpIds,
        );
        const remaining = projection.finished
          ? null
          : {
              ...suggestion,
              before: displayedCurrent,
              after: projection.after,
              operationView: projection.view,
            };
        const finished = remaining === null;
        if (finished) await forgetSuggestionRecovery(suggestion);
        replacePendingFileSuggestion(suggestion, remaining);
        if (!isCurrentAction(actionToken)) return;
        updatePendingSuggestion(remaining);
        if (loopRecord.warning) {
          emitToast(loopRecord.warning, {
            tone: 'info',
            action: loopRecord.retryAudit
              ? { label: '重试记录（不重写正文）', run: loopRecord.retryAudit }
              : undefined,
          });
          emitAuthorLoopResult({
            filePath: path,
            status: 'completed',
            action: 'revision_accepted',
            message: loopRecord.warning,
            warning: loopRecord.warning,
          });
          return;
        }
        offerUndo(
          suggestion,
          path,
          currentContent,
          nextContent,
          loopRecord.createdFile,
          loopRecord.receipt.operationId,
          `第 ${hunk.originalStartIndex + 1} 行附近，+${hunk.addedLines} / -${hunk.removedLines} 行`,
          previousAcceptedOpIds,
        );
        setSuggestionStatus(
          (finished
            ? '修订已全部接受并写回；一键撤销只回退最后写回的那一次分块，更早的写回见版本历史。'
            : loopRecord.recordPath
              ? '已接受该修改块并写入当前文件，剩余修改仍可继续确认'
              : '已接受该修改块并写入当前文件') +
            issueResolutionNote(hunkIssueResolutions, issuesAttributed, hunkIssueCounts),
          'success',
        );
      } catch (err) {
        failAction(
          actionToken,
          `接受分块失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        finishAction(actionToken);
      }
    },
    [
      beginAction,
      emitAuthorLoopResult,
      failAction,
      isCurrentAction,
      updatePendingSuggestion,
      editorRef,
      filePathRef,
      finishAction,
      forgetSuggestionRecovery,
      offerUndo,
      setSuggestionStatus,
      writeAcceptedSuggestion,
    ],
  );

  useEffect(() => {
    const onSuggestionResult = (event: Event) => {
      const result = (event as CustomEvent<SuggestionResult>).detail;
      const path = filePathRef.current;
      if (!result || !path || result.filePath !== path) return;
      setIsReviseLoading(false);
      if (result.status !== 'ready') {
        setSuggestionStatus(`AI 修订失败：${result.message}`, 'error');
      }
      if (result.assistantSessionId) {
        assistantSessionIdRef.current = result.assistantSessionId;
      }
    };
    window.addEventListener(SUGGESTION_RESULT_EVENT, onSuggestionResult);
    return () => window.removeEventListener(SUGGESTION_RESULT_EVENT, onSuggestionResult);
  }, [filePathRef, setSuggestionStatus]);

  useEffect(() => {
    const onAcceptCurrentSuggestion = (event: Event) => {
      const target = (event as CustomEvent<FileSuggestionTarget | undefined>).detail;
      const suggestion = pendingSuggestionRef.current;
      if (
        !suggestion ||
        actionInFlightRef.current ||
        (target && (suggestion.id !== target.patchId || suggestion.filePath !== target.filePath))
      )
        return;
      event.preventDefault();
      void handleAcceptSuggestion();
    };
    window.addEventListener(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT, onAcceptCurrentSuggestion);
    return () =>
      window.removeEventListener(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT, onAcceptCurrentSuggestion);
  }, [handleAcceptSuggestion]);

  const handleSaveSuggestionNote = useCallback(async () => {
    const suggestion = pendingSuggestionRef.current;
    const project = projectPathRef.current;
    if (!suggestion || !project) return;

    const actionToken = beginAction('note', suggestion);
    if (!actionToken) return;

    try {
      const separator = project.includes('\\') ? '\\' : '/';
      const fileName = suggestion.filePath.split(/[/\\]/).pop() ?? 'file';
      const notePath = [
        project.replace(/[/\\]+$/, ''),
        '.storyforge',
        'notes',
        `${Date.now()}-${fileName}.md`,
      ].join(separator);
      const note = [
        `# ${suggestion.title}`,
        '',
        `- 文件：${suggestion.filePath}`,
        `- 时间：${new Date(suggestion.createdAt).toISOString()}`,
        '',
        '## 摘要',
        '',
        suggestion.summary,
        '',
        '## 旁注',
        '',
        suggestion.note,
        '',
        '## 当前内容摘录',
        '',
        '```markdown',
        suggestion.before.slice(0, 2000),
        suggestion.before.length > 2000 ? '...' : '',
        '```',
        '',
        '## 建议后摘录',
        '',
        '```markdown',
        suggestion.after.slice(0, 2000),
        suggestion.after.length > 2000 ? '...' : '',
        '```',
      ].join('\n');
      await TauriFileSystem.writeFile(project, notePath, note);
      replacePendingFileSuggestion(suggestion, null);
      await forgetSuggestionRecovery(suggestion);
      if (!isCurrentAction(actionToken)) return;
      updatePendingSuggestion(null);
      setSuggestionStatus(`已保存旁注: ${notePath}`, 'success');
    } catch (err) {
      failAction(actionToken, `保存旁注失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      finishAction(actionToken);
    }
  }, [
    beginAction,
    failAction,
    finishAction,
    forgetSuggestionRecovery,
    isCurrentAction,
    projectPathRef,
    setSuggestionStatus,
    updatePendingSuggestion,
  ]);

  const handleRetrySuggestion = useCallback(
    async (retry: () => Promise<void>) => {
      const suggestion = pendingSuggestionRef.current;
      if (!suggestion) return;
      const token = beginAction('retry', suggestion);
      if (!token) return;
      try {
        await retry();
      } catch (error) {
        failAction(token, `重试失败: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        finishAction(token);
      }
    },
    [beginAction, failAction, finishAction],
  );

  /**
   * 拒绝不是二元否决：作者往往知道该怎么改，只是这版没改对。
   *
   * direction 非空时由 ChatWindow 侧接住，当作一句真实的作者发言发出去——落进会话、
   * 自动进下一轮 prompt、顺带重做一版；留空则维持轻量否决，不烧新一轮 BYO-key。
   * 无论哪条路径，这里都只清面板，写盘一步都不做。
   */
  const rejectPendingSuggestion = useCallback(
    async (direction = '') => {
      const suggestion = pendingSuggestionRef.current;
      const trimmed = direction.trim();
      if (suggestion) {
        const actionToken = beginAction('reject', suggestion);
        if (!actionToken) return;
        await forgetSuggestionRecovery(suggestion);
        const current = isCurrentAction(actionToken);
        finishAction(actionToken);
        if (!current) return;
      }
      updatePendingSuggestion(null);
      setSuggestionStatus(trimmed ? '已否掉这版，正按你的说法重来' : '已拒绝修订');
      if (suggestion) {
        emitPatchRejected({
          filePath: filePathRef.current ?? suggestion.filePath,
          patchId: suggestion.id,
          direction: trimmed,
        });
      }
    },
    [
      beginAction,
      filePathRef,
      finishAction,
      forgetSuggestionRecovery,
      isCurrentAction,
      pendingSuggestionRef,
      setSuggestionStatus,
      updatePendingSuggestion,
    ],
  );

  useEffect(() => {
    const onRejectCurrentSuggestion = (event: Event) => {
      const rejection = (event as CustomEvent<PatchRejection>).detail;
      const suggestion = pendingSuggestionRef.current;
      if (
        !rejection ||
        !suggestion ||
        actionInFlightRef.current ||
        suggestion.id !== rejection.patchId ||
        suggestion.filePath !== rejection.filePath
      )
        return;
      event.preventDefault();
      rejectPendingSuggestion(rejection.direction);
    };
    window.addEventListener(REJECT_CURRENT_FILE_SUGGESTION_EVENT, onRejectCurrentSuggestion);
    return () =>
      window.removeEventListener(REJECT_CURRENT_FILE_SUGGESTION_EVENT, onRejectCurrentSuggestion);
  }, [rejectPendingSuggestion]);

  return {
    adoptPendingSuggestion,
    recoverPendingSuggestion,
    handleAcceptHunk,
    handleAcceptSuggestion,
    handleSaveSuggestionNote,
    handleRetrySuggestion,
    actionState,
    actionError:
      actionFailure?.suggestion === pendingSuggestion ? (actionFailure?.message ?? null) : null,
    isReviseLoading,
    pendingSuggestion,
    rejectPendingSuggestion,
    resetSuggestionWriteback,
    setSuggestionStatus,
    // 行间对话（Ctrl+K）接受时复用同一套快照 + 写盘 + 闭环记录 + 分支头，避免另起一套写回。
    writeAcceptedSuggestion,
  };
}
