import type { RefObject } from 'react';
import { MenuItem, MenuSeparator, MenuSurface } from '../ui';
export type ContextMenuItem =
  | { type: 'separator' }
  | { type?: 'item'; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean };
/** Menu semantics stay separate from listbox selection and non-modal information cards. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
  triggerRef,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** 唤起本菜单的按钮/右键起源元素：Esc 关闭后焦点归还，outside-dismiss 不误吃它身上的按下。 */
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <MenuSurface
      frosted
      point={{ x, y }}
      triggerRef={triggerRef}
      aria-label="操作菜单"
      onDismiss={onClose}
      data-testid="context-menu"
      className="min-w-[172px]"
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item.type === 'separator' ? (
          <MenuSeparator key={`sep-${index}`} />
        ) : (
          <MenuItem
            key={item.label}
            disabled={item.disabled}
            danger={item.danger}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </MenuItem>
        ),
      )}
    </MenuSurface>
  );
}
