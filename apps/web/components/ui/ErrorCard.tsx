import type { ReactNode } from 'react';

export type ErrorCardProps = {
  readonly title?: string;
  readonly message: string;
  readonly action?: ReactNode;
};

export function ErrorCard({ title = '读取失败', message, action }: ErrorCardProps) {
  return (
    <section
      role="status"
      aria-live="polite"
      data-testid="error-card"
      className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100"
    >
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm">{message}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
