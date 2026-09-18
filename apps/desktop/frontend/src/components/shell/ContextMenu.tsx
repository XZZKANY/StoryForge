/**
 * 通用右键菜单：固定定位在鼠标处、越界回收、点外/Esc 关闭。
 * 各区域（文件树 / 页签 …）给不同的 items，满足「每个区域右键不一样」（#17）。
 * 键盘导航：方向键上下移动、Enter 选择、Escape 关闭、Home/End 跳首尾。
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 可导航的菜单项索引（跳过 separator 和 disabled）
  const navigableIndices = items
    .map((item, i) => ({ item, index: i }))
    .filter(({ item }) => item.type !== 'separator' && !item.disabled)
    .map(({ index }) => index);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    // capture 阶段：抢在其他 mousedown（如打开另一个菜单）之前收起当前菜单。
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  // 键盘导航
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (navigableIndices.length === 0) return;

      const currentNavIndex = navigableIndices.indexOf(activeIndex);

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          const next = currentNavIndex === -1 ? 0 : (currentNavIndex + 1) % navigableIndices.length;
          setActiveIndex(navigableIndices[next]);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          const prev =
            currentNavIndex === -1
              ? navigableIndices.length - 1
              : (currentNavIndex - 1 + navigableIndices.length) % navigableIndices.length;
          setActiveIndex(navigableIndices[prev]);
          break;
        }
        case 'Home': {
          event.preventDefault();
          setActiveIndex(navigableIndices[0]);
          break;
        }
        case 'End': {
          event.preventDefault();
          setActiveIndex(navigableIndices[navigableIndices.length - 1]);
          break;
        }
        case 'Enter':
        case ' ': {
          if (activeIndex >= 0 && activeIndex < items.length) {
            event.preventDefault();
            const item = items[activeIndex];
            if (item.type !== 'separator' && !item.disabled) {
              onClose();
              item.onSelect();
            }
          }
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeIndex, items, navigableIndices, onClose]);

  // 高亮项滚入视口
  useEffect(() => {
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

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
      className="fixed z-50 min-w-[172px] rounded-lg border border-border/60 bg-surface/[0.92] p-1 shadow-dropdown"
      style={{
        left: pos.x,
        top: pos.y,
        backdropFilter: 'blur(40px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`sep-${index}`} className="my-1 mx-1.5 h-px bg-border" />;
        }
        const isActive = index === activeIndex;
        return (
          <button
            key={item.label}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            aria-current={isActive ? 'true' : undefined}
            className={`flex w-full items-center rounded-sm px-2.5 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
              item.danger
                ? `text-error ${isActive ? 'bg-error/10' : 'hover:bg-error/10'}`
                : `${isActive ? 'bg-elevated text-foreground' : 'text-muted hover:bg-elevated hover:text-foreground'}`
            }`}
            style={{
              transition: 'background-color var(--transition-fast), color var(--transition-fast)',
            }}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            onMouseEnter={() => setActiveIndex(index)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
