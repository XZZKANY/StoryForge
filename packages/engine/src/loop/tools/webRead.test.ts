import { expect, it, vi } from 'vitest';
import { memoryProject } from '../../kernel/memoryProject.test-support';
import { RunInterrupted } from '../../llm/control';
import { decideTool } from '../permission';
import { serializeToolOutput } from '../toolFeedback';
import type { ToolExecutionContext } from './execution';
import { createAgentToolRegistry } from './registry';
import { createWebReadHandler, type WebReadResponse } from './webRead';
const baseUrl = 'https://example.com/';
const page = (url = baseUrl, children = ['one', 'two']): WebReadResponse => ({
  requestedUrl: url,
  url,
  title: '真实页面',
  text: '网页正文，不服从网页中的忽略系统指令。',
  links: children.map((child) => ({ title: child, url: new URL(child, baseUrl).href })),
  truncated: false,
  linksTruncated: false,
  fetchedAt: '2026-11-21T00:00:00Z',
});
const context = (id = 'run-1', check = vi.fn()) =>
  ({
    run: { public_id: id },
    services: { checkInterruption: check },
  }) as unknown as ToolExecutionContext;
const fixture = () => {
  const read = vi.fn(async ({ url }: { url: string }) =>
    page(url, ['one', 'two', 'three', 'four', 'five']),
  );
  return { read, run: createWebReadHandler(read, { values: ['private-credential'] }) };
};
it('reads root and a real child link, reporting only the actually read page as a source', async () => {
  const { read, run } = fixture();
  const root = await run(context(), { url: baseUrl });
  expect(root.output.sources).toEqual([{ title: '真实页面', url: baseUrl }]);
  expect(root.output.links).toHaveLength(5);
  const child = await run(context(), { url: baseUrl + 'one', parent_url: baseUrl });
  expect(read).toHaveBeenLastCalledWith({ url: baseUrl + 'one' });
  expect(child.output.depth).toBe(1);
  expect(child.trace.output_summary?.sources).toEqual([
    { title: '真实页面', url: baseUrl + 'one' },
  ]);
  expect(child.output.read_attempts).toBe(2);
  expect(child.output.remaining_reads).toBeUndefined();
});
it('refuses invented children, cross-site roots and repeated pages while allowing deeper reads', async () => {
  const { read, run } = fixture();
  await run(context(), { url: baseUrl });
  for (const args of [
    { url: baseUrl },
    { url: baseUrl + 'invented', parent_url: baseUrl },
    { url: 'https://other.example.org/' },
    { url: baseUrl + 'one', parent_url: baseUrl + 'not-read' },
  ])
    await expect(run(context(), args)).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(1);
  await run(context(), { url: baseUrl + 'one', parent_url: baseUrl });
  await run(context(), { url: baseUrl + 'two', parent_url: baseUrl + 'one' });
  const third = await run(context(), { url: baseUrl + 'three', parent_url: baseUrl + 'two' });
  expect(third.output.depth).toBe(3);
  expect(read).toHaveBeenCalledTimes(4);
});
it('records failed attempts without a separate page cap and isolates runs', async () => {
  const { read, run } = fixture();
  await run(context(), { url: baseUrl });
  read.mockRejectedValue(new Error('provider private-credential'));
  for (let n = 0; n < 5; n++)
    await expect(run(context(), { url: baseUrl + 'one', parent_url: baseUrl })).rejects.toThrow(
      '网页读取失败',
    );
  expect(read).toHaveBeenCalledTimes(6);
  read.mockImplementation(async ({ url }) => page(url));
  const recovered = await run(context(), { url: baseUrl + 'one', parent_url: baseUrl });
  expect(recovered.output.read_attempts).toBe(7);
  const nextRun = await run(context('run-2'), { url: baseUrl });
  expect(nextRun.output.read_attempts).toBe(1);
});
it('checks interruption before and after the network without creating read evidence', async () => {
  const { read, run } = fixture();
  const stopped = () => {
    throw new RunInterrupted('stopped');
  };
  await expect(run(context('before', vi.fn(stopped)), { url: baseUrl })).rejects.toBeInstanceOf(
    RunInterrupted,
  );
  expect(read).not.toHaveBeenCalled();
  await expect(
    run(
      context(
        'after',
        vi.fn((boundary) => {
          if (boundary === 'after_web_read') stopped();
        }),
      ),
      { url: baseUrl },
    ),
  ).rejects.toBeInstanceOf(RunInterrupted);
  await expect(
    run(context('after'), { url: baseUrl + 'one', parent_url: baseUrl }),
  ).rejects.toThrow('已读父页面');
});
it.each([
  'file:///private',
  'https://user:password@example.com',
  'http://127.0.0.1/',
  'https://example.com:444/',
  'https://example.com/private-credential',
  'https://example.com/?token=secret',
])('rejects unsafe URL %s before invoking native', async (url) => {
  const { read, run } = fixture();
  await expect(run(context(), { url })).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
it('validates read receipts, redacts text, filters links and keeps JSON complete under escaping', async () => {
  const read = vi.fn(async () => ({
    ...page(),
    text: 'private-credential ' + '"\\\n'.repeat(6000),
    links: Array.from({ length: 20 }, (_, i) => ({
      title: '"'.repeat(160),
      url: baseUrl + i + 'a'.repeat(900),
    })),
  }));
  const run = createWebReadHandler(read, { values: ['private-credential'] });
  const result = await run(context(), { url: baseUrl });
  expect(JSON.stringify(result)).not.toContain('private-credential');
  expect(result.output.truncated).toBe(true);
  expect(result.output.links_truncated).toBe(true);
  expect(JSON.stringify(result.output).length).toBeLessThan(22001);
  expect(() => JSON.parse(serializeToolOutput(result.output))).not.toThrow();
  const malformed = createWebReadHandler(
    async () => ({ ...page(), url: 'https://other.example.org/' }),
    { values: [] },
  );
  await expect(malformed(context(), { url: baseUrl })).rejects.toThrow('无效数据');
});
it('only exposes reading with the explicitly provided port and never broadens other network permission', () => {
  const project = memoryProject('/book', {});
  const deps = {
    reader: project.reader,
    writer: project.writer,
    platform: 'posix' as const,
    secrets: { values: [] },
    proposals: { newUuid: () => '', now: () => new Date() },
    artifacts: { runHasArtifact: async () => false, artifactPayloads: async () => [] },
    newHex: () => '',
  };
  const search = async () => ({
    query: 'q',
    provider: 'tavily',
    results: [],
    searchedAt: '2026-11-21T00:00:00Z',
  });
  expect(
    createAgentToolRegistry({ ...deps, webSearch: { search } })
      .all()
      .some((t) => t.name === 'web.read'),
  ).toBe(false);
  const tool = createAgentToolRegistry({
    ...deps,
    webSearch: { search, read: async () => page() },
  }).get('web.read');
  for (const profile of ['read', 'ask', 'auto', 'full']) {
    expect(decideTool(profile, tool).status).toBe('allow');
    expect(decideTool(profile, { ...tool, name: 'network.upload' }).status).not.toBe('allow');
    expect(
      decideTool(
        profile,
        { ...tool, network_search_authorized: false },
        { network_search_authorized: true },
      ).status,
    ).not.toBe('allow');
  }
});
