import { BookRunEventsClient } from './BookRunEventsClient';
import { BookRunPanel, type BookRunPanelRun } from './BookRunPanel';

export type BookRunEventSnapshot = {
  readonly event: string;
  readonly data: Record<string, unknown>;
};

export type BookRunEventsPanelProps = {
  readonly run?: BookRunPanelRun;
  readonly events?: readonly BookRunEventSnapshot[];
  readonly onExecuteCommand?: (
    commandId: string,
    args: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
};

export function BookRunEventsPanel({
  run,
  events = [],
  onExecuteCommand,
}: BookRunEventsPanelProps) {
  const eventsUrl = run ? `/api/ide/runs/${run.id}/events` : '';

  return (
    <section
      aria-label="BookRun Events Panel"
      className="space-y-4"
      data-event-source="sse"
      data-events-url={eventsUrl}
      data-content-type="text/event-stream"
    >
      <BookRunPanel run={run} onExecuteCommand={onExecuteCommand} />
      <BookRunEventsClient eventsUrl={eventsUrl} initialEvents={events} />
      <section className="rounded-lg border border-stone-800 bg-stone-950 p-3 text-stone-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">SSE 快照事件</h3>
          <span className="font-mono text-xs text-stone-400">{eventsUrl || '未选择 BookRun'}</span>
        </div>
        <p className="mt-2 text-xs text-stone-400">
          text/event-stream 快照来自 /api/ide/runs/{'{book_run_id}'}/events。
        </p>
        {events.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-stone-700 p-3 text-sm text-stone-400">
            暂无 SSE 快照事件
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-stone-300">
            {events.map((item, index) => (
              <li
                key={`${item.event}:${index}`}
                className="rounded border border-stone-800 bg-stone-900 p-2"
                data-run-event={item.event}
              >
                <span className="mr-2 rounded bg-stone-800 px-2 py-0.5 font-mono text-xs">
                  {item.event}
                </span>
                <span>{formatRecord(item.data)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function formatRecord(record: Record<string, unknown>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' · ');
}

function formatValue(value: unknown): string {
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
