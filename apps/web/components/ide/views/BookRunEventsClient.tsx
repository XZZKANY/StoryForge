'use client';

import { useEffect, useMemo, useState } from 'react';

import type { BookRunEventSnapshot } from './BookRunEventsPanel';

const MAX_LIVE_EVENTS = 100;

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export type BookRunEventSourceState = {
  readonly connectionState: ConnectionState;
  readonly retryCount: number;
};

export type BookRunEventSourceAction =
  | { readonly type: 'connect' }
  | { readonly type: 'open' }
  | { readonly type: 'event' }
  | { readonly type: 'error' }
  | { readonly type: 'idle' }
  | { readonly type: 'close' };

export function reduceBookRunEventSourceState(
  state: BookRunEventSourceState = { connectionState: 'idle', retryCount: 0 },
  action: BookRunEventSourceAction,
): BookRunEventSourceState {
  switch (action.type) {
    case 'connect':
      return { ...state, connectionState: 'connecting' };
    case 'open':
    case 'event':
      return { ...state, connectionState: 'open' };
    case 'error':
      return { connectionState: 'reconnecting', retryCount: state.retryCount + 1 };
    case 'idle':
      return { ...state, connectionState: 'idle' };
    case 'close':
      return { ...state, connectionState: 'closed' };
  }
}

export type BookRunEventsClientProps = {
  readonly eventsUrl: string;
  readonly initialEvents?: readonly BookRunEventSnapshot[];
};

export function BookRunEventsClient({
  eventsUrl,
  initialEvents = [],
}: BookRunEventsClientProps) {
  const [events, setEvents] = useState<readonly BookRunEventSnapshot[]>(() =>
    initialEvents.slice(-MAX_LIVE_EVENTS),
  );
  const [eventSourceState, setEventSourceState] = useState<BookRunEventSourceState>(() => ({
    connectionState: eventsUrl ? 'connecting' : 'idle',
    retryCount: 0,
  }));

  useEffect(() => {
    setEvents(initialEvents.slice(-MAX_LIVE_EVENTS));
  }, [initialEvents]);

  useEffect(() => {
    if (!eventsUrl) {
      setEventSourceState((state) => reduceBookRunEventSourceState(state, { type: 'idle' }));
      return undefined;
    }

    setEventSourceState((state) => reduceBookRunEventSourceState(state, { type: 'connect' }));
    const eventSource = new EventSource(eventsUrl);

    const appendEvent = (event: MessageEvent<string>) => {
      const parsed = parseBookRunEvent(event.type, event.data);
      if (!parsed) return;
      setEvents((current) => [...current, parsed].slice(-MAX_LIVE_EVENTS));
      setEventSourceState((state) => reduceBookRunEventSourceState(state, { type: 'event' }));
    };

    const markOpen = () =>
      setEventSourceState((state) => reduceBookRunEventSourceState(state, { type: 'open' }));
    const markReconnecting = () =>
      setEventSourceState((state) => reduceBookRunEventSourceState(state, { type: 'error' }));

    eventSource.addEventListener('open', markOpen);
    eventSource.addEventListener('error', markReconnecting);
    for (const eventName of ['progress', 'checkpoint', 'blocked', 'budget', 'provider_fallback', 'completed']) {
      eventSource.addEventListener(eventName, appendEvent as EventListener);
    }

    return () => {
      eventSource.close();
      setEventSourceState((state) => reduceBookRunEventSourceState(state, { type: 'close' }));
    };
  }, [eventsUrl, initialEvents]);

  const latestEvents = useMemo(() => events.slice(-5), [events]);

  return (
    <section
      aria-label="BookRun EventSource 实时事件"
      className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-3 text-emerald-50"
      data-eventsource-client="book-run"
      data-events-url={eventsUrl}
      data-connection-state={eventSourceState.connectionState}
      data-retry-count={eventSourceState.retryCount}
      data-live-event-count={events.length}
      data-initial-event-count={initialEvents.length}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">EventSource 实时连接</h3>
        <span className="font-mono text-xs text-emerald-200">{eventSourceState.connectionState}</span>
      </div>
      <p className="mt-2 text-xs text-emerald-200/80">
        浏览器原生 EventSource 会在断线后自动重连；当前重连观察次数：{eventSourceState.retryCount}。
      </p>
      {latestEvents.length === 0 ? (
        <p className="mt-3 rounded border border-dashed border-emerald-900 p-2 text-sm text-emerald-100/70">
          等待实时 SSE 事件
        </p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm text-emerald-100">
          {latestEvents.map((event, index) => (
            <li key={`${event.event}:${index}`} data-live-run-event={event.event}>
              <span className="mr-2 rounded bg-emerald-900 px-2 py-0.5 font-mono text-xs">
                {event.event}
              </span>
              {JSON.stringify(event.data)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function parseBookRunEvent(event: string, data: string): BookRunEventSnapshot | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { event, data: parsed as Record<string, unknown> };
  } catch {
    return null;
  }
}
