import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { getWebSearchConfig, saveWebSearchConfig, searchWeb } from '../src/lib/api/web-search';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
});
const config = { enabled: false, hasApiKey: true, provider: 'tavily' };

describe('联网搜索宿主接口', () => {
  it('reads only safe config fields and never exposes an unexpected key', async () => {
    vi.mocked(invoke).mockResolvedValue({ ...config, apiKey: 'must-not-return' });
    expect(await getWebSearchConfig()).toEqual(config);
    expect(invoke).toHaveBeenCalledWith('web_search_get_config', undefined);
  });
  it('saves key only through the native command and never logs provider errors', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    vi.mocked(invoke).mockResolvedValue({ ...config, enabled: true });
    expect(await saveWebSearchConfig({ enabled: true, apiKey: 'test-key' })).toEqual({
      ...config,
      enabled: true,
    });
    expect(invoke).toHaveBeenCalledWith('web_search_save_config', {
      request: { enabled: true, apiKey: 'test-key' },
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    vi.mocked(invoke).mockRejectedValue('request Authorization Bearer test-secret');
    await expect(saveWebSearchConfig({ enabled: true, apiKey: 'test-secret' })).rejects.toThrow(
      '配置保存失败',
    );
    await expect(getWebSearchConfig()).rejects.toThrow('配置暂不可用');
  });
  it('validates config and search response instead of inventing success', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(getWebSearchConfig()).rejects.toThrow('格式不正确');
    await expect(saveWebSearchConfig({ enabled: false })).rejects.toThrow('格式不正确');
    await expect(searchWeb({ query: '公开关键词' })).rejects.toThrow('格式不正确');
  });
  it('sends a bounded query and returns source titles, snippets and links', async () => {
    const reply = {
      query: '公开关键词',
      provider: 'tavily',
      searchedAt: '2026-11-20T01:00:00Z',
      results: [{ title: '公开资料', url: 'https://example.org/source', snippet: '资料摘录' }],
    };
    vi.mocked(invoke).mockResolvedValue(reply);
    expect(await searchWeb({ query: ' 公开关键词 ', maxResults: 3 })).toEqual(reply);
    expect(invoke).toHaveBeenCalledWith('web_search_execute', {
      request: { query: '公开关键词', maxResults: 3 },
    });
  });
  it.each([
    { query: '' },
    { query: '字'.repeat(401) },
    { query: '关键词', maxResults: 0 },
    { query: '关键词', maxResults: 9 },
    { query: '关键词', maxResults: 1.5 },
  ])('rejects invalid requests without invoking native', async (request) => {
    await expect(searchWeb(request)).rejects.toThrow('搜索关键词');
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(['javascript:alert(1)', 'https://user:secret@example.org/path', 'not a url'])(
    'rejects unsafe result URL %s',
    async (url) => {
      vi.mocked(invoke).mockResolvedValue({
        query: 'q',
        provider: 'tavily',
        searchedAt: 'today',
        results: [{ title: 't', url, snippet: 's' }],
      });
      await expect(searchWeb({ query: 'q' })).rejects.toThrow('无效来源地址');
    },
  );
  it.each([
    ['401 test-secret', '密钥无效'],
    ['搜索服务拒绝了密钥 test-secret', '密钥无效'],
    ['联网搜索密钥无法解密 test-secret', '密钥无效'],
    ['搜索请求超限 test-secret', '额度不足'],
    ['429 test-secret', '额度不足'],
    ['request timed out test-secret', '超时'],
    ['未启用 test-secret', '尚未启用'],
    ['unknown response test-secret', '检查配置'],
  ])('returns safe diagnostic for %s', async (error, expected) => {
    vi.mocked(invoke).mockRejectedValue(error);
    try {
      await searchWeb({ query: 'q' });
      throw new Error('expected failure');
    } catch (error) {
      expect((error as Error).message).toContain(expected);
      expect((error as Error).message).not.toContain('test-secret');
    }
  });
});

it('accepts OpenAI configuration and verified model summaries without returning unknown fields', async () => {
  const active = {
    enabled: true,
    hasApiKey: false,
    provider: 'openai',
    openaiReady: true,
    openaiModel: 'gpt-active',
  };
  vi.mocked(invoke).mockResolvedValue({ ...active, apiKey: 'never-return' });
  expect(await getWebSearchConfig()).toEqual(active);
  expect(await saveWebSearchConfig({ enabled: true, provider: 'openai' })).toEqual(active);
  expect(invoke).toHaveBeenLastCalledWith('web_search_save_config', {
    request: { enabled: true, provider: 'openai' },
  });
  const reply = {
    query: '公开资料',
    provider: 'openai',
    searchedAt: '2026-11-20T10:00:00Z',
    summary: '模型检索摘要（非网页原文）',
    results: [{ title: '史料', url: 'https://museum.example.org/source', snippet: '搜索来源' }],
  };
  vi.mocked(invoke).mockResolvedValue(reply);
  expect(await searchWeb({ query: '公开资料' })).toEqual(reply);
});

it('reports ignored search tools as unsupported instead of returning invented success', async () => {
  vi.mocked(invoke).mockRejectedValue(
    '未获得实际搜索调用记录，当前模型或服务可能不支持 Responses 联网搜索。',
  );
  await expect(searchWeb({ query: '公开资料' })).rejects.toThrow('未完成实际联网搜索');
});
