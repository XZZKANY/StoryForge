/**
 * 通知栈：监听 TOAST_EVENT，逐条上叠、到时自动消失、可手动关闭。
 * 叠在左栏底部；左栏收起时退到活动栏右边。pointer-events 只落在卡片上不挡下面的东西。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TOAST_EVENT, type ToastDetail, type ToastTone } from '../../lib/toast';
import { X } from '../icons/shell-icons';
import { Button, IconButton } from '../ui';

type ToastItem = ToastDetail & { id: number };
type ToastActionState = { status: 'loading' | 'error'; error?: string };

const MAX_VISIBLE = 4;
const STACK_WIDTH = 320;
const STACK_GAP = 8;
// 左栏拖到比这还窄就不往里塞，退到活动栏右边。
const MIN_DOCK_WIDTH = 200;
// 左栏收起时栈的左缘：让出左侧活动栏。
const RAIL_LEFT = 56;

export type ToastStackPlacement = { left: number; bottom: number; width: number };

/**
 * 通知统一叠在左栏底部（作者 11-02）：放在编辑区右下角会压住正文最后几行，放在右下角又压对话；
 * 写作时左栏最不要紧。左栏收起时退到活动栏右边的窗口左下角，那里压到对话（对话占满窗口）
 * 就抬到消息列表底边之上，避开输入框。隐藏的元素量出来全是 0，自然不算。
 */
export function toastStackPlacement(
  dock: DOMRect | null,
  floors: readonly DOMRect[],
  viewportWidth: number,
  viewportHeight: number,
): ToastStackPlacement {
  if (dock && dock.width >= MIN_DOCK_WIDTH) {
    return {
      left: Math.round(dock.left + STACK_GAP),
      bottom: Math.max(STACK_GAP, Math.round(viewportHeight - dock.bottom + STACK_GAP)),
      width: Math.round(Math.min(STACK_WIDTH, dock.width - STACK_GAP * 2)),
    };
  }
  const width = Math.max(0, Math.min(STACK_WIDTH, viewportWidth - RAIL_LEFT - STACK_GAP));
  const right = RAIL_LEFT + width;
  return {
    left: RAIL_LEFT,
    bottom: floors
      .filter((floor) => floor.right > RAIL_LEFT && floor.left < right)
      .reduce(
        (bottom, floor) => Math.max(bottom, Math.round(viewportHeight - floor.bottom + STACK_GAP)),
        STACK_GAP,
      ),
    width,
  };
}

// 普通提示用中性色：紫色只给 AI。
const TONE_BAR: Record<ToastTone, string> = {
  info: 'bg-muted/60',
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
  const [placement, setPlacement] = useState<ToastStackPlacement>({
    left: RAIL_LEFT,
    bottom: STACK_GAP,
    width: STACK_WIDTH,
  });

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
      if (detail.key !== undefined) {
        for (const [existingId, existing] of liveItems) {
          if (existing.key === detail.key) dismiss(existingId);
        }
      }
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

  useLayoutEffect(() => {
    if (items.length === 0) return;
    const dock = () => document.querySelector<HTMLElement>('[data-toast-dock]');
    const floors = () => [...document.querySelectorAll<HTMLElement>('[data-toast-floor]')];
    const measure = () => {
      const next = toastStackPlacement(
        dock()?.getBoundingClientRect() ?? null,
        floors().map((floor) => floor.getBoundingClientRect()),
        window.innerWidth,
        window.innerHeight,
      );
      setPlacement((current) =>
        current.left === next.left && current.bottom === next.bottom && current.width === next.width
          ? current
          : next,
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const node of [dock(), ...floors()]) if (node) observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [items]);

  if (items.length === 0) return null;

  return (
    // 游离豁免层：模态打开时不被 inert/aria-hidden 压掉（z-index 见 index.css 的 toast-host 规则）。
    // 纯视觉容器：live 语义由每条通知按 tone 自管（error→alert，其余→status），不嵌套 region。
    <div
      className="pointer-events-none fixed flex flex-col gap-2"
      style={{ bottom: placement.bottom, left: placement.left, width: placement.width }}
      data-testid="toast-host"
      data-layer-exempt=""
      onMouseLeave={() => items.forEach((item) => resumeItem(item.id))}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex animate-slide-in-up items-start gap-2.5 overflow-hidden rounded-lg border border-border bg-surface py-2.5 pl-0 pr-2 text-xs text-foreground shadow-[var(--shadow-dropdown)]"
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
            {/* 撤销放在文字下面：左栏窄，并排时连一个文件名都要折行。 */}
            {item.action && (
              <div className="mt-1.5">
                <Button
                  size="compact"
                  data-testid="toast-action"
                  disabled={actionStates[item.id]?.status === 'loading'}
                  onClick={() => void runAction(item)}
                >
                  {actionStates[item.id]?.status === 'loading' ? '处理中…' : item.action.label}
                </Button>
              </div>
            )}
          </div>
          <IconButton
            size="mini"
            label="关闭通知"
            icon={<X size={11} strokeWidth={1.7} />}
            data-testid="toast-close"
            onClick={() => dismiss(item.id)}
          />
        </div>
      ))}
    </div>
  );
}
