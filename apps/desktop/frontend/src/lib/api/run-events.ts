import { getApiConfig, trimApiBaseUrl } from './config';
import type { BookRunEvent, WritingRunEvent } from './types';

export async function subscribeBookRunEvents(
  bookRunId: number,
  onEvent: (event: BookRunEvent) => void,
  onError?: (error: Event) => void,
): Promise<() => void> {
  const { baseUrl } = await getApiConfig();
  const url = new URL(`/api/ide/runs/${bookRunId}/events`, trimApiBaseUrl(baseUrl));
  const source = new EventSource(url.toString());
  const eventNames = [
    'progress',
    'checkpoint',
    'blocked',
    'budget',
    'provider_fallback',
    'completed',
  ];
  const listeners = eventNames.map((eventName) => {
    const listener = (event: MessageEvent) => {
      try {
        onEvent({
          event: eventName,
          data: JSON.parse(String(event.data)) as Record<string, unknown>,
        });
      } catch {
        onEvent({ event: eventName, data: { raw: String(event.data) } });
      }
    };
    source.addEventListener(eventName, listener);
    return { eventName, listener };
  });
  if (onError) source.onerror = onError;
  return () => {
    for (const item of listeners) {
      source.removeEventListener(item.eventName, item.listener);
    }
    source.close();
  };
}

export async function subscribeWritingRunEvents(
  writingRunId: number,
  onEvent: (event: WritingRunEvent) => void,
  onError?: (error: Event) => void,
): Promise<() => void> {
  return subscribeBookRunEvents(writingRunId, onEvent, onError);
}
