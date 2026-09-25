/**
 * 右下角通知栈：监听 TOAST_EVENT，逐条上叠、到时自动消失、可手动关闭。
 * 固定在状态栏上方，pointer-events 只落在卡片上不挡编辑器。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TOAST_EVENT, type ToastDetail, type ToastTone } from '../../lib/toast';
import { X } from '../icons/shell-icons';

type ToastItem = ToastDetail & { id: number };
type ToastActionState = { status: 'loading' | 'error'; error?: string };

const MAX_VISIBLE = 4;

const TONE_BAR: Record<ToastTone, string> = {
  info: 'bg-agent',
  success: 'bg-success',
  error: 'bg-error',
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [actionStates, setActionStates] = useState<Record<number, ToastActionState>>({});
  const nextIdRef = useRef(1);
  const liveItemsRef = useRef(new Map<number, ToastItem>());
  const timersRef = useRef(new Map<number, number>());
  const actionTokensRef = useRef(new Map<number, number>());
  const inFlightActionsRef = useRef(new Set<number>());

  const dismiss = useCallback((id: number) => {
    const timers = timersRef.current;
    const timer = timers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.delete(id);
    liveItemsRef.current.delete(id);
    actionTokensRef.current.delete(id);
    inFlightActionsRef.current.delete(id);
    setActionStates((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const runAction = useCallback(
    async (item: ToastItem) => {
      if (
        !item.action ||
        liveItemsRef.current.get(item.id) !== item ||
        inFlightActionsRef.current.has(item.id)
      )
        return;
      const timer = timersRef.current.get(item.id);
      if (timer !== undefined) window.clearTimeout(timer);
      timersRef.current.delete(item.id);
      const token = (actionTokensRef.current.get(item.id) ?? 0) + 1;
      actionTokensRef.current.set(item.id, token);
      inFlightActionsRef.current.add(item.id);
      setActionStates((states) => ({ ...states, [item.id]: { status: 'loading' } }));
      try {
        const result = item.action.run();
        // 同步 action 保持点击后的即时收起；仅对真正的 Promise 等待异步结果。
        if (result) await result;
        if (actionTokensRef.current.get(item.id) !== token) return;
        dismiss(item.id);
      } catch (error) {
        // Keep the claim through this event turn even if run() throws before
        // returning a Promise, so a same-frame double click cannot retry it.
        await Promise.resolve();
        if (actionTokensRef.current.get(item.id) !== token) return;
        setActionStates((states) => ({
          ...states,
          [item.id]: {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          },
        }));
      } finally {
        if (actionTokensRef.current.get(item.id) === token) {
          inFlightActionsRef.current.delete(item.id);
        }
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    const liveItems = liveItemsRef.current;
    const tokens = actionTokensRef.current;
    const inFlight = inFlightActionsRef.current;
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      const id = nextIdRef.current++;
      const item = { ...detail, id };
      liveItems.set(id, item);
      while (liveItems.size > MAX_VISIBLE) {
        const oldest = liveItems.keys().next().value;
        if (oldest !== undefined) dismiss(oldest);
      }
      setItems([...liveItems.values()]);
      timers.set(
        id,
        window.setTimeout(() => dismiss(id), detail.durationMs),
      );
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      liveItems.clear();
      tokens.clear();
      inFlight.clear();
    };
  }, [dismiss]);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-9 right-3 z-50 flex w-[320px] flex-col gap-2"
      data-testid="toast-host"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex items-start gap-2.5 overflow-hidden rounded-lg border border-border bg-surface py-2.5 pl-0 pr-2 text-xs text-foreground shadow-[var(--shadow-dropdown)]"
          data-testid="toast-item"
          data-tone={item.tone}
          role={item.tone === 'error' ? 'alert' : undefined}
        >
          <span className={`w-[3px] self-stretch rounded-full ${TONE_BAR[item.tone]}`} />
          <div className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-px leading-5">
            <span>{item.message}</span>
            {actionStates[item.id]?.status === 'error' && (
              <p className="mt-1 text-error" role="alert" data-testid="toast-action-error">
                操作失败：{actionStates[item.id]?.error || '未知错误'}
              </p>
            )}
          </div>
          {item.action && (
            <button
              className="flex-shrink-0 rounded-sm px-1.5 py-0.5 font-medium text-agent hover:bg-elevated"
              data-testid="toast-action"
              disabled={actionStates[item.id]?.status === 'loading'}
              onClick={() => void runAction(item)}
            >
              {actionStates[item.id]?.status === 'loading' ? '处理中…' : item.action.label}
            </button>
          )}
          <button
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm text-subtle hover:bg-elevated hover:text-foreground"
            aria-label="关闭通知"
            title="关闭通知"
            data-testid="toast-close"
            onClick={() => dismiss(item.id)}
          >
            <X size={11} strokeWidth={1.7} />
          </button>
        </div>
      ))}
    </div>
  );
}
