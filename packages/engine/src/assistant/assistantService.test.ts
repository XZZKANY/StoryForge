import { describe, expect, it } from 'vitest';
import golden from '../../golden/p2-assistant-service.windows.json';
import type { EncodedFile } from '../kernel/contextFixture.test-support';
import { dumpJson, InputDomainError, type JsonValue } from '../kernel/json';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { validateAssistantContextBundle } from '../kernel/writingContext';
import { ModelListHttpError } from '../llm/client';
import { LlmConfigError, LlmConfigFileError, type LlmSource } from '../llm/config';
import { TokenUsage } from '../llm/contracts';
import { RunInterrupted } from '../llm/control';
import { LlmError } from '../llm/payload';
import { HttpTransportError, type StreamFrame } from '../llm/transport';
import { probeProviderHealth } from './providerHealth';
import {
  AssistantSessionNotFoundError,
  chatReply,
  draftFileContent,
  engineAssistantLlm,
  reviseFileContent,
  streamContinueProse,
  type AssistantDeps,
  type AssistantLlm,
  type AssistantStore,
  type ContinueFrame,
} from './service';

const ROOT = golden.synthetic_root;
const platform = golden.platform as 'windows' | 'posix';
const ESCAPED_ROOT = JSON.stringify(ROOT).slice(1, -1);
const stable = (value: unknown) =>
  JSON.parse(dumpJson(value, { ensureAscii: false }).split(ESCAPED_ROOT).join('$ROOT'));

type Json = Record<string, unknown>;
type Call = { fn: string; args: Json; output_json: string };
const record = golden.projects[0] as unknown as {
  files: Record<string, EncodedFile>;
  calls: Call[];
};

/** 与 Python oracle 同一套内存会话存储：只记录显式的存储操作。 */
function fakeStore(log: Json[]): AssistantStore {
  const sessions = new Map<number, { id: number; project_path: string | null }>([
    [1, { id: 1, project_path: ROOT }],
    [2, { id: 2, project_path: null }],
    [3, { id: 3, project_path: 'D:\\other-book' }],
  ]);
  const tools = new Map<number, { id: number; input_summary: Json }>();
  let nextSession = 10;
  let nextTool = 100;
  const lookup = (id: number) => {
    const found = sessions.get(id);
    if (!found) throw new AssistantSessionNotFoundError(`AI 会话不存在：${id}。`);
    return found;
  };
  return {
    async createSession(input) {
      const id = nextSession++;
      log.push({ op: 'create_session', ...input });
      sessions.set(id, { id, project_path: input.project_path });
      return sessions.get(id)!;
    },
    async getSession(id) {
      log.push({ op: 'get_session', id });
      return lookup(id);
    },
    async appendMessage(sessionId, message) {
      lookup(sessionId);
      log.push({ op: 'append_message', session_id: sessionId, ...message });
    },
    async createToolCall(sessionId, input) {
      lookup(sessionId);
      const id = nextTool++;
      log.push({ op: 'create_tool_call', session_id: sessionId, ...input });
      tools.set(id, { id, input_summary: input.input_summary });
      return tools.get(id)!;
    },
    async updateToolCall(id, patch) {
      log.push({ op: 'update_tool_call', id, ...patch });
      const tool = tools.get(id)!;
      if (patch.input_summary) tool.input_summary = patch.input_summary;
      return tool;
    },
  };
}

function failure(spec: Json): Error {
  const usage = spec.usage ? TokenUsage.fromLegacy(spec.usage as Json) : null;
  if (spec.raise === 'LLMError') return new LlmError(spec.message as string, usage);
  if (spec.raise === 'LLMRunInterrupted') return new RunInterrupted(spec.message as string, usage);
  return new LlmConfigError(spec.message as string);
}

function scriptedLlm(log: Json[], script: unknown[], source: LlmSource): AssistantLlm {
  const replies = [...script];
  const take = () => {
    const reply = replies.shift() as Json;
    if (reply && typeof reply === 'object' && 'raise' in reply) throw failure(reply);
    return reply;
  };
  return {
    source,
    secrets: { values: [] },
    async call({ systemPrompt, userPrompt }) {
      log.push({ op: 'call', system: systemPrompt, user: userPrompt });
      return take();
    },
    async callStreamed({ systemPrompt, userPrompt }) {
      log.push({ op: 'call_streamed', system: systemPrompt, user: userPrompt });
      return take();
    },
    async *stream(payload) {
      log.push({ op: 'stream', payload });
      for (const frame of take() as unknown as Json[]) {
        if ('raise' in frame) throw failure(frame);
        yield frame as StreamFrame;
      }
    },
  };
}

const ERROR_TYPES: Record<string, string> = {
  AssistantSessionConflictError: 'ConflictError',
  RunInterrupted: 'LLMRunInterrupted',
  LlmConfigError: 'LLMConfigError',
};

function describeError(error: unknown) {
  if (!(error instanceof Error)) throw error;
  const status = (error as { status?: number }).status;
  return {
    type: ERROR_TYPES[error.name] ?? error.name,
    message: error.message,
    status: status === undefined ? null : status,
  };
}

describe('real Python assistant use cases (fake store, scripted model)', () => {
  const project = memoryProject(ROOT, record.files);
  for (const [index, call] of record.calls.entries()) {
    it(`#${index} ${call.args.name}`, async () => {
      const log: Json[] = [];
      const source = call.args.source as LlmSource;
      const deps: AssistantDeps = {
        reader: project.reader,
        store: fakeStore(log),
        llm: async () => scriptedLlm(log, call.args.script as unknown[], source),
        platform,
      };
      const raw = call.args.request as Json;
      // Python 只把顶层的 `$ROOT` 换成真实根。
      const request = Object.fromEntries(
        Object.entries(raw).map(([key, value]) => [
          key,
          typeof value === 'string' ? value.split('$ROOT').join(ROOT) : value,
        ]),
      );
      if (request.context_bundle)
        request.context_bundle = validateAssistantContextBundle(request.context_bundle as never);
      const frames: ContinueFrame[] = [];
      let outcome: Json;
      try {
        let result: unknown = null;
        if (call.fn === 'revise') result = await reviseFileContent(deps, request as never);
        else if (call.fn === 'draft') result = await draftFileContent(deps, request as never);
        else if (call.fn === 'chat')
          result = await chatReply(deps, {
            userMessage: request.user_message as string,
            contextBlock: request.context_block as string,
            assistantSessionId: request.assistant_session_id as number,
          });
        else await streamContinueProse(deps, request as never, (frame) => frames.push(frame));
        outcome = { result };
      } catch (error) {
        outcome = { error: describeError(error) };
      }
      if (call.fn === 'continue') outcome.frames = frames;
      expect(stable({ ...outcome, log })).toEqual(JSON.parse(call.output_json));
      expect(project.takeWrites()).toEqual({});
    });
  }
});

type HealthRow = { name: string; source: LlmSource; reply: Json; output_json: string };

describe('real Python provider health', () => {
  for (const row of golden.health as HealthRow[]) {
    it(row.name, async () => {
      let now = 100;
      let probedTimeout: number | null = null;
      const result = await probeProviderHealth({
        resolveSource: async () => {
          if (row.name === 'config-file') throw new LlmConfigFileError('配置文件损坏');
          return { source: row.source, secrets: { values: [] } };
        },
        fetchModels: async (_source, timeout) => {
          probedTimeout = timeout;
          const kind = row.reply.raise;
          if (kind === 'http') throw new ModelListHttpError(row.reply.code as number);
          if (kind === 'json') throw new InputDomainError('bad');
          if (kind === 'url') throw new HttpTransportError('connect', 'refused');
          if (kind === 'config') throw new LlmConfigError('bad auth header');
          if (kind === 'value') throw new RangeError('bad url');
          return row.reply as JsonValue;
        },
        clock: () => (now += 0.0125),
      });
      expect(stable({ result, timeout: probedTimeout })).toEqual(JSON.parse(row.output_json));
    });
  }
});

describe('engine LLM binding', () => {
  it('streams through the HTTP port with the resolved source and redacts with its secrets', async () => {
    const requests: { url: string; body: string }[] = [];
    const encoder = new TextEncoder();
    const sse = [
      'data: {"choices":[{"delta":{"content":"雨夜"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"里"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ];
    const llm = engineAssistantLlm(
      {
        STORYFORGE_LLM_PROVIDER: 'openai',
        STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
        STORYFORGE_LLM_API_KEY: '[已隐藏的密钥]',
        STORYFORGE_LLM_MODEL: 'deepseek-v4',
      },
      { values: ['[已隐藏的密钥]'] },
      {
        http: {
          async send(request) {
            requests.push({ url: request.url, body: new TextDecoder().decode(request.body!) });
            return {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
              body: (async function* () {
                for (const chunk of sse) yield encoder.encode(chunk);
              })(),
              close() {},
            };
          },
        },
        clock: () => 0,
        wait: async () => {},
        random: () => 0,
        appVersion: 'test',
      },
    );
    const result = await llm.callStreamed({ systemPrompt: '系统', userPrompt: '写' });
    expect(result.content).toBe('雨夜里');
    expect(result.completion_tokens).toBe(2);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://llm.example/v1/chat/completions');
    expect(JSON.parse(requests[0].body)).toMatchObject({ model: 'deepseek-v4', stream: true });
  });
});

describe('streamed revise / draft retries a stream that breaks mid-output', () => {
  const encoder = new TextEncoder();
  const full = [
    'data: {"choices":[{"delta":{"content":"雨夜"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"里"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
    'data: [DONE]\n\n',
  ];
  function binding(breaks: number, waits: number[] = []) {
    let sent = 0;
    const llm = engineAssistantLlm(
      {
        STORYFORGE_LLM_PROVIDER: 'openai',
        STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
        STORYFORGE_LLM_API_KEY: '[已隐藏的密钥]',
        STORYFORGE_LLM_MODEL: 'deepseek-v4',
      },
      { values: ['[已隐藏的密钥]'] },
      {
        http: {
          async send() {
            const broken = sent++ < breaks;
            return {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
              body: (async function* () {
                yield encoder.encode(full[0]);
                if (broken) throw new HttpTransportError('read', 'IncompleteRead');
                for (const chunk of full.slice(1)) yield encoder.encode(chunk);
              })(),
              close() {},
            };
          },
        },
        clock: () => 0,
        wait: async (seconds) => {
          waits.push(seconds);
        },
        random: () => 0,
        appVersion: 'test',
      },
    );
    return { llm, sent: () => sent };
  }

  it('resends the whole request and keeps only the complete answer', async () => {
    const waits: number[] = [];
    const { llm, sent } = binding(2, waits);
    const result = await llm.callStreamed({ systemPrompt: '系统', userPrompt: '改写总纲' });
    expect(result.content).toBe('雨夜里');
    expect(sent()).toBe(3);
    expect(waits).toEqual([1, 1]);
  });

  it('gives up after two resends with the original stream-break message', async () => {
    const { llm, sent } = binding(3);
    const failure = llm.callStreamed({ systemPrompt: '系统', userPrompt: '改写总纲' });
    await expect(failure).rejects.toBeInstanceOf(LlmError);
    await expect(failure).rejects.toThrow('真实 LLM 流式读取中断（已输出 2 字）：IncompleteRead');
    expect(sent()).toBe(3);
  });
});

describe('streamed revise rejects an output cut by the token limit', () => {
  it('finish_reason=length 的半截正文不当成稿，也不重发', async () => {
    const encoder = new TextEncoder();
    let sent = 0;
    const sse = [
      'data: {"choices":[{"delta":{"content":"林远只能依靠既有积累与"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":8192,"total_tokens":8195}}\n\n',
      'data: [DONE]\n\n',
    ];
    const llm = engineAssistantLlm(
      {
        STORYFORGE_LLM_PROVIDER: 'openai',
        STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
        STORYFORGE_LLM_API_KEY: '[已隐藏的密钥]',
        STORYFORGE_LLM_MODEL: 'deepseek-v4',
      },
      { values: ['[已隐藏的密钥]'] },
      {
        http: {
          async send() {
            sent += 1;
            return {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
              body: (async function* () {
                for (const chunk of sse) yield encoder.encode(chunk);
              })(),
              close() {},
            };
          },
        },
        clock: () => 0,
        wait: async () => {},
        random: () => 0,
        appVersion: 'test',
      },
    );
    const failure = llm.callStreamed({ systemPrompt: '系统', userPrompt: '改写总纲' });
    await expect(failure).rejects.toBeInstanceOf(LlmError);
    await expect(failure).rejects.toThrow('真实 LLM 输出被截断或过滤，不能把未完成正文当成稿。');
    expect(sent).toBe(1);
  });
});

describe('Ctrl+K 与续写失败时作者看到归类说明，响应体只进证据（#505）', () => {
  const KEY = 'sk-test-505-secret-key';
  const MARK = 'MARK-505-upstream-text';
  const SERVER_ERROR = '模型调用失败：模型服务端出错（HTTP 502），可以稍后重试。';
  const source: LlmSource = {
    STORYFORGE_LLM_PROVIDER: 'openai',
    STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
    STORYFORGE_LLM_API_KEY: KEY,
    STORYFORGE_LLM_MODEL: 'deepseek-v4',
    STORYFORGE_LLM_RETRY_MAX_ATTEMPTS: '1',
  };
  const project = memoryProject(ROOT, record.files);
  function failingDeps(log: Json[]): AssistantDeps {
    const llm = engineAssistantLlm(
      source,
      { values: [KEY] },
      {
        http: {
          async send() {
            return {
              status: 502,
              headers: {},
              body: (async function* () {
                yield new TextEncoder().encode(`{"error":{"message":"${MARK} key=${KEY}"}}`);
              })(),
              close() {},
            };
          },
        },
        clock: () => 0,
        wait: async () => {},
        random: () => 0,
        appVersion: 'test',
      },
    );
    return { reader: project.reader, store: fakeStore(log), llm: async () => llm, platform };
  }
  const failedEvidence = (log: Json[]) =>
    log.filter((entry) => entry.op === 'update_tool_call' && entry.status === 'failed');

  it('Ctrl+K 行间修订', async () => {
    const log: Json[] = [];
    const failure = await reviseFileContent(failingDeps(log), {
      file_path: '正文/第004章.md',
      content: '他回头。\n\n雨夜里他推开门。\n',
      project_root: ROOT,
      instruction: '改',
    } as never).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe(SERVER_ERROR);
    const evidence = failedEvidence(log);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].error_message).toContain(MARK);
    expect(evidence[0].error_message).not.toContain(KEY);
  });

  it('光标处续写的错误帧', async () => {
    const log: Json[] = [];
    const frames: ContinueFrame[] = [];
    await streamContinueProse(
      failingDeps(log),
      {
        file_path: '正文/第004章.md',
        content: '他回头。\n\n雨夜里他推开门。\n',
        project_root: ROOT,
        cursor_line: 3,
      } as never,
      (frame) => frames.push(frame),
    );
    const errors = frames.filter((frame) => frame.event === 'error');
    expect(errors).toEqual([{ event: 'error', data: { message: SERVER_ERROR } }]);
    const evidence = failedEvidence(log);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].error_message).toContain(MARK);
    expect(evidence[0].error_message).not.toContain(KEY);
  });
});
