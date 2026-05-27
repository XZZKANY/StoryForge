import { BookRunAuditPanel } from '../../audit';
import { readBookRun } from '../../api';

export default async function BookRunAuditPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const resolvedParams = await params;
  const bookRunId = Number.parseInt(resolvedParams.id, 10);
  const bookRun =
    Number.isInteger(bookRunId) && bookRunId > 0 ? await readBookRun(bookRunId) : null;

  return (
    <main aria-labelledby="book-run-audit-page-title">
      <h1 id="book-run-audit-page-title">全书审计页</h1>
      <p>按章节回看 generate、judge、repair、approve 与 memory_extract 证据链。</p>
      <BookRunAuditPanel bookRun={bookRun} />
    </main>
  );
}
