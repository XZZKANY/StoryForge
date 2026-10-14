import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { AssistantSessionNotFoundError } from '@storyforge/engine';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('../src/lib/engine/db', async () => {
  const { nodeSqliteDb } =
    await import('../../../../packages/engine/src/store/nodeSqlite.test-support');
  return { nativeEngineDb: nodeSqliteDb() };
});
vi.mock('../src/lib/api/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/config')>()),
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

import {
  engineAgentDeps,
  engineRuns,
  pythonConversation,
  pythonTitles,
} from '../src/lib/engine/agent';
import { nativeProjectWriter } from '../src/lib/engine/writer';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

describe('Python half of the conversation sources', () => {
  it('reads messages and tool calls in id order and checks their shape', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/tool-calls')
        ? json(200, [
            {
              id: 9,
              tool_name: 'fs.read',
              status: 'completed',
              input_summary: {},
              output_summary: { path: 'a.md' },
              related_type: null,
              related_id: null,
              started_at: null,
            },
            {
              id: 4,
              tool_name: 'fs.list',
              status: 'completed',
              input_summary: {},
              output_summary: {},
              related_type: 'agent_run',
              related_id: 2,
            },
          ])
        : json(200, {
            id: 7,
            title: 'IDE Agent: 你好',
            messages: [
              { id: 3, role: 'assistant', content: '好的' },
              { id: 2, role: 'user', content: '你好', created_at: 'x' },
            ],
          }),
    );
    expect(await pythonConversation.messages(7)).toEqual([
      { id: 2, role: 'user', content: '你好' },
      { id: 3, role: 'assistant', content: '好的' },
    ]);
    expect((await pythonConversation.toolCalls(7)).map((row) => row.id)).toEqual([4, 9]);
    expect(await pythonTitles.title(7)).toBe('IDE Agent: 你好');
    await pythonTitles.setTitle(7, '新标题');
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).method === 'GET')).toBe(
      true,
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8000/api/assistant/sessions/7',
      'http://127.0.0.1:8000/api/assistant/sessions/7/tool-calls',
      'http://127.0.0.1:8000/api/assistant/sessions/7',
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { 'X-StoryForge-API-Key': 'k' },
    });
  });

  it('maps a missing session to the engine error and refuses malformed rows', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { detail: 'Assistant 会话不存在：9。' }));
    await expect(pythonConversation.messages(9)).rejects.toBeInstanceOf(
      AssistantSessionNotFoundError,
    );
    fetchMock.mockResolvedValueOnce(json(200, { id: 7, title: 't', messages: [{ id: '1' }] }));
    await expect(pythonConversation.messages(7)).rejects.toThrow(TypeError);
    fetchMock.mockResolvedValueOnce(json(200, { id: 8, title: 't', messages: [] }));
    await expect(pythonConversation.messages(7)).rejects.toThrow(TypeError);
    fetchMock.mockResolvedValueOnce(
      json(200, { id: 7, title: 't', messages: [{ role: 'user', content: '缺 id' }] }),
    );
    await expect(pythonConversation.messages(7)).rejects.toThrow(TypeError);
    const call = {
      id: 1,
      tool_name: 'x',
      status: 's',
      input_summary: {},
      output_summary: {},
      related_type: null,
      related_id: null,
    };
    for (const broken of [
      { input_summary: undefined },
      { output_summary: [] },
      { id: 0 },
      { related_type: 3 },
      { related_id: 1.5 },
    ]) {
      fetchMock.mockResolvedValueOnce(json(200, [{ ...call, ...broken }]));
      await expect(pythonConversation.toolCalls(7)).rejects.toThrow(TypeError);
    }
    fetchMock.mockResolvedValueOnce(json(200, [call]));
    expect(await pythonConversation.toolCalls(7)).toHaveLength(1);
  });
});

describe('engineAgentDeps', () => {
  it('binds every tool, the shared run store and both model slots', async () => {
    const deps = await engineAgentDeps();
    const runs = await engineRuns();
    expect(deps.store).toBe(runs.store);
    expect(deps.checkpoints).toBe(runs.checkpoints);
    expect((await engineAgentDeps()).store).toBe(deps.store);
    expect(deps.tools.all()).toHaveLength(28);
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
});
