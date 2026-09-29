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
  const actionTokensRef = useRef(new Map<number, number>());
  const inFlightActionsRef = useRef(new Set<number>());
  // 悬停/聚焦暂停：每条通知的计时状态单源（deadline/剩余时间/是否暂停/句柄）。
  const pausedRef = useRef(
    new Map<number, { deadline: number; remainingMs: number; paused: boolean; timer?: number }>(),
  );
  const [pausedIds, setPausedIds] = useState<ReadonlySet<number>>(new Set());

  const dismiss = useCallback((id: number) => {
    const pauseInfo = pausedRef.current.get(id);
    if (pauseInfo?.timer !== undefined) window.clearTimeout(pauseInfo.timer);
    pausedRef.current.delete(id);
    liveItemsRef.current.delete(id);
    actionTokensRef.current.delete(id);
    inFlightActionsRef.current.delete(id);
    setPausedIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setActionStates((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const armTimer = useCallback(
    (id: number, delayMs: number) => {
      const pauseInfo = pausedRef.current.get(id);
      if (!pauseInfo) return;
      pauseInfo.deadline = Date.now() + delayMs;
      pauseInfo.paused = false;
      if (pauseInfo.timer !== undefined) window.clearTimeout(pauseInfo.timer);
      pauseInfo.timer = window.setTimeout(() => dismiss(id), delayMs);
      setPausedIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    },
    [dismiss],
  );

  const pauseItem = useCallback((id: number) => {
    const pauseInfo = pausedRef.current.get(id);
    if (!pauseInfo || pauseInfo.paused || pauseInfo.timer === undefined) return;
    window.clearTimeout(pauseInfo.timer);
    pauseInfo.timer = undefined;
    pauseInfo.remainingMs = Math.max(1, pauseInfo.deadline - Date.now());
    pauseInfo.paused = true;
    setPausedIds((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);

  const resumeItem = useCallback(
    (id: number) => {
      const pauseInfo = pausedRef.current.get(id);
      if (!pauseInfo || !pauseInfo.paused) return;
      armTimer(id, pauseInfo.remainingMs);
    },
    [armTimer],
  );

  const runAction = useCallback(
    async (item: ToastItem) => {
      if (
        !item.action ||
        liveItemsRef.current.get(item.id) !== item ||
        inFlightActionsRef.current.has(item.id)
      )
        return;
      const pauseInfo = pausedRef.current.get(item.id);
      if (pauseInfo?.timer !== undefined) window.clearTimeout(pauseInfo.timer);
      // 动作一旦启动，倒计时即作废：失败后要留足重试时间，不因悬停恢复又被收走。
      pausedRef.current.delete(item.id);
      setPausedIds((current) => {
        if (!current.has(item.id)) return current;
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
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
    const liveItems = liveItemsRef.current;
    const tokens = actionTokensRef.current;
    const inFlight = inFlightActionsRef.current;
    const paused = pausedRef.current;
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      const id = nextIdRef.current++;
      const item = { ...detail, id };
      liveItems.set(id, item);
      paused.set(id, { deadline: 0, remainingMs: detail.durationMs, paused: false });
      // 溢出丢弃：先丢无动作的普通通知，保住还来得及用的撤销/重试入口；
      // 只有全是带动作通知时才丢最旧。
      while (liveItems.size > MAX_VISIBLE) {
        let victim: number | undefined;
        for (const [candidateId, candidate] of liveItems) {
          if (candidateId === id) break;
          if (!candidate.action) {
            victim = candidateId;
            break;
          }
        }
        if (victim === undefined) {
          const oldest = liveItems.keys().next().value;
          victim = oldest === id ? undefined : oldest;
        }
        if (victim === undefined) break;
        dismiss(victim);
      }
      setItems([...liveItems.values()]);
      armTimer(id, detail.durationMs);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      for (const pauseInfo of paused.values()) {
        if (pauseInfo.timer !== undefined) window.clearTimeout(pauseInfo.timer);
      }
      paused.clear();
      liveItems.clear();
      tokens.clear();
      inFlight.clear();
    };
  }, [dismiss, armTimer]);

  if (items.length === 0) return null;

  return (
    // 游离豁免层：模态打开时不被 inert/aria-hidden 压掉（z-index 见 index.css 的 toast-host 规则）。
    // 纯视觉容器：live 语义由每条通知按 tone 自管（error→alert，其余→status），不嵌套 region。
    <div
      className="pointer-events-none fixed bottom-9 right-3 flex w-[320px] flex-col gap-2"
      data-testid="toast-host"
      data-layer-exempt=""
      onMouseLeave={() => items.forEach((item) => resumeItem(item.id))}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex animate-slide-in-right items-start gap-2.5 overflow-hidden rounded-lg border border-border bg-surface py-2.5 pl-0 pr-2 text-xs text-foreground shadow-[var(--shadow-dropdown)]"
          data-testid="toast-item"
          data-tone={item.tone}
          role={item.tone === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => pauseItem(item.id)}
          onFocusCapture={() => pauseItem(item.id)}
          onBlurCapture={(event) => {
            const itemEl = event.currentTarget as HTMLElement;
            const next = event.relatedTarget as Node | null;
            // 焦点只在同一条通知内部移动不算离开（action→close 互换不恢复倒计时）。
            if (!next || !itemEl.contains(next)) resumeItem(item.id);
          }}
        >
          {pausedIds.has(item.id) && (
            <span className="sr-only" data-testid="toast-countdown-paused">
              倒计时已暂停
            </span>
          )}
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
