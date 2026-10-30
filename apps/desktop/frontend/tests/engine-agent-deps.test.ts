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
    vi.mocked(invoke).mockRejectedValue('引擎只能写项目的 .storyforge/ 目录: 正文/a.md');
    await expect(
      nativeProjectWriter.writeProjectFile('D:/book', '正文/a.md', new Uint8Array()),
    ).rejects.toThrow('引擎只能写项目的 .storyforge/ 目录: 正文/a.md');
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
  it('passes the plugin library root to Ctrl+K and continuation, or null when the host cannot give one', async () => {
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
