import { useEffect } from 'react';

import {
  ACCEPT_CURRENT_FILE_SUGGESTION_EVENT,
  REJECT_CURRENT_FILE_SUGGESTION_EVENT,
  SUGGESTION_RESULT_EVENT,
  markAcceptArmed,
  markAcceptBusy,
  type FileSuggestionTarget,
  type PatchRejectionRequest,
  type SuggestionResult,
} from '../../lib/assistant-events';
import { useGuardedSuggestionWrite } from './useGuardedSuggestionWrite';
import { useHunkSuggestionAccept } from './useHunkSuggestionAccept';
import { useSuggestionDismissal } from './useSuggestionDismissal';
import { useSuggestionIntake } from './useSuggestionIntake';
import { useSuggestionState, type UseSuggestionWritebackParams } from './useSuggestionState';
import { useSuggestionUndo } from './useSuggestionUndo';
import { useWholeSuggestionAccept } from './useWholeSuggestionAccept';

export {
  TRUNCATED_ACCEPT_CONFIRM_TIMEOUT_MS,
  type SuggestionActionKind,
  type SuggestionActionState,
  type SuggestionStatusTone,
} from './useSuggestionState';

/**
 * 编辑器里 AI 修订补丁的组合层。各职责 hook 按拆分前在本文件里的先后顺序调用
 * （hook 顺序就是 effect 的注册顺序），这里只留对话侧发来的窗口命令监听与对外返回值。
 */
export function useSuggestionWriteback(params: UseSuggestionWritebackParams) {
  const { filePathRef } = params;
  const state = useSuggestionState(params);
  const {
    pendingSuggestion,
    setSuggestionStatus,
    isReviseLoading,
    setIsReviseLoading,
    assistantSessionIdRef,
    pendingSuggestionRef,
    actionInFlightRef,
    actionState,
    actionFailure,
    truncationArmedId,
    cancelTruncatedAccept,
    armTruncatedAccept,
  } = state;
  const {
    resetSuggestionWriteback,
    adoptPendingSuggestion,
    recoverPendingSuggestion,
    forgetSuggestionRecovery,
  } = useSuggestionIntake(params, state);
  const { writeAcceptedSuggestion } = useGuardedSuggestionWrite(params, state);
  const { offerUndo } = useSuggestionUndo(params, state, { writeAcceptedSuggestion });
  const { handleAcceptSuggestion } = useWholeSuggestionAccept(params, state, {
    forgetSuggestionRecovery,
    writeAcceptedSuggestion,
    offerUndo,
  });
  const { handleAcceptHunk } = useHunkSuggestionAccept(params, state, {
    forgetSuggestionRecovery,
    writeAcceptedSuggestion,
    offerUndo,
  });

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
  }, [filePathRef, setSuggestionStatus, assistantSessionIdRef, setIsReviseLoading]);

  useEffect(() => {
    const onAcceptCurrentSuggestion = (event: Event) => {
      const target = (event as CustomEvent<FileSuggestionTarget | undefined>).detail;
      const suggestion = pendingSuggestionRef.current;
      if (
        !suggestion ||
        (target && (suggestion.id !== target.patchId || suggestion.filePath !== target.filePath))
      )
        return;
      event.preventDefault();
      if (actionInFlightRef.current) {
        markAcceptBusy(event);
        return;
      }
      // 半截稿在对话里只武装、从不写：要作者在编辑器里看过对比，在横幅上点「仍然整份接受」。
      if (suggestion.truncationWarning) {
        armTruncatedAccept(suggestion.id);
        markAcceptArmed(event);
        return;
      }
      void handleAcceptSuggestion();
    };
    window.addEventListener(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT, onAcceptCurrentSuggestion);
    return () =>
      window.removeEventListener(ACCEPT_CURRENT_FILE_SUGGESTION_EVENT, onAcceptCurrentSuggestion);
  }, [armTruncatedAccept, handleAcceptSuggestion, actionInFlightRef, pendingSuggestionRef]);

  const { handleSaveSuggestionNote, handleRetrySuggestion, rejectPendingSuggestion } =
    useSuggestionDismissal(params, state, { forgetSuggestionRecovery });

  useEffect(() => {
    const onRejectCurrentSuggestion = (event: Event) => {
      const rejection = (event as CustomEvent<PatchRejectionRequest>).detail;
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
      void rejectPendingSuggestion(rejection.direction).then(
        (rejected) => rejection.settle?.(rejected),
        () => rejection.settle?.(false),
      );
    };
    window.addEventListener(REJECT_CURRENT_FILE_SUGGESTION_EVENT, onRejectCurrentSuggestion);
    return () =>
      window.removeEventListener(REJECT_CURRENT_FILE_SUGGESTION_EVENT, onRejectCurrentSuggestion);
  }, [rejectPendingSuggestion, actionInFlightRef, pendingSuggestionRef]);

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
    truncationAcceptArmed: pendingSuggestion !== null && truncationArmedId === pendingSuggestion.id,
    cancelTruncatedAccept,
    isReviseLoading,
    pendingSuggestion,
    rejectPendingSuggestion,
    resetSuggestionWriteback,
    setSuggestionStatus,
    // 行间对话（Ctrl+K）接受时复用同一套快照 + 写盘 + 闭环记录 + 分支头，避免另起一套写回。
    writeAcceptedSuggestion,
  };
}
