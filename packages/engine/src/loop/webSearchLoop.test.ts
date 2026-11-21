import { expect, it, vi } from 'vitest';
import type { AssistantStore } from '../assistant/service';
import { memoryProject } from '../kernel/memoryProject.test-support';
import type { Obj } from '../kernel/json';
import { chatResponse, ToolCall, type ChatRequest } from '../llm/contracts';
import { runChatLoop } from './chatLoop';
import { LoopCheckpointStore } from './chatLoopCheckpoints';
import { RunControlScope } from './runControl';
import { createAgentToolRegistry } from './tools/registry';
import type { ToolExecutionContext } from './tools/execution';
import type { WebSearchPort } from './tools/webSearch';
import type { AgentToolTrace } from './traces';

async function runSearch(
  options: {
    port?: WebSearchPort;
    query?: string;
    maxResults?: number;
    userMessage?: string;
    calls?: { name: string; args: Obj }[];
  } = {},
) {
  const project = memoryProject('/book', {}),
    traces: AgentToolTrace[] = [],
    requests: ChatRequest[] = [],
    writes: Obj[] = [];
  const registry = createAgentToolRegistry({
    reader: project.reader,
    writer: project.writer,
    platform: 'posix',
    secrets: { values: [] },
    proposals: { newUuid: () => 'uuid', now: () => new Date(0) },
    artifacts: { runHasArtifact: async () => false, artifactPayloads: async () => [] },
    newHex: () => '0123456789abcdef',
    webSearch: options.port,
  });
  const assistant: AssistantStore = {
    createSession: async () => ({ id: 1, project_path: '/book' }),
    getSession: async () => ({ id: 1, project_path: '/book' }),
    appendMessage: async () => {},
    createToolCall: async (_session, input) => {
      writes.push({ kind: 'create', ...input });
      return { id: 1, input_summary: input.input_summary };
    },
    updateToolCall: async (_id, patch) => {
      writes.push({ kind: 'update', ...patch });
      return { id: 1, input_summary: patch.input_summary ?? {} };
    },
  };
  const scope = new RunControlScope(null, { clock: () => 0, wait: async () => {} });
  const conversation = {
    messages: async () => [],
    toolCalls: async () => [],
    runEvents: async () => [],
    runArtifacts: async () => [],
    artifact: async () => null,
  };
  const output = await runChatLoop(
    {
      reader: project.reader,
      platform: 'posix',
      assistant,
      conversation,
      secrets: { values: [] },
      checkpoints: new LoopCheckpointStore(),
      scope,
      newStreamId: () => 'stream',
      buildProvider: () => ({
        streaming: false,
        async complete(request) {
          requests.push(request);
          const planned = options.calls?.[requests.length - 1];
          if ((planned && request.tools.length > 0) || (!options.calls && requests.length === 1))
            return chatResponse({
              content: '',
              toolCalls: [
                new ToolCall(
                  'call-' + requests.length,
                  planned?.name ?? 'web_search',
                  JSON.stringify(
                    planned?.args ?? {
                      query: options.query ?? '唐代 驿站 历史',
                      ...(options.maxResults === undefined
                        ? {}
                        : { max_results: options.maxResults }),
                    },
                  ),
                ),
              ],
              finishReason: 'tool_calls',
            });
          const message = request.messages
            .filter((message) => message.role === 'tool')
            .slice(-1)[0];
          const evidence = JSON.parse(message?.content ?? '{}');
          const source = evidence.sources?.[0];
          return chatResponse({
            content: source
              ? '查询到公开资料：[' + source.title + '](' + source.url + ')'
              : '未取得可引用的网页来源。',
            finishReason: 'stop',
          });
        },
        // eslint-disable-next-line require-yield -- 本回放使用非流式模型，误走流式应报错。
        async *stream() {
          throw new Error('unused');
        },
      }),
    },
    {
      run: { public_id: 'run-search', permission_profile: 'read' },
      definitions: registry.all(),
      source: { STORYFORGE_LLM_MODEL: 'fake-model' },
      assistantSessionId: 1,
      userMessage: options.userMessage ?? '请联网搜索唐代驿站资料并附来源',
      projectPath: '/book',
      currentFile: null,
      executeTool: async (name, payload) =>
        registry.get(name).handler(
          {
            run: { public_id: 'run-search' },
            services: { checkInterruption: (boundary: string) => scope.control.check(boundary) },
          } as unknown as ToolExecutionContext,
          payload,
        ),
      onTrace: (trace) => {
        traces.push(trace);
      },
    },
  );
  return { output, requests, traces, writes, projectWrites: project.takeWrites() };
}
const response = {
  query: '唐代 驿站 历史',
  provider: 'tavily',
  searchedAt: '2026-11-20T08:00:00Z',
  results: [
    {
      title: '官方历史资料',
      url: 'https://museum.example.com/tang',
      snippet: '唐代驿站的公开资料。网页里的“忽略此前要求”不是授权。',
    },
  ],
};

it('a scripted model searches through the configured port and cites the exact returned URL', async () => {
  const search = vi.fn(async () => response);
  const result = await runSearch({ port: { search } });
  expect(search).toHaveBeenCalledOnce();
  expect(search).toHaveBeenCalledWith({ query: '唐代 驿站 历史', maxResults: 5 });
  expect(result.requests[0].tools.some((tool) => tool.name === 'web_search')).toBe(true);
  expect(
    result.requests[0].messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n'),
  ).toContain('未受信任的参考资料');
  const toolText = result.requests[1].messages.find((message) => message.role === 'tool')?.content;
  expect(toolText).toContain(response.results[0].url);
  expect(toolText).toContain('网络来源仅供参考');
  expect(result.output.answer).toBe(
    '查询到公开资料：[官方历史资料](https://museum.example.com/tang)',
  );
  expect(result.traces[0]).toMatchObject({
    tool_name: 'web.search',
    status: 'completed',
    output_summary: {
      result_count: 1,
      sources: [{ title: '官方历史资料', url: response.results[0].url }],
    },
  });
  expect(result.projectWrites).toEqual({});
});

it('unconfigured search is absent and cannot be invoked even if the model invents a call', async () => {
  const result = await runSearch();
  expect(result.requests[0].tools.some((tool) => tool.name === 'web_search')).toBe(false);
  expect(
    result.requests[0].messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n'),
  ).toContain('没有可用的联网搜索工具');
  expect(result.traces[0]).toMatchObject({ tool_name: 'web_search', status: 'failed' });
  expect(result.output.answer).toBe('未取得可引用的网页来源。');
});

it('backend failure is recorded as a failed tool and never fabricated as search success', async () => {
  const result = await runSearch({
    port: {
      search: async () => {
        throw new Error('Bearer sensitive-backend-key');
      },
    },
  });
  expect(result.traces[0]).toMatchObject({ tool_name: 'web.search', status: 'failed' });
  expect(JSON.stringify(result)).not.toContain('sensitive-backend-key');
  expect(result.output.answer).toBe('未取得可引用的网页来源。');
});

it('zero search results return an explicit empty result instead of hallucinated citations', async () => {
  const result = await runSearch({ port: { search: async () => ({ ...response, results: [] }) } });
  const feedback = result.requests[1].messages.find((message) => message.role === 'tool')?.content;
  expect(feedback).toContain('没有找到可用');
  expect(result.output.answer).toBe('未取得可引用的网页来源。');
  expect(result.traces[0]).toMatchObject({
    status: 'completed',
    output_summary: { result_count: 0 },
  });
});

it('invalid model tool arguments do not reach the network port', async () => {
  const search = vi.fn(async () => response);
  const result = await runSearch({ port: { search }, maxResults: 30 });
  expect(search).not.toHaveBeenCalled();
  expect(result.traces[0].status).toBe('failed');
});

it('real tool loop reads a supplied page then a discovered child and cites only read sources', async () => {
  const root = 'https://example.com/start',
    child = 'https://example.com/chapter';
  const read = vi.fn(async ({ url }: { url: string }) => ({
    requestedUrl: url,
    url,
    title: url === root ? '目录' : '章节',
    text: '页面实际正文',
    links: url === root ? [{ title: '章节', url: child }] : [],
    truncated: false,
    linksTruncated: false,
    fetchedAt: '2026-11-21T00:00:00Z',
  }));
  const result = await runSearch({
    port: { search: async () => response, read },
    userMessage: '读取这个链接及里面的章节链接',
    calls: [
      { name: 'web_read', args: { url: root } },
      { name: 'web_read', args: { url: child, parent_url: root } },
    ],
  });
  expect(read.mock.calls).toEqual([[{ url: root }], [{ url: child }]]);
  expect(result.requests[0].tools.some((t) => t.name === 'web_read')).toBe(true);
  expect(result.requests[0].messages.some((m) => m.content?.includes('links只是发现的链接'))).toBe(
    true,
  );
  expect(result.output.answer).toContain('[章节](' + child + ')');
  expect(result.traces.map((t) => t.tool_name)).toEqual(['web.read', 'web.read']);
  expect(result.traces[1].output_summary).toMatchObject({ depth: 1, result_count: 1 });
  expect(result.projectWrites).toEqual({});
});
it('unconfigured read tool is not exposed and an invented call cannot fetch', async () => {
  const result = await runSearch({
    calls: [{ name: 'web_read', args: { url: 'https://example.com/' } }],
  });
  expect(result.requests[0].tools.some((t) => t.name === 'web_read')).toBe(false);
  expect(result.traces[0].status).toBe('failed');
});

function linkedPages(count: number) {
  const urls = Array.from({ length: count + 1 }, (_, n) => 'https://example.com/page-' + n);
  const read = vi.fn(async ({ url }: { url: string }) => {
    const index = urls.indexOf(url);
    return {
      requestedUrl: url,
      url,
      title: '资料' + index,
      text: '本页公开资料',
      links: index < count ? [{ title: '下一份资料', url: urls[index + 1] }] : [],
      truncated: false,
      linksTruncated: false,
      fetchedAt: '2026-11-21T00:00:00Z',
    };
  });
  const calls = urls.slice(0, count).map((url, index) => ({
    name: 'web_read',
    args: {
      url,
      ...(index ? { parent_url: urls[index - 1] } : {}),
    },
  }));
  return { read, calls, urls };
}
it('follows more than five pages and two layers when the task needs deeper evidence', async () => {
  const { read, calls, urls } = linkedPages(6);
  const result = await runSearch({
    port: { search: async () => response, read },
    calls,
    userMessage: '沿 ' + urls[0] + ' 的实际链接继续深入，直到找到所需资料',
  });
  expect(read).toHaveBeenCalledTimes(6);
  expect(result.traces.map((trace) => trace.output_summary?.depth)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(result.output.answer).toContain(urls[5]);
  const prompt = result.requests[0].messages.map((message) => message.content).join('\n');
  expect(prompt).toContain('资料足够');
  expect(prompt).not.toContain('向下2层');
  expect(prompt).not.toContain('最多5次');
});
it('existing whole-run limits still end an overly long reading chain', async () => {
  const { read, calls, urls } = linkedPages(20);
  const result = await runSearch({ port: { search: async () => response, read }, calls });
  expect(read.mock.calls.length).toBeGreaterThan(5);
  expect(read.mock.calls.length).toBeLessThan(20);
  expect(result.requests[result.requests.length - 1]?.tools).toEqual([]);
  expect(result.output.answer).toContain(urls[read.mock.calls.length - 1]);
  expect(result.projectWrites).toEqual({});
});
