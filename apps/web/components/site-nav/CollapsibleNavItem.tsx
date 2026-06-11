'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

type CollapsibleNavItemProps = {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly href: string;
  readonly isActive: boolean;
  readonly description?: string;
  readonly children?: React.ReactNode;
  readonly defaultOpen?: boolean;
};

export function CollapsibleNavItem({
  icon,
  label,
  href,
  isActive,
  description,
  children,
  defaultOpen = false,
}: CollapsibleNavItemProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const hasChildren = !!children;

  return (
    <li className="!m-0 !border-0 !bg-transparent !p-0 !shadow-none">
      <div className="flex items-center gap-1">
        <Link
          href={href}
          title={description}
          aria-current={isActive ? 'page' : undefined}
          className={`group flex min-h-[clamp(36px,4.4vh,42px)] flex-1 items-center gap-3 rounded-full px-4 py-2 text-[clamp(13px,0.9vw,15px)] no-underline transition-colors ${
            isActive
              ? 'bg-muted/15 font-medium text-foreground shadow-sm dark:bg-muted/20'
              : 'font-normal text-muted-foreground hover:bg-muted/10 hover:text-foreground dark:hover:bg-muted/15'
          }`}
        >
          <span
            aria-hidden
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
              isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
            }`}
          >
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </Link>
        {hasChildren && (
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-label={isOpen ? '收起' : '展开'}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-muted/10 dark:hover:bg-muted/15"
          >
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
            />
          </button>
        )}
      </div>
      {hasChildren && isOpen && (
        <ul className="!m-0 mt-1 !grid !grid-cols-1 !gap-1 !p-0 pl-8">{children}</ul>
      )}
    </li>
  );
}
