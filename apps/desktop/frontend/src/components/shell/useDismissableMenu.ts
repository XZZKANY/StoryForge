import { useEffect, type RefObject } from 'react';

/**
 * 自定义下拉菜单的可关性：打开时挂 window keydown Esc → 关闭，并把焦点还给触发钮。
 * 触发钮另需自行补 aria-haspopup="menu" / aria-expanded={open}，读屏才知按钮会展开菜单。
 * 三处内联下拉（会话切换 / 项目库 / 页签「…」）共用此钩子，避免各写一套 Esc 逻辑。
 */
export function useDismissableMenu(
  open: boolean,
  close: () => void,
  triggerRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
      triggerRef?.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close, triggerRef]);
}
