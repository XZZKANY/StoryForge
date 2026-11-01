/**
 * 左栏视图里的可折叠分区。手稿、作品、观测镜三个视图各有四五个分区，样式必须一致——
 * 折叠箭头、行高、右侧计数的位置在几栏之间对不齐，作者会读成「这是几个不同的东西」。
 *
 * testid 带视图前缀（`manuscript-section-skeleton` / `book-section-outline` / `obs-section-facts`），
 * 因此各视图的分区在测试里仍各自可定位。
 */
import { useState, type ReactNode } from 'react';

import { ChevronDown, ChevronRight } from '../icons/shell-icons';
import { PlainButton } from '../ui';

export function PanelSection({
  title,
  meta,
  prefix,
  testid,
  defaultOpen = false,
  stack = false,
  children,
}: {
  title: string;
  /** 标题右侧的小字；数字照原样显示（0 也显示），不想显示就不给或给 null。 */
  meta?: string | number | null;
  /** 视图前缀，如 `manuscript` / `book` / `obs`。 */
  prefix: string;
  testid: string;
  defaultOpen?: boolean;
  /** 内容是一列卡片：左右缩进、条目之间留间隔（观测镜）。 */
  stack?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="mt-2 first:mt-0" data-testid={`${prefix}-section-${testid}`}>
      <PlainButton
        className="flex h-8 w-full items-center gap-1 px-2 text-left text-2xs font-medium text-muted hover:bg-elevated hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid={`${prefix}-toggle-${testid}`}
      >
        <Chevron size={12} strokeWidth={1.7} className="flex-shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {meta != null && meta !== '' && (
          <span className="flex-shrink-0 font-mono text-3xs text-subtle">{meta}</span>
        )}
      </PlainButton>
      {open && (
        <div className="pb-2">
          {stack ? <div className="flex flex-col gap-2 px-3">{children}</div> : children}
        </div>
      )}
    </div>
  );
}
