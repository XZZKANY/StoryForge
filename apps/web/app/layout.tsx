import type { ReactNode } from 'react';

import { SiteNav } from '../components/site-nav/SiteNav';
import { ThemeToggle } from '../components/site-nav/ThemeToggle';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('storyforge-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark';}catch(e){}`,
          }}
        />
        <div className="md:grid md:grid-cols-[18rem_1fr]">
          <SiteNav />
          <div className="min-w-0">
            <ThemeToggle />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
