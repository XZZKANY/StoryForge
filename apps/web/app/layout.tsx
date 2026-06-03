import type { ReactNode } from 'react';

import { Chrome } from '../components/site-nav/Chrome';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('storyforge-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark';}catch(e){}`,
          }}
        />
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
