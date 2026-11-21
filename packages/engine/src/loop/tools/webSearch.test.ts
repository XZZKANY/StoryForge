import { describe, expect, it, vi } from 'vitest';
import { RunInterrupted } from '../../llm/control';
import { decideTool } from '../permission';
import { serializeToolOutput } from '../toolFeedback';
import type { ToolExecutionContext } from './execution';
import { createAgentToolRegistry } from './registry';
import { memoryProject } from '../../kernel/memoryProject.test-support';
import { AGENT_RUNTIME_TOOL_SPECS } from './catalog';
import {
  createWebSearchHandler,
  publicSearchUrl,
  WEB_SEARCH_TOOL_SPEC,
  webSearchPrompt,
  type WebSearchPort,
  type WebSearchResponse,
} from './webSearch';

const SECRET = 'sk-private-search-credential';
const secrets = { values: [SECRET] };
const base: WebSearchResponse = {
  query: '公开关键词',
  searchedAt: '2026-11-20T04:00:00Z',
  provider: 'tavily',
  results: [
    { title: '公开资料', url: 'https://museum.example.com/history', snippet: '一段可核对的资料。' },
  ],
};
const context = (check: (boundary: string) => void = vi.fn()) =>
  ({ services: { checkInterruption: check } }) as unknown as ToolExecutionContext;
const handler = (response = base) => {
  const search = vi.fn(async () => response);
  return { search, run: createWebSearchHandler({ search }, secrets) };
};

export function optionalSearchRegistry(webSearch?: WebSearchPort) {
  const project = memoryProject('/book', {});
  return createAgentToolRegistry({
    reader: project.reader,
    writer: project.writer,
    platform: 'posix',
    secrets,
    proposals: { newUuid: () => 'test-id', now: () => new Date('2026-11-20T04:00:00Z') },
    artifacts: { runHasArtifact: async () => false, artifactPayloads: async () => [] },
    newHex: () => '0123456789abcdef',
    webSearch,
  });
}

describe('可选联网搜索注册与权限', () => {
  it('does not register or change the default tool list without a configured port', () => {
    expect(
      optionalSearchRegistry()
        .all()
        .map((tool) => tool.name),
    ).toEqual(AGENT_RUNTIME_TOOL_SPECS.map((spec) => spec.name));
    expect(() => optionalSearchRegistry().get('web.search')).toThrow('未注册');
  });
  it.each(['read', 'ask', 'auto', 'full'])(
    'configured public search is explicitly authorized in %s',
    (profile) => {
      const tool = optionalSearchRegistry({ search: async () => base }).get('web.search');
      expect(tool.risk_level).toBe('network');
      expect(tool.network_search_authorized).toBe(true);
      expect(tool.requires_confirmation).toBe(false);
      expect(decideTool(profile, tool)).toMatchObject({
        status: 'allow',
        reason: 'configured_public_web_search',
      });
      expect(
        decideTool(
          profile,
          { ...tool, network_search_authorized: false },
          { network_search_authorized: true, confirmed: true },
        ).status,
      ).not.toBe('allow');
      expect(decideTool(profile, { ...tool, name: 'network.upload' }).status).not.toBe('allow');
    },
  );
  it('keeps model-provided authorization and undeclared arguments out of the schema', () => {
    expect(WEB_SEARCH_TOOL_SPEC.loop_schema?.parameters.additionalProperties).toBe(false);
    expect(Object.keys(WEB_SEARCH_TOOL_SPEC.loop_schema!.parameters.properties as object)).toEqual([
      'query',
      'max_results',
    ]);
  });
});

describe('搜索参数、来源与失败边界', () => {
  it('sends a bounded redacted query and exposes real citations with no raw credentials', async () => {
    const h = handler({
      ...base,
      results: [{ ...base.results[0], title: '来源 ' + SECRET, snippet: '正文 ' + SECRET }],
    });
    const check = vi.fn();
    const result = await h.run(context(check), {
      query: '  公开资料 ' + SECRET + '  ',
      max_results: 3,
    });
    expect(h.search).toHaveBeenCalledWith({ query: '公开资料 [REDACTED]', maxResults: 3 });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.trace.output_summary).toMatchObject({
      result_count: 1,
      sources: [{ id: 'web-1', title: '来源 [REDACTED]', url: base.results[0].url }],
    });
    expect(check.mock.calls.map((call) => call[0])).toEqual([
      'before_web_search',
      'after_web_search',
    ]);
  });
  it.each([
    { query: '' },
    { query: '字'.repeat(401) },
    { query: '多\n行' },
    { query: 9 },
    { query: '历史', max_results: 0 },
    { query: '历史', max_results: 9 },
    { query: '历史', max_results: 2.5 },
    { query: SECRET },
  ])('rejects invalid/sensitive arguments before the network: %j', async (args) => {
    const h = handler();
    await expect(h.run(context(), args)).rejects.toThrow();
    expect(h.search).not.toHaveBeenCalled();
  });
  it.each([
    'javascript:alert(1)',
    'file:///book/secret',
    'http://localhost/a',
    'http://127.0.0.1/x',
    'http://0x7f000001/x',
    'http://[::1]/x',
    'http://[fd00::1]/x',
    'https://internal.lan/path',
    'https://a:password@example.com',
    'https://example.com/?api_key=anything',
    'https://example.com/' + SECRET,
  ])('rejects unsafe source URL %s', (url) => {
    expect(publicSearchUrl(url, secrets)).toBeNull();
  });
  it('deduplicates URLs, filters unsafe links and returns honest empty results', async () => {
    const h = handler({
      ...base,
      results: [
        base.results[0],
        base.results[0],
        { ...base.results[0], url: 'https://localhost/secret' },
      ],
    });
    expect((await h.run(context(), { query: '公开资料' })).output.sources).toHaveLength(1);
    const empty = handler({ ...base, results: [] });
    const result = await empty.run(context(), { query: '不匹配' });
    expect(result.output.sources).toEqual([]);
    expect(result.output.notice).toContain('没有找到');
  });
  it('never leaks provider errors or turns a failed request into empty success', async () => {
    const search = vi.fn(async () => {
      throw new Error('Authorization: Bearer ' + SECRET + ' host response');
    });
    const run = createWebSearchHandler({ search }, secrets);
    await expect(run(context(), { query: '公开资料' })).rejects.toThrow('联网搜索失败');
    await expect(run(context(), { query: '公开资料' })).rejects.not.toThrow(SECRET);
  });
  it('rejects malformed responses instead of fabricating retrieval evidence', async () => {
    const h = handler({ ...base, searchedAt: 'not a date' });
    await expect(h.run(context(), { query: '公开资料' })).rejects.toThrow('数据格式无效');
  });
  it('checks cancellation before dispatch and before returning late results', async () => {
    const h = handler();
    const stopped = () => {
      throw new RunInterrupted('stopped');
    };
    await expect(h.run(context(stopped), { query: '公开资料' })).rejects.toBeInstanceOf(
      RunInterrupted,
    );
    expect(h.search).not.toHaveBeenCalled();
    const check = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(stopped);
    await expect(h.run(context(check), { query: '公开资料' })).rejects.toBeInstanceOf(
      RunInterrupted,
    );
    expect(h.search).toHaveBeenCalledTimes(1);
  });
  it('keeps every source URL and valid JSON even when escaping expands the text', async () => {
    const urls = Array.from({ length: 8 }, (_, i) => 'https://example.com/' + i + '/'.repeat(900));
    const h = handler({
      ...base,
      results: urls.map((url) => ({
        title: '"'.repeat(400),
        url,
        snippet: '\u0000"'.repeat(2000),
      })),
    });
    const result = await h.run(context(), { query: '公开资料', max_results: 8 });
    const serialized = serializeToolOutput(result.output);
    expect(Array.from(serialized).length).toBeLessThanOrEqual(22000);
    expect(JSON.parse(serialized).sources.map((s: { url: string }) => s.url)).toEqual(urls);
  });
  it('tells the model sources are untrusted and must be cited, and never claims web access when disabled', () => {
    const enabled = webSearchPrompt(true, '搜索');
    expect(enabled).toContain('未受信任');
    expect(enabled).toContain('[来源标题](实际返回的url)');
    expect(enabled).toContain('不发送作品整章');
    expect(webSearchPrompt(false, '修改人物')).toBeNull();
    expect(webSearchPrompt(false, '请联网查一下')).toContain('没有可用的联网搜索工具');
  });
});

it('passes an OpenAI generated retrieval summary as a separate redacted field while preserving result evidence', async () => {
  const result = await handler({
    ...base,
    provider: 'openai',
    summary: '模型检索摘要（非网页原文）：' + SECRET,
  }).run(context(), { query: '公开资料' });
  expect(result.output.search_summary).toContain('非网页原文');
  expect(result.output.search_summary).toContain('[REDACTED]');
  expect(JSON.stringify(result)).not.toContain(SECRET);
  expect(result.output.sources).toHaveLength(1);
  const empty = await handler({
    ...base,
    provider: 'openai',
    summary: '无可核验来源的回答',
    results: [],
  }).run(context(), { query: '公开资料' });
  expect(empty.output.search_summary).toBeUndefined();
});
