'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <main aria-labelledby="global-error-title">
          <h1 id="global-error-title">页面暂时不可用</h1>
          <p>StoryForge 读取数据时遇到问题：{error.message || '未知错误'}</p>
          <button type="button" onClick={() => reset()}>
            重新尝试
          </button>
        </main>
      </body>
    </html>
  );
}
