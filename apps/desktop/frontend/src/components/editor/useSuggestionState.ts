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

import { useMountedRef } from '../../lib/async-guards';
import type { AuthorLoopResult } from '../../lib/assistant-events';
import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import type { RevisionLoopRecord, RevisionLoopResult } from '../../lib/author-loop';
import type { BranchInfo } from '../../lib/branches';
import type { EditorModelCache } from './useMonacoEditor';
import type { WritebackQueue } from '../../lib/writeback';
import { emitToast } from '../../lib/toast';
import { capturePendingSuggestion, persistPendingSuggestion } from '../../lib/suggestion-recovery';
import {
  createOperationState,
  suggestionOperationStates,
  type SuggestionOpState,
} from './suggestion-op-state';

// 修订补丁在编辑器里的状态所有者：待确认补丁、动作锁、半截稿武装。其余子 hook 只经它读写这些状态。

export type SuggestionStatusTone = 'success' | 'error' | 'info';

export type SuggestionActionKind = 'accept' | 'hunk' | 'note' | 'reject' | 'retry' | 'undo';
export type SuggestionActionState = {
  kind: SuggestionActionKind;
  suggestionId: string;
} | null;

export type UseSuggestionWritebackParams = {
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

/** 半截稿的「仍然整份接受」只武装这么久，照「请求停止 → 确认停止」的做法。 */
export const TRUNCATED_ACCEPT_CONFIRM_TIMEOUT_MS = 5000;

export function useSuggestionState({
  enqueueWriteback,
  filePathRef,
  projectPathRef,
  dropOpenFilePath,
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
  const dropOpenFilePathRef = useRef(dropOpenFilePath);
  useLayoutEffect(() => {
    dropOpenFilePathRef.current = dropOpenFilePath;
  }, [dropOpenFilePath]);
  const mountedRef = useMountedRef();

  // 引擎标了「新稿可能没写完」的补丁：整份接受第一次只武装、不写，同一份补丁武装着再来一次才写；
  // 超时、失焦、换补丁、点了别的操作都撤销武装。
  const [truncationArmedId, setTruncationArmedId] = useState<string | null>(null);
  const truncationArmedIdRef = useRef<string | null>(null);
  const truncationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTruncatedAccept = useCallback(() => {
    if (truncationTimerRef.current) clearTimeout(truncationTimerRef.current);
    truncationTimerRef.current = null;
    truncationArmedIdRef.current = null;
    if (mountedRef.current) setTruncationArmedId(null);
  }, [mountedRef]);
  const armTruncatedAccept = useCallback(
    (suggestionId: string) => {
      if (truncationTimerRef.current) clearTimeout(truncationTimerRef.current);
      truncationArmedIdRef.current = suggestionId;
      setTruncationArmedId(suggestionId);
      truncationTimerRef.current = setTimeout(
        cancelTruncatedAccept,
        TRUNCATED_ACCEPT_CONFIRM_TIMEOUT_MS,
      );
    },
    [cancelTruncatedAccept],
  );
  useEffect(
    () => () => {
      if (truncationTimerRef.current) clearTimeout(truncationTimerRef.current);
    },
    [],
  );
  // 换了补丁（含逐处接受后同一补丁局部刷新）就撤销武装。
  useEffect(() => {
    cancelTruncatedAccept();
  }, [pendingSuggestion, cancelTruncatedAccept]);

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
                    `原提案未持久保存，没有写进文件；请重新生成修订：${String(error)}`,
                    'error',
                  );
              });
            } catch (error) {
              setSuggestionStatus(
                `修订恢复信息未保存，写进文件前请重新生成：${String(error)}`,
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
    [enqueueWriteback, mountedRef, projectPathRef, setSuggestionStatus],
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
    [filePathRef, mountedRef, projectPathRef],
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
    [filePathRef, mountedRef, projectPathRef],
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

  const finishAction = useCallback(
    (token: symbol) => {
      if (actionInFlightRef.current?.token !== token) return;
      actionInFlightRef.current = null;
      if (mountedRef.current) setActionState(null);
    },
    [mountedRef],
  );

  return {
    pendingSuggestion,
    setSuggestionStatus,
    isReviseLoading,
    setIsReviseLoading,
    assistantSessionIdRef,
    pendingSuggestionRef,
    actionInFlightRef,
    actionState,
    actionFailure,
    mountedRef,
    dropOpenFilePathRef,
    truncationArmedId,
    truncationArmedIdRef,
    cancelTruncatedAccept,
    armTruncatedAccept,
    suggestionOpsRef,
    recoveryEpochRef,
    updatePendingSuggestion,
    beginAction,
    isCurrentAction,
    failAction,
    finishAction,
  };
}

export type SuggestionState = ReturnType<typeof useSuggestionState>;
