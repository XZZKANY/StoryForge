export type DiffViewerProps = {
  readonly before: string;
  readonly after: string;
};

export function DiffViewer({ before, after }: DiffViewerProps) {
  return (
    <section aria-label="IDE Diff Viewer" className="grid gap-4 md:grid-cols-2">
      <div className="rounded border border-rose-800 bg-rose-950/30 p-3">
        <h2 className="mb-2 font-semibold">修复前</h2>
        <pre className="whitespace-pre-wrap text-sm">{before}</pre>
      </div>
      <div className="rounded border border-emerald-800 bg-emerald-950/30 p-3">
        <h2 className="mb-2 font-semibold">修复后</h2>
        <pre className="whitespace-pre-wrap text-sm">{after}</pre>
      </div>
    </section>
  );
}
