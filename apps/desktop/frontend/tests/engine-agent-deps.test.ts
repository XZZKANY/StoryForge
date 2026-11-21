import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('../src/lib/engine/db', async () => {
  const { nodeSqliteDb } =
    await import('../../../../packages/engine/src/store/nodeSqlite.test-support');
  return { nativeEngineDb: nodeSqliteDb() };
});
vi.mock('./support/http-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./support/http-config')>()),
  getApiConfig: async () => ({ baseUrl: 'http://127.0.0.1:8000/', apiKey: 'k' }),
}));
vi.mock('../src/lib/engine/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/llm')>()),
  nativeLlmSource: async (slot: string) => ({
    source: { STORYFORGE_LLM_MODEL: `${slot}-model`, STORYFORGE_LLM_API_KEY: '[已隐藏的密钥]' },
    secrets: { values: slot === 'main' ? ['[已隐藏的密钥]'] : ['[已隐藏的密钥]', '[润色槽]'] },
  }),
  nativeHttpPort: (slot: string) => ({ slot, send: vi.fn() }),
}));

import { engineAgentDeps } from '../src/lib/engine/agent';
import { engineAssistantDeps } from '../src/lib/engine/assistant';
import { engineRuns } from '../src/lib/engine/store';
import { nativeProjectWriter } from '../src/lib/engine/writer';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('nativeProjectWriter', () => {
  it('hands the bytes to the Rust .storyforge writer as base64', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await nativeProjectWriter.writeProjectFile(
      'D:/book',
      '.storyforge/serial-plan.json',
      new TextEncoder().encode('计划\r\n'),
    );
    expect(invoke).toHaveBeenCalledWith('write_engine_project_file', {
      projectRoot: 'D:/book',
      relativePath: '.storyforge/serial-plan.json',
      base64: btoa(String.fromCharCode(...new TextEncoder().encode('计划\r\n'))),
    });
  });

  it('turns a Native refusal into an Error carrying its text', async () => {
    vi.mocked(invoke).mockRejectedValue('引擎只能写入作品的 .storyforge/ 目录: 正文/a.md');
    await expect(
      nativeProjectWriter.writeProjectFile('D:/book', '正文/a.md', new Uint8Array()),
    ).rejects.toThrow('引擎只能写入作品的 .storyforge/ 目录: 正文/a.md');
  });
});

describe('engineAgentDeps sessions', () => {
  it('keeps sessions, messages, tool calls and titles in the engine database', async () => {
    const deps = await engineAgentDeps();
    const ref = await deps.assistant.createSession({
      title: 'IDE Agent: 你好',
      task_type: 'ide_agent_orchestration',
      project_path: 'D:/book',
      messages: [{ role: 'user', content: '你好' }],
    });
    await deps.assistant.appendMessage(ref.id, { role: 'assistant', content: '好的' });
    const call = await deps.assistant.createToolCall(ref.id, {
      tool_name: 'fs.read',
      status: 'running',
      input_summary: { path: 'a.md' },
    });
    expect(await deps.conversation.messages(ref.id)).toEqual([
      { id: 1, role: 'user', content: '你好' },
      { id: 2, role: 'assistant', content: '好的' },
    ]);
    expect((await deps.conversation.toolCalls(ref.id)).map((row) => row.id)).toEqual([call.id]);
    expect(await deps.titles.title(ref.id)).toBe('IDE Agent: 你好');
    // 引擎库里改标题是真的改（Python 库那一半在 P4 前做不到）。
    await deps.titles.setTitle(ref.id, '新标题');
    expect(await (await engineAgentDeps()).titles.title(ref.id)).toBe('新标题');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('engineAgentDeps', () => {
  it('binds every tool, the shared run store and both model slots', async () => {
    const deps = await engineAgentDeps();
    const runs = await engineRuns();
    expect(deps.store).toBe(runs.store);
    expect(deps.checkpoints).toBe(runs.checkpoints);
    expect((await engineAgentDeps()).store).toBe(deps.store);
    expect(deps.tools.all()).toHaveLength(29);
    expect(deps.secrets).toEqual({ values: ['[已隐藏的密钥]', '[润色槽]'] });
    expect(deps.source.STORYFORGE_LLM_MODEL).toBe('main-model');
    expect(deps.polish.source.STORYFORGE_LLM_MODEL).toBe('polish-model');
    expect((deps.polish.http as unknown as { slot: string }).slot).toBe('polish');
    expect((deps.llm.http as unknown as { slot: string }).slot).toBe('main');
    expect(deps.llm.appVersion).toBe('0.1.10');
    expect(deps.newRunId()).toMatch(/^[0-9a-f]{32}$/);
    expect(deps.ids.hex()).toMatch(/^[0-9a-f]{32}$/);
    expect(deps.newRunId()).not.toBe(deps.newRunId());
  });

  it('passes the plugin library root to the runtime, or null when the host cannot give one', async () => {
    const library = 'C:/Users/author/AppData/Roaming/com.storyforge.ide/plugins';
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === 'plugin_library_dir' ? library : null,
    );
    expect((await engineAgentDeps()).pluginLibraryRoot).toBe(library);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'plugin_library_dir') throw new Error('插件库目录建不出来');
      return null;
    });
    expect((await engineAgentDeps()).pluginLibraryRoot).toBeNull();
  });
});

describe('engineAssistantDeps', () => {
  it('passes the plugin library root to Ctrl+K / continuation, or null when the host cannot give one', async () => {
    const library = 'C:/Users/author/AppData/Roaming/com.storyforge.ide/plugins';
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === 'plugin_library_dir' ? library : null,
    );
    expect((await engineAssistantDeps()).pluginLibraryRoot).toBe(library);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'plugin_library_dir') throw new Error('插件库目录建不出来');
      return null;
    });
    expect((await engineAssistantDeps()).pluginLibraryRoot).toBeNull();
  });
});

describe('optional web search port', () => {
  it.each([
    { enabled: false, hasApiKey: true, provider: 'tavily' },
    { enabled: true, hasApiKey: false, provider: 'tavily' },
  ])('does not expose external search without both enabled and configured: %j', async (config) => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === 'web_search_get_config' ? config : null,
    );
    const deps = await engineAgentDeps();
    expect(deps.tools.all().some((tool) => tool.name === 'web.search')).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith('web_search_execute', expect.anything());
  });

  it('binds configured search to the native fixed endpoint and refreshes enablement each run', async () => {
    let enabled = true;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'web_search_get_config')
        return { enabled, hasApiKey: true, provider: 'tavily' };
      if (command === 'web_search_execute')
        return {
          query: '公开资料',
          provider: 'tavily',
          searchedAt: '2026-11-20T00:00:00Z',
          results: [{ title: '来源', url: 'https://example.com/reference', snippet: '参考摘要' }],
        };
      return null;
    });
    const deps = await engineAgentDeps();
    const tool = deps.tools.get('web.search');
    expect(tool.risk_level).toBe('network');
    expect(tool.network_search_authorized).toBe(true);
    const result = await tool.handler({ services: { checkInterruption: vi.fn() } } as never, {
      query: '公开资料',
      max_results: 2,
    });
    expect(invoke).toHaveBeenCalledWith('web_search_execute', {
      request: { query: '公开资料', maxResults: 2 },
    });
    expect(result.trace.output_summary).toMatchObject({ result_count: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    enabled = false;
    expect((await engineAgentDeps()).tools.all().some((tool) => tool.name === 'web.search')).toBe(
      false,
    );
  });
});

it('offers OpenAI search with active model credentials even without a Tavily key, and withdraws it when the model is unavailable', async () => {
  let ready = true;
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === 'web_search_get_config'
      ? {
          enabled: true,
          hasApiKey: false,
          provider: 'openai',
          openaiReady: ready,
          openaiModel: ready ? 'main-model' : null,
        }
      : null,
  );
  expect((await engineAgentDeps()).tools.all().some((tool) => tool.name === 'web.search')).toBe(
    true,
  );
  ready = false;
  expect((await engineAgentDeps()).tools.all().some((tool) => tool.name === 'web.search')).toBe(
    false,
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it('binds page reading to native IPC only when search is enabled', async () => {
  let enabled = true;
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === 'web_search_get_config'
      ? { enabled, hasApiKey: true, provider: 'tavily' }
      : command === 'web_read_execute'
        ? {
            requestedUrl: 'https://example.com/',
            url: 'https://example.com/',
            title: '正文',
            text: '公开页面',
            links: [],
            truncated: false,
            linksTruncated: false,
            fetchedAt: '2026-11-21T00:00:00Z',
          }
        : null,
  );
  const tool = (await engineAgentDeps()).tools.get('web.read');
  const result = await tool.handler(
    { run: { public_id: 'read-run' }, services: { checkInterruption: vi.fn() } } as never,
    { url: 'https://example.com/' },
  );
  expect(result.output.text).toBe('公开页面');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith('web_read_execute', {
    request: { url: 'https://example.com/' },
  });
  enabled = false;
  expect((await engineAgentDeps()).tools.all().some((t) => t.name === 'web.read')).toBe(false);
});
