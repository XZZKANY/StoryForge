/**
 * 右下角通知栈：监听 TOAST_EVENT，逐条上叠、到时自动消失、可手动关闭。
 * 固定在状态栏上方，pointer-events 只落在卡片上不挡编辑器。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TOAST_EVENT, type ToastDetail, type ToastTone } from '../../lib/toast';
import { X } from '../icons/shell-icons';

type ToastItem = ToastDetail & { id: number };

const MAX_VISIBLE = 4;

const TONE_BAR: Record<ToastTone, string> = {
  info: 'bg-agent',
  success: 'bg-success',
  error: 'bg-error',
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timers = timersRef.current;
    const timer = timers.get(id);
    if (timer) window.clearTimeout(timer);
    timers.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      const id = nextIdRef.current++;
      setItems((current) => [...current, { ...detail, id }].slice(-MAX_VISIBLE));
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
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-px leading-5">
            {item.message}
          </span>
          {item.action && (
            <button
              className="flex-shrink-0 rounded-sm px-1.5 py-0.5 font-medium text-agent hover:bg-elevated"
              data-testid="toast-action"
              onClick={() => {
                void item.action?.run();
                dismiss(item.id);
              }}
            >
              {item.action.label}
            </button>
          )}
          <button
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm text-subtle hover:bg-elevated hover:text-foreground"
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
