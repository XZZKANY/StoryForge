import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { LayerContext, useLayer, focusables, type DismissReason } from './layers';
import { placeFloating } from './floating-position';
export type FloatingSurfaceProps = ComponentPropsWithoutRef<'div'> & {
  triggerRef?: RefObject<HTMLElement | null>;
  point?: { x: number; y: number };
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  fitToComposer?: boolean;
  onDismiss: (reason: DismissReason | 'tab') => void;
};
export function FloatingSurface({
  triggerRef,
  point,
  side = 'bottom',
  align = 'start',
  fitToComposer = false,
  onDismiss,
  role = 'dialog',
  children,
  className = '',
  onKeyDown,
  onBlur,
  style,
  ...props
}: FloatingSurfaceProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const closeReason = useRef<DismissReason | 'tab' | null>(null);
  const close = (reason: DismissReason | 'tab') => {
    if (closeReason.current !== null) return;
    closeReason.current = reason;
    onDismiss(reason);
  };
  const id = useLayer({
    open: true,
    nodeRef,
    triggerRef,
    dismissOutside: true,
    dismissOnBlur: true,
    dismissOnTab: role === 'menu' || role === 'listbox',
    restoreFocus: role === 'menu',
    shouldRestoreOpener: () => closeReason.current === null,
    onDismiss: (reason) => {
      close(reason);
      if (reason === 'escape' && role !== 'tooltip')
        triggerRef?.current?.focus({ preventScroll: true });
    },
  });
  const width = style?.width;
  const pointX = point?.x,
    pointY = point?.y;
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const anchor = fitToComposer
      ? (triggerRef?.current?.closest<HTMLElement>('[data-testid="composer-surface"]') ??
        triggerRef?.current)
      : triggerRef?.current;
    const update = () => {
      node.style.maxWidth = `${Math.max(0, window.innerWidth - 16)}px`;
      node.style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
      const rect = anchor?.getBoundingClientRect();
      if (fitToComposer && rect)
        node.style.width = `${Math.max(0, Math.min(rect.width, window.innerWidth - 16))}px`;
      else node.style.width = typeof width === 'number' ? `${width}px` : (width ?? '');
      const origin =
        pointX !== undefined && pointY !== undefined
          ? { left: pointX, right: pointX, top: pointY, bottom: pointY }
          : rect;
      if (!origin) return;
      const box = node.getBoundingClientRect();
      const pos = placeFloating(
        origin,
        box.width,
        box.height,
        { width: window.innerWidth, height: window.innerHeight },
        side,
        align,
      );
      node.style.left = `${pos.left}px`;
      node.style.top = `${pos.top}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (anchor) observer.observe(anchor);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [triggerRef, pointX, pointY, side, align, fitToComposer, width]);
  useLayoutEffect(() => {
    if (role === 'menu' && nodeRef.current)
      (focusables(nodeRef.current)[0] ?? nodeRef.current).focus();
  }, [role]);
  return createPortal(
    <LayerContext.Provider value={id}>
      <div
        {...props}
        ref={nodeRef}
        role={role}
        tabIndex={-1}
        data-floating-surface=""
        data-fit-composer={fitToComposer || undefined}
        className={`sf-floating-surface ${className}`}
        style={{ ...style, position: 'fixed', overflowY: 'auto' }}
        onBlur={(event) => {
          onBlur?.(event);
          if (
            role === 'menu' &&
            event.relatedTarget instanceof Node &&
            !event.currentTarget.contains(event.relatedTarget) &&
            !triggerRef?.current?.contains(event.relatedTarget)
          )
            close('tab');
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229 ||
            role !== 'menu'
          )
            return;
          const items = focusables(event.currentTarget);
          if (!items.length) return;
          const index = items.indexOf(document.activeElement as HTMLElement);
          const next =
            event.key === 'ArrowDown'
              ? (index + 1) % items.length
              : event.key === 'ArrowUp'
                ? (index - 1 + items.length) % items.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : null;
          if (next !== null) {
            event.preventDefault();
            event.stopPropagation();
            items[next]?.focus();
          }
        }}
      >
        {children}
      </div>
    </LayerContext.Provider>,
    document.body,
  );
}
