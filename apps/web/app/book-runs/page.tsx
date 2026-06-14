import { readBookRun } from './api';
export const dynamic = 'force-dynamic';

import { BookRunLiveView } from '../../components/book-runs';

function readPositiveInt(value: string | string[] | undefined): number | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function BookRunsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const bookRunId = readPositiveInt(params.book_run_id);
  const bookRun = bookRunId ? await readBookRun(bookRunId) : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">BookRun 整书运行</h1>
        <p className="mt-2 text-sm text-muted sm:text-base">
          实时查看生成进度、章节状态、预算消耗和性能指标
        </p>
      </div>

      {bookRun ? (
        <BookRunLiveView initialBookRun={bookRun} bookRunId={bookRun.id} />
      ) : (
        <div className="rounded-2xl border border-border bg-panel p-8 text-center sm:p-12">
          <svg
            className="mx-auto h-12 w-12 text-muted sm:h-16 sm:w-16"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h2 className="mt-4 text-lg font-semibold text-foreground sm:text-xl">未选择 BookRun</h2>
          <p className="mt-2 text-sm text-muted sm:text-base">
            请从 Blueprint 页面启动运行，或在 URL 中提供 book_run_id 参数
          </p>
        </div>
      )}
    </main>
  );
}
