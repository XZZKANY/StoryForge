import { getApiConfig, trimApiBaseUrl } from './config';
import type { BookRunEvent, WritingRunEvent } from './types';

const API_KEY_HEADER = 'X-StoryForge-API-Key';
const SSE_EVENT_NAMES = [
  'progress',
  'checkpoint',
  'blocked',
  'budget',
  'provider_fallback',
  'completed',
];

type SseFrame = {
  event: string;
  data: string;
};

function parseSseFrame(rawFrame: string): SseFrame | null {
  let event = 'message';
  const data: string[] = [];
  for (const rawLine of rawFrame.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trimStart();
    } else if (line.startsWith('data:')) {
      data.push(line.slice('data:'.length).trimStart());
    }
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

export function parseBookRunSseText(text: string): BookRunEvent[] {
  return text
    .split(/\r?\n\r?\n/)
    .map(parseSseFrame)
    .filter((frame): frame is SseFrame => frame !== null && SSE_EVENT_NAMES.includes(frame.event))
    .map((frame) => {
      try {
        return {
          event: frame.event,
          data: JSON.parse(frame.data) as Record<string, unknown>,
        } as BookRunEvent;
      } catch {
        return { event: frame.event, data: { raw: frame.data } } as BookRunEvent;
      }
    });
}

export async function subscribeBookRunEvents(
  bookRunId: number,
  onEvent: (event: BookRunEvent) => void,
  onError?: (error: Event) => void,
): Promise<() => void> {
  const { baseUrl, apiKey } = await getApiConfig();
  const url = new URL(`/api/ide/runs/${bookRunId}/events`, trimApiBaseUrl(baseUrl));
  const controller = new AbortController();
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      [API_KEY_HEADER]: apiKey,
    },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`写作任务事件订阅失败：HTTP ${response.status}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  void (async () => {
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          for (const event of parseBookRunSseText(`${part}\n\n`)) {
            onEvent(event);
          }
        }
      }
      buffer += decoder.decode();
      for (const event of parseBookRunSseText(buffer)) {
        onEvent(event);
      }
    } catch {
      if (!controller.signal.aborted) onError?.(new Event('error'));
    }
  })();

  return () => {
    controller.abort();
    void reader.cancel().catch(() => undefined);
  };
}

export async function subscribeWritingRunEvents(
  writingRunId: number,
  onEvent: (event: WritingRunEvent) => void,
  onError?: (error: Event) => void,
): Promise<() => void> {
  return subscribeBookRunEvents(writingRunId, onEvent, onError);
}
