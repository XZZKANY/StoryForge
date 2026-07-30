/**
 * 全局右下角通知（toast）事件桥：任何模块 emitToast 即弹，呈现由壳子的
 * ToastHost 统一承接。与编辑器内定位型反馈（sf-inline-toast、suggestionStatus
 * 行内条）互补：跨面板的结果类通知（导出落点、更新提示、后台失败）走这里。
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
};

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 7000;
/** 带动作的通知要留够反悔时间：4s 不够读完一句话再决定要不要撤。 */
const ACTIONABLE_DURATION_MS = 10000;

export function emitToast(
  message: string,
  options?: { tone?: ToastTone; durationMs?: number; action?: ToastAction },
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
  };
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }));
}
