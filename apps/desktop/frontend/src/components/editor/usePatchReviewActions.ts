import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import type { PatchAction } from './patch-review-text';

// 补丁审阅面板的状态所有者：展开与说明、拒绝草稿，以及同一时刻只放行一个动作的动作锁。
export function usePatchReviewActions({
  suggestion,
  actionKind,
  error,
  onCancelTruncatedAccept,
}: {
  suggestion: AssistantFileSuggestion;
  actionKind: PatchAction | null;
  error: string | null;
  onCancelTruncatedAccept?: () => void;
}) {
  // 补丁一来审阅就占满编辑区、停在第一处改动（作者 10-16：此前默认在正文下方劈出一块、从第 1 行
  // 开始，改动在文末时上下两半都看不到）。作者收起只对这一版补丁算数，下一版补丁又占满。
  const [collapsedId, setCollapsedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const expanded = collapsedId !== suggestion.id;
  const setExpanded = useCallback(
    (next: boolean | ((value: boolean) => boolean)) =>
      setCollapsedId((collapsed) => {
        const current = collapsed !== suggestion.id;
        return (typeof next === 'function' ? next(current) : next) ? null : suggestion.id;
      }),
    [suggestion.id],
  );
  const [rejection, setRejection] = useState<{
    suggestion: AssistantFileSuggestion;
    draft: string | null;
  } | null>(null);
  const rejectDraft = rejection?.suggestion === suggestion ? rejection.draft : null;
  const setRejectDraft = (value: string | null | ((previous: string | null) => string | null)) => {
    setRejection({ suggestion, draft: typeof value === 'function' ? value(rejectDraft) : value });
  };
  const [localAction, setLocalAction] = useState<{
    suggestion: AssistantFileSuggestion;
    kind: PatchAction;
  } | null>(null);
  const [localError, setLocalError] = useState<{
    suggestion: AssistantFileSuggestion;
    message: string;
  } | null>(null);
  const actionState =
    actionKind ?? (localAction?.suggestion === suggestion ? localAction.kind : null);
  const actionError = error ?? (localError?.suggestion === suggestion ? localError.message : null);
  const actionInFlightRef = useRef<{ kind: PatchAction; token: symbol } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const actionBusy = actionState !== null;

  useLayoutEffect(
    () => () => {
      actionInFlightRef.current = null;
    },
    [suggestion],
  );

  const runAction = useCallback(
    (kind: PatchAction, action: () => void | Promise<void>) => {
      if (kind !== 'accept') onCancelTruncatedAccept?.();
      if (actionKind || actionInFlightRef.current) return;
      if (kind === 'accept' && Object.keys(suggestion.operationView?.conflicts ?? {}).length)
        return;
      const token = Symbol(kind);
      actionInFlightRef.current = { kind, token };
      setLocalError(null);
      setLocalAction({ suggestion, kind });
      const finish = () => {
        if (actionInFlightRef.current?.token !== token) return;
        actionInFlightRef.current = null;
        setLocalAction(null);
      };
      const fail = (error: unknown) => {
        if (actionInFlightRef.current?.token !== token) return;
        setLocalError({
          suggestion,
          message: error instanceof Error ? error.message : String(error),
        });
      };
      try {
        const result = action();
        if (result && typeof result.then === 'function') {
          void result.catch(fail).finally(finish);
        } else {
          finish();
        }
      } catch (error) {
        fail(error);
        finish();
      }
    },
    [actionKind, onCancelTruncatedAccept, suggestion],
  );
  return {
    detailsOpen,
    setDetailsOpen,
    expanded,
    setExpanded,
    setRejection,
    rejectDraft,
    setRejectDraft,
    actionState,
    actionError,
    actionInFlightRef,
    panelRef,
    actionBusy,
    runAction,
  };
}

export type PatchReviewActions = ReturnType<typeof usePatchReviewActions>;
