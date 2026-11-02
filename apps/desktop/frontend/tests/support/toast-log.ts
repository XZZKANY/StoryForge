import { TOAST_EVENT, type ToastDetail } from '../../src/lib/toast';

/** 记下 emitToast 发出的每条通知：断言「提示过什么」读这里，不从界面容器里找文字。 */
export function captureToasts() {
  const items: ToastDetail[] = [];
  const onToast = (event: Event) => items.push((event as CustomEvent<ToastDetail>).detail);
  window.addEventListener(TOAST_EVENT, onToast);
  return {
    items,
    text: () => items.map((item) => item.message).join('\n'),
    latest: () => items.at(-1),
    stop: () => window.removeEventListener(TOAST_EVENT, onToast),
  };
}
