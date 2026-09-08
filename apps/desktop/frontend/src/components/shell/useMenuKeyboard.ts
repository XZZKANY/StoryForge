import { useCallback, useEffect, useRef, type RefObject } from 'react';

function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')).filter(
    (item) =>
      !item.matches(':disabled, [aria-disabled="true"]') && !item.closest('[hidden], [inert]'),
  );
}

export function useMenuKeyboard(
  open: boolean,
  menuRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  triggerRef?: RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoringFocusRef = useRef(false);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const restoreFocus = useCallback(() => {
    const target = returnFocusRef.current;
    if (target?.isConnected) {
      restoringFocusRef.current = true;
      target.focus({ preventScroll: true });
      restoringFocusRef.current = false;
    }
  }, []);

  // Restore before invoking an action so a newly opened dialog can own focus.
  const dismiss = useCallback(() => {
    restoreFocus();
    closeRef.current();
  }, [restoreFocus]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    returnFocusRef.current =
      triggerRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    let focusedItem: HTMLElement | null = null;
    let focusedIndex = 0;
    let focusOrder: HTMLElement[] = [];
    const onFocus = () => {
      focusedItem = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      focusOrder = menuItems(menu);
      focusedIndex = Math.max(
        0,
        focusOrder.findIndex((item) => item === focusedItem),
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      const items = menuItems(menu);
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next: number | undefined;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      if (event.key === 'ArrowUp') next = (index <= 0 ? items.length : index) - 1;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = items.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        items[next]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      } else if (event.key === 'Tab') {
        // Menu items are outside the Tab sequence; native Tab continues from the trigger.
        dismiss();
      }
    };
    const onOutsideFocus = (event: FocusEvent) => {
      if (
        !restoringFocusRef.current &&
        event.target instanceof Node &&
        !menu.contains(event.target)
      ) {
        closeRef.current();
      }
    };
    menu.addEventListener('focusin', onFocus);
    menu.addEventListener('keydown', onKeyDown);
    (menuItems(menu)[0] ?? menu).focus();
    document.addEventListener('focusin', onOutsideFocus);

    // Removing a recent-project row must not strand focus on the document body.
    const observer = new MutationObserver(() => {
      if (focusedItem && !focusedItem.isConnected && document.activeElement === document.body) {
        const items = menuItems(menu);
        const neighbor = [
          ...focusOrder.slice(focusedIndex + 1),
          ...focusOrder.slice(0, focusedIndex).reverse(),
        ].find((item) => items.includes(item));
        (neighbor ?? items[Math.min(focusedIndex, items.length - 1)] ?? menu).focus();
      }
    });
    observer.observe(menu, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      menu.removeEventListener('focusin', onFocus);
      menu.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onOutsideFocus);
      if (document.activeElement === document.body || menu.contains(document.activeElement)) {
        restoreFocus();
      }
    };
  }, [dismiss, menuRef, open, restoreFocus, triggerRef]);

  return dismiss;
}
