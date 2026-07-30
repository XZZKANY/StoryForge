/**
 * 左栏视图里的可折叠分区。手稿与作品两个视图各有四五个分区，样式必须一致——
 * 折叠箭头、行高、右侧计数的位置在两栏之间对不齐，作者会读成「这是两个不同的东西」。
 *
 * testid 带视图前缀（`manuscript-section-skeleton` / `book-section-outline`），
 * 因此两个视图的分区在测试里仍各自可定位。
 */
import { useState, type ReactNode } from 'react';

import { ChevronDown, ChevronRight } from '../icons/shell-icons';

export function PanelSection({
  title,
  meta,
  prefix,
  testid,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  /** 视图前缀，如 `manuscript` / `book`。 */
  prefix: string;
  testid: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="border-t border-border" data-testid={`${prefix}-section-${testid}`}>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-1 px-2 text-left text-2xs font-medium text-muted hover:bg-elevated hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid={`${prefix}-toggle-${testid}`}
      >
        <Chevron size={12} strokeWidth={1.7} className="flex-shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {meta && <span className="flex-shrink-0 font-mono text-3xs text-subtle">{meta}</span>}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}
