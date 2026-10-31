import { useContext, useRef, type ComponentPropsWithoutRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
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

export type ModalDialogProps = Omit<DialogSurfaceProps, 'open'> & {
  /** top：贴上方（命令面板），结果列表变长时输入框不跟着上下跳。 */
  placement?: 'center' | 'top';
};
// 模态弹窗唯一外壳：遮罩、层级、动画、portal 都在这里。宽高、底色、内边距由 className 给表面。
export function ModalDialog({ placement = 'center', className = '', ...props }: ModalDialogProps) {
  const nested = useContext(LayerContext) !== null;
  const modal = (
    <div
      role="presentation"
      data-modal-backdrop=""
      className={`fixed inset-0 z-50 flex justify-center bg-black/50 p-4 animate-fade-in ${
        placement === 'top' ? 'items-start sm:pt-24' : 'items-center'
      }`}
    >
      <DialogSurface
        {...props}
        className={`rounded-xl border border-border shadow-dialog animate-slide-up-fade ${className}`}
      />
    </div>
  );
  // 嵌在另一层表面里打开时挂到 body：外层表面的 transform / overflow 会困住 fixed 遮罩。
  return nested ? createPortal(modal, document.body) : modal;
}
