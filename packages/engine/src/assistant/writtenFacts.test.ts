import { describe, expect, it } from 'vitest';
import { memoryProject } from '../kernel/memoryProject.test-support';
import type { LlmSource } from '../llm/config';
import type { StreamFrame } from '../llm/transport';
import {
  draftFileContent,
  reviseFileContent,
  streamContinueProse,
  type AssistantDeps,
  type AssistantLlm,
  type AssistantStore,
} from './service';

// 起草和整章修订带台账里的已写事实；续写和 Ctrl+K 这类局部改不带，先不加这份输入。
const ROOT = '/book';
const HEADING = '[已写事实 · 勿违背]';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const SOURCE: LlmSource = {
  STORYFORGE_LLM_PROVIDER: 'openai',
  STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
  STORYFORGE_LLM_API_KEY: 'sk-test',
  STORYFORGE_LLM_MODEL: 'm-1',
};
const REPLY = {
  content: '第四章\n\n陈默醒来。\n',
  prompt_tokens: 1,
  completion_tokens: 1,
  token_usage: 2,
  token_usage_source: 'provider',
  cost_cny_estimated: 0,
  cost_breakdown: { total_cny: 0 },
  latency_ms: 1,
};

function setup() {
  const project = memoryProject(ROOT, {
    '正文/第001章.md': file('第一章\n\n陈默被束带捆住，由陆一鸣带走。\n'),
    '正文/第002章.md': file('第二章\n\n林舟回到码头。\n'),
    '.storyforge/canon/facts.json': file(
      JSON.stringify({
        version: 1,
        facts: [
          {
            id: 'fact_1',
            kind: '处境',
            subject: '陈默',
            attribute: '下落',
            value: '被陆一鸣带走',
            object: null,
            path: '正文/第001章.md',
            status: 'active',
            evidence: [{ path: '正文/第001章.md', quote: '陈默被束带捆住，由陆一鸣带走。' }],
          },
        ],
      }),
    ),
  });
  const prompts: string[] = [];
  const llm: AssistantLlm = {
    source: SOURCE,
    secrets: { values: [] },
    async call({ userPrompt }) {
      prompts.push(userPrompt);
      return REPLY as never;
    },
    async callStreamed({ userPrompt }) {
      prompts.push(userPrompt);
      return REPLY as never;
    },
    async *stream(payload) {
      const messages = (payload as { messages: { content: string }[] }).messages;
      prompts.push(messages[messages.length - 1].content);
      yield { type: 'delta', text: '陈默' } as StreamFrame;
      yield { type: 'done', ...REPLY, content: undefined } as unknown as StreamFrame;
    },
  };
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
      return { id, input_summary: patch.input_summary ?? {} };
    },
  };
  const deps: AssistantDeps = {
    reader: project.reader,
    store,
    llm: async () => llm,
    platform: 'posix',
  };
  return { deps, prompts };
}

describe('written facts reach the prose prompts', () => {
  it('drafting a new chapter carries the ledger facts mentioned in the instruction', async () => {
    const { deps, prompts } = setup();
    await draftFileContent(deps, {
      file_path: `${ROOT}/正文/第003章.md`,
      instruction: '写陈默逃出来',
      project_root: ROOT,
    });
    expect(prompts[0]).toContain(
      `${HEADING}（来自台账；本章若涉及须与之一致，回忆或提及除外）\n` +
        '- 陈默 · 处境/下落：被陆一鸣带走（第1章「陈默被束带捆住，由陆一鸣带走。」）',
    );
    expect(prompts[0].indexOf(HEADING)).toBeLessThan(prompts[0].indexOf('写作指令：'));
  });

  it('whole-chapter revision finds subjects in its own text; Ctrl+K style edits do not', async () => {
    const { deps, prompts } = setup();
    const request = {
      file_path: `${ROOT}/正文/第002章.md`,
      content: '第二章\n\n林舟回到码头，想起陈默。\n',
      instruction: '改得紧凑些',
      project_root: ROOT,
    };
    await reviseFileContent(deps, request, { writtenFacts: true });
    await reviseFileContent(deps, request);
    expect(prompts[0]).toContain('陈默 · 处境/下落：被陆一鸣带走');
    expect(prompts[1]).not.toContain(HEADING);
  });

  it('cursor continuation does not carry them', async () => {
    const { deps, prompts } = setup();
    await streamContinueProse(
      deps,
      {
        file_path: `${ROOT}/正文/第003章.md`,
        content: '第三章\n\n陈默抬起头。\n',
        cursor_line: 3,
        project_root: ROOT,
      } as never,
      () => {},
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain(HEADING);
  });
});
