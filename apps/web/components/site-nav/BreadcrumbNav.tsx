'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

type Breadcrumb = {
  readonly label: string;
  readonly href?: string;
};

type BreadcrumbNavProps = {
  readonly items: readonly Breadcrumb[];
};

export function BreadcrumbNav({ items }: BreadcrumbNavProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="面包屑导航" className="mb-4">
      <ol className="flex items-center gap-2 text-sm text-muted">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-2">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-foreground hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? 'font-semibold text-foreground' : ''}>{item.label}</span>
              )}
              {!isLast && <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
