import type { CSSProperties } from 'react';

export type LoadingSkeletonProps = {
  readonly label?: string;
  readonly lines?: number;
  readonly className?: string;
};

const lineBaseClassName = 'block h-3 w-full rounded bg-stone-200 dark:bg-stone-800 animate-pulse';

export function LoadingSkeleton({
  label = '正在加载',
  lines = 3,
  className,
}: LoadingSkeletonProps) {
  const safeLineCount = Math.max(1, Math.floor(lines));
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="loading-skeleton"
      className={className ?? 'space-y-2'}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: safeLineCount }).map((_, index) => {
        const width = 100 - index * 10;
        const style: CSSProperties = { width: `${Math.max(40, width)}%` };
        return <span key={index} className={lineBaseClassName} style={style} aria-hidden="true" />;
      })}
    </div>
  );
}
