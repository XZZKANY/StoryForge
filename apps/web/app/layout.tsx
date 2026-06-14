import type { ReactNode } from 'react';

import { readRecentAssistantSessions } from '../components/home/assistant-session-store';
import { Chrome } from '../components/site-nav/Chrome';
import type { RecentItem } from '../components/site-nav/recent-items-store';
import { ToastProvider } from '../components/ui';
import './globals.css';

async function readRecentAssistantSidebarItems(): Promise<readonly RecentItem[]> {
  const result = await readRecentAssistantSessions(8);
  if (result.status === 'error') {
    return [];
  }
  return result.data.map(
    (item): RecentItem => ({
      id: item.href,
      type: 'conversation',
      title: item.title,
      href: item.href,
      timestamp: item.updatedAt ? Date.parse(item.updatedAt) || 0 : 0,
      metadata: { status: item.summary },
    }),
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const recentAssistantItems = await readRecentAssistantSidebarItems();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('storyforge-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark';}catch(e){}`,
          }}
        />
        <ToastProvider>
          <Chrome initialRecentItems={recentAssistantItems}>{children}</Chrome>
        </ToastProvider>
      </body>
    </html>
  );
}
