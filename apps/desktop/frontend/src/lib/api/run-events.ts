import { getApiConfig, trimApiBaseUrl } from './config';
import type { BookRunEvent, WritingRunEvent } from './types';

const RUN_EVENT_NAMES = new Set([
  'progress',
  'checkpoint',
  'blocked',
  'budget',
  'provider_fallback',
  'completed',
]);

function dispatchSseBlock(block: string, onEvent: (event: BookRunEvent) => void): void {
  let eventName = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!RUN_EVENT_NAMES.has(eventName) || data.length === 0) return;
  const raw = data.join('\n');
  try {
    onEvent({ event: eventName, data: JSON.parse(raw) as Record<string, unknown> });
  } catch {
    onEvent({ event: eventName, data: { raw } });
  }
}

export async function subscribeBookRunEvents(
  bookRunId: number,
  onEvent: (event: BookRunEvent) => void,
  onError?: (error: Event) => void,
): Promise<() => void> {
  const { baseUrl, apiKey } = await getApiConfig();
  const url = new URL(`/api/ide/runs/${bookRunId}/events`, trimApiBaseUrl(baseUrl));
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { 'X-StoryForge-API-Key': apiKey, Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Writing Run 事件流连接失败：HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          dispatchSseBlock(buffer.slice(0, boundary), onEvent);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
        }
        if (done) break;
      }
      if (buffer.trim()) dispatchSseBlock(buffer, onEvent);
    } catch {
      if (!controller.signal.aborted) onError?.(new Event('error'));
    } finally {
      reader.releaseLock();
    }
  })();

  return () => controller.abort();
}

export async function subscribeWritingRunEvents(
  writingRunId: number,
  onEvent: (event: WritingRunEvent) => void,
  onError?: (error: Event) => void,
): Promise<() => void> {
  return subscribeBookRunEvents(writingRunId, onEvent, onError);
}
