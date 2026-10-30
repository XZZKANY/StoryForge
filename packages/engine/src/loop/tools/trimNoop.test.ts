import { describe, expect, it } from 'vitest';
import type { AssistantDeps, AssistantLlm, AssistantStore } from '../../assistant/service';
import { memoryProject } from '../../kernel/memoryProject.test-support';
import type { ToolExecutionContext } from './execution';
import type { ToolDeps } from './handlerDeps';
import { patchToolHandlers } from './patchHandlers';

const ROOT = 'D:/book';
const PATH = '正文/第001章.md';
const BEFORE = '他推开门，走进屋里。屋里静悄悄的，没有一点声音。';
const encoded = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});

async function trim(after: string) {
  const project = memoryProject(ROOT, { [PATH]: encoded(BEFORE) });
  const store: AssistantStore = {
    createSession: async () => ({ id: 7, project_path: ROOT }),
    getSession: async () => ({ id: 7, project_path: ROOT }),
    appendMessage: async () => {},
    createToolCall: async (_id: number, input: { input_summary: unknown }) => ({
      id: 1,
      input_summary: input.input_summary,
    }),
    updateToolCall: async (_id: number, patch: { input_summary?: unknown }) => ({
      id: 1,
      input_summary: patch.input_summary ?? {},
    }),
  } as unknown as AssistantStore;
  const unexpected = async () => {
    throw new Error('只走 callStreamed');
  };
  const llm = {
    source: {
      STORYFORGE_LLM_API_KEY: '<key>',
      STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
      STORYFORGE_LLM_MODEL: 'm-1',
      STORYFORGE_LLM_PROVIDER: 'openai',
    },
    secrets: { values: [] },
    call: unexpected,
    stream: unexpected,
    callStreamed: async () => ({ content: after, completion_tokens: 12, latency_ms: 1 }),
  } as unknown as AssistantLlm;
  const assistant: AssistantDeps = {
    reader: project.reader,
    store,
    llm: async () => llm,
    platform: 'windows',
  } as unknown as AssistantDeps;
  const deps = {
    reader: project.reader,
    platform: 'windows',
    secrets: { values: [] },
    newHex: () => 'abc123',
  } as unknown as ToolDeps;
  const context = {
    run: { permission_profile: 'ask' },
    services: { assistant },
    assistantSessionId: 7,
    args: {},
    deliveries: null,
  } as unknown as ToolExecutionContext;
  return await patchToolHandlers(deps)['project.trim_prose'](context, {
    file_path: PATH,
    content: BEFORE,
    project_root: ROOT,
    target_percent: 15,
  });
}

describe('project.trim_prose', () => {
  it('offers no patch when the model gave the text back unchanged', async () => {
    const result = await trim(BEFORE);
    expect(result.status).toBe('completed');
    expect(result.patch_proposal).toBeUndefined();
    expect(result.artifacts ?? []).toEqual([]);
    expect(result.output).toMatchObject({ unchanged: true });
    expect(result.summary).toMatch(/一字不差.*没有生成修订/);
  });

  it('still proposes a patch when the text actually got shorter', async () => {
    const result = await trim('他推门进屋，四下无声。');
    expect(result.patch_proposal).toBeDefined();
    expect(result.summary).toMatch(/^压缩完成/);
  });
});
