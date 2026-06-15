'use client';

import type { ReactNode } from 'react';
import { useState, Suspense } from 'react';

import { UnifiedSidebar } from './UnifiedSidebar';
import type { RecentItem } from './recent-items-store';
import { useSwipe } from '../../lib/hooks/use-touch-swipe';

export function Chrome({
  children,
  initialRecentItems = [],
}: {
  readonly children: ReactNode;
  readonly initialRecentItems?: readonly RecentItem[];
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // 触摸手势支持：在主内容区向右滑动打开侧边栏
  const mainRef = useSwipe<HTMLDivElement>(
    {
      onSwipeRight: () => {
        if (!isSidebarOpen && window.innerWidth < 1024) {
          setIsSidebarOpen(true);
        }
      },
      onSwipeLeft: () => {
        if (isSidebarOpen) {
          setIsSidebarOpen(false);
        }
      },
    },
    { threshold: 100 },
  );

  return (
    <div className="flex h-screen">
      {/* 移动端遮罩 */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 侧边栏 */}
      <Suspense fallback={<div className="w-64" />}>
        <UnifiedSidebar
          initialRecentItems={initialRecentItems}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />
      </Suspense>

      {/* 主内容区 */}
      <div ref={mainRef} className="flex min-w-0 flex-1 flex-col overflow-auto bg-background">
        {/* 移动端顶部导航栏 */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-background px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-lg text-foreground hover:bg-muted/10 active:bg-muted/15"
            aria-label="打开侧边栏"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <h1 className="font-serif text-xl font-semibold text-foreground">StoryForge</h1>
        </header>

        {/* 页面内容 */}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
