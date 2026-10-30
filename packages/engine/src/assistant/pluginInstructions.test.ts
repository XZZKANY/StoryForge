import { describe, expect, it } from 'vitest';
import { GENERATION_PREFIX, PLUGIN_GENERATION_PREFIX } from '../kernel/authorVoice';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { encodeTexts, withPluginLibrary } from '../kernel/pluginLibrary.test-support';
import type { LlmSource } from '../llm/config';
import type { StreamFrame } from '../llm/transport';
import {
  draftContinuation,
  draftFileContent,
  reviseFileContent,
  streamContinueProse,
  type AssistantDeps,
  type AssistantLlm,
  type AssistantStore,
} from './service';

// Ctrl+K 修订、续写（流式与循环里的）、起草都经同一个产字组装点带上插件指令。
const ROOT = '/book';
const LIB = '/home/author/.storyforge/plugins';
const SOURCE: LlmSource = {
  STORYFORGE_LLM_PROVIDER: 'openai',
  STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
  STORYFORGE_LLM_API_KEY: 'sk-test',
  STORYFORGE_LLM_MODEL: 'm-1',
};
const REPLY = {
  content: '陈默醒来。\n',
  prompt_tokens: 1,
  completion_tokens: 1,
  token_usage: 2,
  token_usage_source: 'provider',
  cost_cny_estimated: 0,
  cost_breakdown: { total_cny: 0 },
  latency_ms: 1,
};
const CHAPTER =
  '他推门进来，雨水顺着帽檐往下滴。“你来了。”她没有抬头，只把茶杯往桌边推了推。'.repeat(12);
const BOOK = {
  '.storyforge/agent-instructions.md': '不改人名。',
  '.storyforge/plugins.json': JSON.stringify({ version: 1, enabled: ['网文包'] }),
  '正文/第001章.md': CHAPTER,
  '正文/第002章.md': CHAPTER,
  '正文/第003章.md': CHAPTER,
};
const BLOCK = `${PLUGIN_GENERATION_PREFIX}【插件「网文包」】\n对白要短。`;

type Generation = { system: string; evidence: { [key: string]: unknown } | null };

function setup(pluginLibraryRoot: string | null) {
  const { reader } = withPluginLibrary(ROOT, memoryProject(ROOT, encodeTexts(BOOK)).reader, LIB, {
    网文包: { '指令.md': '对白要短。' },
  });
  const systems: string[] = [];
  const llm: AssistantLlm = {
    source: SOURCE,
    secrets: { values: [] },
    async call({ systemPrompt }) {
      systems.push(systemPrompt);
      return REPLY as never;
    },
    async callStreamed({ systemPrompt }) {
      systems.push(systemPrompt);
      return REPLY as never;
    },
    async *stream(payload) {
      systems.push((payload as { messages: { content: string }[] }).messages[0].content);
      yield { type: 'delta', text: '陈默' } as StreamFrame;
      yield { type: 'done', ...REPLY, content: undefined } as unknown as StreamFrame;
    },
  };
  const evidence: { [key: string]: unknown }[] = [];
  let nextId = 1;
  const store: AssistantStore = {
    async createSession(input) {
      return { id: nextId++, project_path: input.project_path };
    },
    async getSession(id) {
      return { id, project_path: ROOT };
    },
    async appendMessage() {},
    async createToolCall(_session, input) {
      return { id: nextId++, input_summary: input.input_summary };
    },
    async updateToolCall(id, patch) {
      const summary = patch.input_summary as { generation_sources?: unknown } | undefined;
      if (summary?.generation_sources)
        evidence.push(summary.generation_sources as { [key: string]: unknown });
      return { id, input_summary: patch.input_summary ?? {} };
    },
  };
  const deps: AssistantDeps = {
    reader,
    store,
    llm: async () => llm,
    platform: 'posix',
    ...(pluginLibraryRoot === null ? {} : { pluginLibraryRoot }),
  };
  return { deps, systems, evidence };
}

const continueRequest = {
  file_path: `${ROOT}/正文/第003章.md`,
  content: '第三章\n\n陈默抬起头。\n',
  cursor_line: 3,
  project_root: ROOT,
};
const paths: [string, (deps: AssistantDeps) => Promise<unknown>][] = [
  [
    'Ctrl+K 修订',
    (deps) =>
      reviseFileContent(deps, {
        file_path: `${ROOT}/正文/第002章.md`,
        content: '第二章\n\n林舟回到码头。\n',
        instruction: '改紧凑些',
        project_root: ROOT,
      }),
  ],
  ['光标处续写', (deps) => streamContinueProse(deps, continueRequest, () => {})],
  ['循环里的续写', (deps) => draftContinuation(deps, continueRequest)],
  [
    '起草新文件',
    (deps) =>
      draftFileContent(deps, {
        file_path: `${ROOT}/正文/第004章.md`,
        instruction: '写陈默逃出来',
        project_root: ROOT,
      }),
  ],
];

async function generate(
  call: (deps: AssistantDeps) => Promise<unknown>,
  pluginLibraryRoot: string | null,
): Promise<Generation> {
  const { deps, systems, evidence } = setup(pluginLibraryRoot);
  await call(deps);
  expect(systems).toHaveLength(1);
  return { system: systems[0], evidence: evidence[0] ?? null };
}

describe('产字路径带上插件指令', () => {
  it.each(paths)('%s：插在通用准则与文风基线之间，作者指令仍在最后', async (_name, call) => {
    const plain = await generate(call, null);
    const current = await generate(call, LIB);
    const baseline = plain.system.indexOf('\n\n文风基线（');
    expect(baseline).toBeGreaterThan(0);
    expect(current.system).toBe(
      `${plain.system.slice(0, baseline)}\n\n${BLOCK}${plain.system.slice(baseline)}`,
    );
    expect(current.system.endsWith(`${GENERATION_PREFIX}不改人名。`)).toBe(true);
  });

  it.each(paths)('%s：来源证据里有送达的插件指令；没给插件库时没有', async (_name, call) => {
    const purposes = (evidence: { [key: string]: unknown } | null) =>
      ((evidence?.projections ?? []) as { purpose: string; delivered: boolean }[]).map(
        (row) => `${row.purpose}:${row.delivered}`,
      );
    const plain = await generate(call, null);
    const current = await generate(call, LIB);
    expect(purposes(plain.evidence)).not.toContain('plugin_instructions:true');
    expect(purposes(current.evidence)).toContain('plugin_instructions:true');
  });
});
