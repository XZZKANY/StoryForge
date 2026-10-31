import { useEffect } from 'react';

import type { AssistantFileSuggestion } from '../../lib/assistant-suggestions';
import { isEditableTarget } from '../../lib/browser-guards';
import type { PatchReviewActions } from './usePatchReviewActions';

export function usePatchReviewShortcuts(
  {
    suggestion,
    onAccept,
    onCancelTruncatedAccept,
  }: {
    suggestion: AssistantFileSuggestion;
    onAccept: () => void | Promise<void>;
    onCancelTruncatedAccept?: () => void;
  },
  { actionBusy, panelRef, runAction, setRejection, setExpanded }: PatchReviewActions,
) {
  // 快捷键：只在当前可见补丁的操作区接管；编辑器、Composer、设置等文本目标不抢键。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.defaultPrevented
      )
        return;
      if (actionBusy) return;
      if (event.isComposing || isEditableTarget(event.target)) return;
      const panel = panelRef.current;
      const target = event.target;
      if (
        !panel ||
        !(target instanceof Element) ||
        !panel.contains(target) ||
        panel.closest('[hidden], .hidden, [inert], [aria-hidden="true"]') ||
        !target.closest(
          '[role="group"][aria-label="修订操作"], [role="group"][aria-label="修订分块操作"]',
        )
      ) {
        return;
      }
      switch (event.key.toLowerCase()) {
        case 'y':
          event.preventDefault();
          runAction('accept', onAccept);
          break;
        case 'n':
          event.preventDefault();
          onCancelTruncatedAccept?.();
          setRejection((previous) => ({
            suggestion,
            draft: previous?.suggestion === suggestion && previous.draft !== null ? null : '',
          }));
          break;
        case 'e':
          event.preventDefault();
          setExpanded((value) => !value);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    actionBusy,
    onAccept,
    onCancelTruncatedAccept,
    runAction,
    setExpanded,
    suggestion,
    panelRef,
    setRejection,
  ]);
}
