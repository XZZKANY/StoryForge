import { afterEach, expect, it, vi } from 'vitest';
import { executeIdeCommand } from '../src/lib/api/ide-commands';

const engine = vi.hoisted(() => ({ initialized: vi.fn(), io: vi.fn() }));
vi.mock('@storyforge/engine', () => {
  engine.initialized();
  return {};
});
vi.mock('../src/lib/engine/reader', () => {
  engine.initialized();
  return { nativeProjectReader: engine.io };
});
vi.mock('../src/lib/api/config', () => ({
  getApiConfig: async () => ({
    baseUrl: 'http://synthetic-api.invalid///',
    apiKey: 'synthetic-transport-key',
  }),
  trimApiBaseUrl: (url: string) => url.replace(/\/+$/, ''),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it.each(['python', 'ts', 'shadow'])(
  'unadmitted %s requests keep the original single Python transport with zero engine initialization',
  async (mode) => {
    localStorage.setItem('engine.ideCommands', mode);
    const args = { project_root: 'D:/synthetic-book', current_file: '正文/next.md' };
    const response = { status: 'accepted', payload: { prompt_block: 'synthetic' } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await executeIdeCommand('book.context', args)).toEqual(response);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://synthetic-api.invalid/api/ide/commands/book.context',
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          'X-StoryForge-API-Key': 'synthetic-transport-key',
        },
        body: JSON.stringify({ args }),
      },
    );
    expect(engine.initialized).not.toHaveBeenCalled();
    expect(engine.io).not.toHaveBeenCalled();
  },
);

it('unknown ids still reach the existing Python rejection and are not retried', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ detail: 'controlled unknown command' }), { status: 404 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await expect(executeIdeCommand('unknown/command', {})).rejects.toThrow(
    'controlled unknown command',
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]).toBeDefined();
  expect(engine.initialized).not.toHaveBeenCalled();
});
