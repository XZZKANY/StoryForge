/**
 * 右下角通知栈：监听 TOAST_EVENT，逐条上叠、到时自动消失、可手动关闭。
 * 固定在状态栏上方，pointer-events 只落在卡片上不挡编辑器。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { emitToast, TOAST_EVENT, type ToastDetail, type ToastTone } from '../../lib/toast';
import { X } from '../icons/shell-icons';

type ToastItem = ToastDetail & { id: number };
type ToastTimer = {
  handle: number | null;
  remaining: number;
  startedAt: number;
  pointer: boolean;
  focus: boolean;
};

const MAX_VISIBLE = 4;

const TONE_BAR: Record<ToastTone, string> = {
  info: 'bg-agent',
  success: 'bg-success',
  error: 'bg-error',
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);
  const executedActionsRef = useRef(new WeakSet<ToastItem>());
  const timersRef = useRef(new Map<number, ToastTimer>());

  const dismiss = useCallback((id: number) => {
    const timers = timersRef.current;
    const timer = timers.get(id);
    if (timer?.handle != null) window.clearTimeout(timer.handle);
    timers.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const handlePauseChange = useCallback(
    (id: number, reason: 'pointer' | 'focus', paused: boolean) => {
      const timer = timersRef.current.get(id);
      if (!timer) return;
      timer[reason] = paused;
      if (timer.pointer || timer.focus) {
        if (timer.handle !== null) {
          window.clearTimeout(timer.handle);
          timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
          timer.handle = null;
        }
      } else if (timer.handle === null) {
        timer.startedAt = Date.now();
        timer.handle = window.setTimeout(() => dismiss(id), timer.remaining);
      }
    },
    [dismiss],
  );

  const runAction = (item: ToastItem) => {
    if (!item.action || executedActionsRef.current.has(item)) return;
    executedActionsRef.current.add(item);
    dismiss(item.id);
    const reportFailure = () =>
      emitToast(`“${item.action?.label}”未能完成，请检查当前状态后再重试。`, { tone: 'error' });
    try {
      void Promise.resolve(item.action.run()).catch(reportFailure);
    } catch {
      reportFailure();
    }
  };

  useEffect(() => {
    const timers = timersRef.current;
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      const id = nextIdRef.current++;
      timers.set(id, {
        handle: window.setTimeout(() => dismiss(id), detail.durationMs),
        remaining: detail.durationMs,
        startedAt: Date.now(),
        pointer: false,
        focus: false,
      });
      if (timers.size > MAX_VISIBLE) {
        // Preserve the card being read or operated; the incoming card is a
        // safe eviction candidate even if every older card is paused.
        const oldest = [...timers].find(([, timer]) => !timer.pointer && !timer.focus)?.[0];
        if (oldest !== undefined) {
          const evicted = timers.get(oldest);
          if (evicted?.handle != null) window.clearTimeout(evicted.handle);
          timers.delete(oldest);
        }
      }
      const visibleIds = new Set(timers.keys());
      setItems((current) =>
        [...current, { ...detail, id }].filter((item) => visibleIds.has(item.id)),
      );
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      for (const timer of timers.values()) {
        if (timer.handle !== null) window.clearTimeout(timer.handle);
      }
      timers.clear();
    };
  }, [dismiss]);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-9 right-3 z-50 flex w-[320px] max-w-[calc(100vw-1.5rem)] flex-col gap-2"
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
          onPointerEnter={() => handlePauseChange(item.id, 'pointer', true)}
          onPointerLeave={() => handlePauseChange(item.id, 'pointer', false)}
          onFocusCapture={() => handlePauseChange(item.id, 'focus', true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              handlePauseChange(item.id, 'focus', false);
            }
          }}
          role={item.tone === 'error' ? 'alert' : undefined}
        >
          <span className={`w-[3px] self-stretch rounded-full ${TONE_BAR[item.tone]}`} />
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-px leading-5">
            {item.message}
          </span>
          {item.action && (
            <button
              type="button"
              className="flex-shrink-0 rounded-sm px-1.5 py-0.5 font-medium text-agent hover:bg-elevated"
              data-testid="toast-action"
              onClick={() => runAction(item)}
            >
              {item.action.label}
            </button>
          )}
          <button
            type="button"
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm text-subtle hover:bg-elevated hover:text-foreground"
            title="关闭通知"
            aria-label="关闭通知"
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
