import { BookRunStatusPanel, readBookRun } from './api';

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
    <main aria-labelledby="book-runs-title">
      <h1 id="book-runs-title">BookRun 整书运行</h1>
      <p>查看三章短篇 BookRun 的状态、章节进度、预算摘要和最近证据事件。</p>
      <BookRunStatusPanel bookRun={bookRun} />
      <section aria-labelledby="book-runs-actions-title">
        <h2 id="book-runs-actions-title">可用操作</h2>
        <ul>
          <li>从 Blueprint 页面启动 BookRun。</li>
          <li>通过 book_run_id 查看运行详情。</li>
          <li>完成后调用导出接口生成 book.md 与 audit_report.json。</li>
        </ul>
      </section>
    </main>
  );
}
