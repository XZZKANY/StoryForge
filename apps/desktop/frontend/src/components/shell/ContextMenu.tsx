/**
 * 通用右键菜单：固定定位在鼠标处、越界回收、点外/Esc 关闭。
 * 各区域（文件树 / 页签 …）给不同的 items，满足「每个区域右键不一样」（#17）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type ContextMenuItem =
  | { type: 'separator' }
  | {
      type?: 'item';
      label: string;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
    };

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // capture 阶段：抢在其他 mousedown（如打开另一个菜单）之前收起当前菜单。
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  // 越界回收：菜单右/下越出视口时向左/上贴边。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nextX =
      x + rect.width > window.innerWidth ? Math.max(4, window.innerWidth - rect.width - 4) : x;
    const nextY =
      y + rect.height > window.innerHeight ? Math.max(4, window.innerHeight - rect.height - 4) : y;
    if (nextX !== pos.x || nextY !== pos.y) setPos({ x: nextX, y: nextY });
    // 仅依赖入参坐标：pos 变化不应重触发（否则来回抖动）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="context-menu"
      className="fixed z-50 min-w-[172px] rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow-dropdown)]"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`sep-${index}`} className="my-1 mx-1.5 h-px bg-border" />;
        }
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`flex w-full items-center rounded-sm px-2.5 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              item.danger
                ? 'text-error hover:bg-error/10'
                : 'text-muted hover:bg-elevated hover:text-foreground'
            }`}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
