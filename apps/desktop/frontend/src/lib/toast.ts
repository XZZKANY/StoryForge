/**
 * 全局右下角通知（toast）事件桥：任何模块 emitToast 即弹，呈现由壳子的
 * ToastHost 统一承接。与编辑器内定位型反馈（sf-inline-toast、suggestionStatus
 * 行内条）互补：跨面板的结果类通知（导出落点、更新提示、后台失败）走这里。
 */

export const TOAST_EVENT = 'storyforge:toast';

export type ToastTone = 'info' | 'success' | 'error';

export type ToastDetail = {
  message: string;
  tone: ToastTone;
  durationMs: number;
};

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 7000;

export function emitToast(
  message: string,
  options?: { tone?: ToastTone; durationMs?: number },
): void {
  if (typeof window === 'undefined') return;
  const tone = options?.tone ?? 'info';
  const detail: ToastDetail = {
    message,
    tone,
    durationMs: options?.durationMs ?? (tone === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS),
  };
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }));
}
