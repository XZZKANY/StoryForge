/**
 * 全局通知（toast）事件桥：任何模块 emitToast 即弹，呈现由壳子的 ToastHost 统一承接，
 * 叠在左栏底部。行间改写（Ctrl+K / Ctrl+Shift+K）的状态也走这里；编辑器顶栏的
 * suggestionStatus 行内条是另一回事，不在这里。
 */

export const TOAST_EVENT = 'storyforge:toast';

export type ToastTone = 'info' | 'success' | 'error';

/**
 * 通知里的一个就地动作（目前只用于「撤销」）。可撤销胜过先确认：能一键回退的操作
 * 不必先拦一道弹窗。同进程同 window，回调直接随 CustomEvent detail 走，不涉及序列化。
 */
export type ToastAction = {
  label: string;
  run: () => void | Promise<void>;
};

export type ToastDetail = {
  message: string;
  tone: ToastTone;
  durationMs: number;
  action?: ToastAction;
  /** 同一个 key 只留最新一条：同一处来源的状态一条顶一条，不往上叠。 */
  key?: string;
};

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 7000;
/** 带动作的通知要留够反悔时间：4s 不够读完一句话再决定要不要撤（悬停/聚焦时 ToastHost 会暂停倒计时）。 */
const ACTIONABLE_DURATION_MS = 10000;

export function emitToast(
  message: string,
  options?: { tone?: ToastTone; durationMs?: number; action?: ToastAction; key?: string },
): void {
  if (typeof window === 'undefined') return;
  const tone = options?.tone ?? 'info';
  const fallback = options?.action
    ? ACTIONABLE_DURATION_MS
    : tone === 'error'
      ? ERROR_DURATION_MS
      : DEFAULT_DURATION_MS;
  const detail: ToastDetail = {
    message,
    tone,
    durationMs: options?.durationMs ?? fallback,
    action: options?.action,
    key: options?.key,
  };
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }));
}
