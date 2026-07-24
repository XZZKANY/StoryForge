/**
 * 右下角通知栈：监听 TOAST_EVENT，逐条上叠、到时自动消失、可手动关闭。
 * 固定在状态栏上方，pointer-events 只落在卡片上不挡编辑器。
 */
import { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    const timers = timersRef.current;
    const dismiss = (id: number) => {
      const timer = timers.get(id);
      if (timer) window.clearTimeout(timer);
      timers.delete(id);
      setItems((current) => current.filter((item) => item.id !== id));
    };
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
  }, []);

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
          <button
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-subtle hover:bg-elevated hover:text-foreground"
            title="关闭通知"
            onClick={() => {
              const timer = timersRef.current.get(item.id);
              if (timer) window.clearTimeout(timer);
              timersRef.current.delete(item.id);
              setItems((current) => current.filter((entry) => entry.id !== item.id));
            }}
          >
            <X size={11} strokeWidth={1.7} />
          </button>
        </div>
      ))}
    </div>
  );
}
