'use client';

import type { ReactNode } from 'react';

import { UnifiedSidebar } from './UnifiedSidebar';
import type { RecentItem } from './recent-items-store';

export function Chrome({
  children,
  initialRecentItems = [],
}: {
  readonly children: ReactNode;
  readonly initialRecentItems?: readonly RecentItem[];
}) {
  return (
    <div className="flex h-screen">
      <UnifiedSidebar initialRecentItems={initialRecentItems} />
      <main className="min-w-0 flex-1 overflow-auto bg-background">{children}</main>
    </div>
  );
}
