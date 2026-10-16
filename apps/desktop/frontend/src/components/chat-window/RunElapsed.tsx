import { useEffect, useState } from 'react';

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}

/** 运行中的已用时间：改稿、起草动辄几十秒，界面上要看得出它还在走。头两秒不显示，免得一闪「0 秒」。 */
export function RunElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  if (seconds < 2) return null;
  return (
    <span className="tabular-nums text-subtle" data-testid="run-elapsed">
      {formatElapsed(seconds)}
    </span>
  );
}
