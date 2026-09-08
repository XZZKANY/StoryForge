import { useEffect, type RefObject } from 'react';

/**
 * 非菜单弹层的可关性：打开时响应 Escape，并把焦点还给触发钮。
 * 真正的菜单使用 useMenuKeyboard，以提供菜单首焦点、方向键和 Tab 退出语义。
 * 触发钮仍需自行补 aria-haspopup="menu" / aria-expanded={open}。
 */
export function useDismissableMenu(
  open: boolean,
  close: () => void,
  triggerRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        return;
      }
      event.preventDefault();
      close();
      triggerRef?.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close, triggerRef]);
}
