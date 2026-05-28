export type DiffViewerProps = {
  readonly before: string;
  readonly after: string;
  readonly approveCommandId?: string;
  readonly approveArgs?: Record<string, unknown>;
  readonly auditEventId?: string | null;
  readonly onApprove?: () => void;
};

export function DiffViewer({
  before,
  after,
  approveCommandId,
  approveArgs = {},
  auditEventId,
  onApprove,
}: DiffViewerProps) {
  return (
    <section aria-label="IDE Diff Viewer" className="grid gap-3">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-rose-800 bg-rose-950/30 p-3">
          <h2 className="mb-2 font-semibold">修复前</h2>
          <pre className="whitespace-pre-wrap text-sm">{before}</pre>
        </div>
        <div className="rounded border border-emerald-800 bg-emerald-950/30 p-3">
          <h2 className="mb-2 font-semibold">修复后</h2>
          <pre className="whitespace-pre-wrap text-sm">{after}</pre>
        </div>
      </div>
      {approveCommandId ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            className="rounded bg-emerald-700 px-3 py-2 font-semibold text-white"
            onClick={onApprove}
            data-command-id={approveCommandId}
            data-command-args={JSON.stringify(approveArgs)}
          >
            批准写回
          </button>
          {auditEventId ? (
            <span className="font-mono text-xs text-emerald-200">
              audit_event_id={auditEventId}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
