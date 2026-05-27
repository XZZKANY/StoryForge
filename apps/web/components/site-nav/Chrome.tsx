'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { SiteNav } from './SiteNav';
import { ThemeToggle } from './ThemeToggle';

export function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/') {
    return <>{children}</>;
  }
  return (
    <div className="md:grid md:grid-cols-[18rem_1fr]">
      <SiteNav />
      <div className="min-w-0">
        <ThemeToggle />
        {children}
      </div>
    </div>
  );
}
