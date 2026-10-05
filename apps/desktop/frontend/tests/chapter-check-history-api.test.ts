import { afterEach, expect, test, vi } from 'vitest';
import { queryChapterCheckHistory } from '../src/lib/api/chapter-checks';

vi.mock('../src/lib/api/config', () => ({
  getApiConfig: async () => ({ baseUrl: 'http://owned.test///', apiKey: 'synthetic-history-key' }),
  trimApiBaseUrl: (url: string) => url.replace(/\/+$/, ''),
}));

const request = { project_root: 'D:/novel', assistant_session_id: 7, limit: 20 };
afterEach(() => vi.unstubAllGlobals());

test('history read uses the generated request, scoped envelope and cancellable authenticated transport', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ...request, entries: [], truncated: false })));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  expect(await queryChapterCheckHistory(request, { signal: controller.signal })).toEqual({
    entries: [],
    truncated: false,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('http://owned.test/api/agent-runs/chapter-checks/query', {
    method: 'POST',
    signal: controller.signal,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-StoryForge-API-Key': 'synthetic-history-key',
    },
    body: JSON.stringify(request),
  });
});

test('HTTP failure is explicit and never retries execution', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ detail: '项目不属于此会话' }), { status: 409 }),
    );
  vi.stubGlobal('fetch', fetch);
  await expect(queryChapterCheckHistory(request)).rejects.toThrow('项目不属于此会话');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('unbound success and invalid JSON are not silently treated as empty history', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...request, assistant_session_id: 8, entries: [], truncated: false }),
      ),
    )
    .mockResolvedValueOnce(new Response('not-json'));
  vi.stubGlobal('fetch', fetch);
  await expect(queryChapterCheckHistory(request)).rejects.toThrow('归属');
  await expect(queryChapterCheckHistory(request)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
});
