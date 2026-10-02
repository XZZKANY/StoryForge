import { useRef, type ComponentPropsWithoutRef, type RefObject } from 'react';
import { LayerContext, useLayer } from './layers';
export type DialogSurfaceProps = ComponentPropsWithoutRef<'section'> & {
  open?: boolean;
  onClose: () => void;
  dismissOutside?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  shouldRestoreOpener?: () => boolean;
};
export function DialogSurface({
  open = true,
  onClose,
  dismissOutside = false,
  initialFocusRef,
  fallbackFocusRef,
  shouldRestoreOpener,
  children,
  onKeyDown,
  ...props
}: DialogSurfaceProps) {
  const nodeRef = useRef<HTMLElement>(null);
  const id = useLayer({
    open,
    modal: true,
    dismissOutside,
    nodeRef,
    initialFocusRef,
    fallbackFocusRef,
    shouldRestoreOpener,
    onDismiss: onClose,
  });
  return (
    <LayerContext.Provider value={id}>
      <section
        {...props}
        ref={nodeRef}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          onKeyDown?.(event);
        }}
      >
        {children}
      </section>
    </LayerContext.Provider>
  );
}
