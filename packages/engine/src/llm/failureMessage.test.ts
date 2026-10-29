import { describe, expect, it } from 'vitest';
import { completeWithTextStream } from '../loop/textStream';
import { callLlm, ConfiguredLlmProvider, legacyProviderError } from './client';
import { LlmConfigError, llmRequestHeaders, type LlmSource } from './config';
import { ChatMessage, ProviderError, type ChatRequest } from './contracts';
import { modelFailureMessage } from './failureMessage';
import { OpenAICompatibleProvider } from './openaiCompatible';
import { LlmError, LlmStreamBreak, ProviderLlmError } from './payload';
import { postJsonWithRetry, providerSseJson } from './providerTransport';
import {
  HttpTransportError,
  rawStreamChatCompletions,
  requestChatCompletions,
  type LlmContext,
} from './transport';

const KEY = 'sk-test-505-secret-key';
const MARK = 'MARK-505-upstream-text';
const ENCODER = new TextEncoder();

const openai: LlmSource = {
  STORYFORGE_LLM_PROVIDER: 'openai',
  STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
  STORYFORGE_LLM_API_KEY: KEY,
  STORYFORGE_LLM_MODEL: 'm-1',
  STORYFORGE_LLM_RETRY_MAX_ATTEMPTS: '1',
};
const anthropic: LlmSource = { ...openai, STORYFORGE_LLM_PROVIDER: 'anthropic' };
const gemini: LlmSource = { ...openai, STORYFORGE_LLM_PROVIDER: 'gemini' };

type Reply =
  | { throws: HttpTransportError }
  | { status: number; chunks?: string[]; breakWith?: HttpTransportError };

function context(reply: Reply): LlmContext {
  return {
    http: {
      async send() {
        if ('throws' in reply) throw reply.throws;
        return {
          status: reply.status,
          headers: {},
          body: (async function* () {
            for (const chunk of reply.chunks ?? []) yield ENCODER.encode(chunk);
            if (reply.breakWith) throw reply.breakWith;
          })(),
          close() {},
        };
      },
    },
    clock: () => 0,
    wait: async () => {},
    random: () => 0,
    appVersion: 'test',
    secrets: { values: [KEY] },
  };
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

const drain = async (events: AsyncIterable<unknown>) => {
  for await (const _ of events);
};

const request: ChatRequest = {
  model: 'm-1',
  messages: [new ChatMessage('user', '写')],
  tools: [],
  temperature: null,
  maxTokens: null,
  toolChoice: null,
  reasoningEffort: null,
};

/** OpenAI 兼容：非流式 POST。 */
const viaJson = (reply: Reply) =>
  caught(() => requestChatCompletions(openai, { messages: [] }, {}, context(reply)));
/** OpenAI 兼容：流式 POST（对话循环带工具时 toolStream=true）。 */
const viaStream = (reply: Reply, toolStream = false) =>
  caught(() =>
    drain(rawStreamChatCompletions(openai, { messages: [] }, { toolStream }, context(reply))),
  );
/** Anthropic / Gemini 原生协议：非流式与 SSE。 */
const viaNativeJson = (reply: Reply) =>
  caught(() =>
    postJsonWithRetry(
      'https://llm.example/v1/messages',
      {},
      {},
      { timeoutSeconds: 30, maxAttempts: 1, serviceLabel: 'Anthropic' },
      context(reply),
    ),
  );
const viaNativeSse = (reply: Reply) =>
  caught(() =>
    drain(
      providerSseJson(
        anthropic,
        {
          url: 'https://llm.example/v1/messages',
          headers: {},
          payload: {},
          serviceLabel: 'Anthropic',
        },
        {},
        context(reply),
      ),
    ),
  );
const viaProviderStream = (source: LlmSource, reply: Reply) =>
  caught(() => drain(new ConfiguredLlmProvider(source, context(reply)).stream(request)));

const sse = (...events: unknown[]) =>
  events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`);
const chatChunk = (delta: unknown, finish: string | null = null) => ({
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const message = (error: unknown, retries = 0) => modelFailureMessage(error, retries);

describe('连不上 / 建连被重置', () => {
  const CONNECT =
    '模型调用失败：连不上模型服务（连接失败或被重置），请检查网络和设置里的服务地址后再试。';

  it('non-stream connect failure', async () => {
    const error = await viaJson({
      throws: new HttpTransportError('connect', 'tcp connect error: Connection refused'),
    });
    expect(error).toBeInstanceOf(LlmError);
    expect((error as Error).message).toContain('调用超时或连接失败');
    expect(message(error)).toBe(CONNECT);
  });

  it('stream connect reset before any frame', async () => {
    const error = await viaStream({ throws: new HttpTransportError('read', 'RemoteDisconnected') });
    expect((error as Error).message).toContain('流式建连被重置');
    expect(message(error)).toBe(CONNECT);
  });

  it('stream connect failure that is not a timeout', async () => {
    const error = await viaStream({
      throws: new HttpTransportError('connect', 'dns error: no such host'),
    });
    expect((error as Error).message).toContain('流式建连超时或失败');
    expect(message(error)).toBe(CONNECT);
  });

  it('native connect failures (Anthropic / Gemini)', async () => {
    const plain = await viaNativeJson({ throws: new HttpTransportError('connect', 'refused') });
    expect((plain as Error).message).toContain('Anthropic调用超时或连接失败');
    expect(message(plain)).toBe(CONNECT);
    const streamed = await viaNativeSse({ throws: new HttpTransportError('connect', 'refused') });
    expect((streamed as Error).message).toBe('Anthropic 流式建连失败：URLError');
    expect(message(streamed)).toBe(CONNECT);
  });
});

describe('等待超时', () => {
  const TIMEOUT = '模型调用失败：等模型回复超时，可以稍后重试，反复超时请检查网络和服务地址。';

  it('non-stream, stream and native timeouts', async () => {
    const timedOut = new HttpTransportError('timeout', 'timed out');
    for (const error of [
      await viaJson({ throws: timedOut }),
      await viaStream({ throws: timedOut }),
      await viaNativeJson({ throws: timedOut }),
      await viaNativeSse({ throws: timedOut }),
    ]) {
      expect(error).toBeInstanceOf(LlmError);
      expect(message(error)).toBe(TIMEOUT);
    }
  });

  it('HTTP 408 / 504 and a provider timeout category', async () => {
    expect(message(await viaJson({ status: 504, chunks: [MARK] }))).toBe(
      '模型调用失败：等模型回复超时（HTTP 504），可以稍后重试。',
    );
    const gateway = await viaProviderStream(gemini, {
      status: 200,
      chunks: sse({ error: { status: 'DEADLINE_EXCEEDED', message: MARK } }),
    });
    expect(gateway).toBeInstanceOf(ProviderError);
    expect(message(gateway)).toBe(TIMEOUT);
  });
});

describe('输出途中断开', () => {
  const BREAK = '模型调用失败：输出途中连接断开，可以再试一次，反复出现请检查网络或中转。';

  it('stream read break after output started', async () => {
    const error = await viaStream({
      status: 200,
      chunks: sse(chatChunk({ content: '雨夜' })),
      breakWith: new HttpTransportError('read', 'ConnectionResetError'),
    });
    expect(error).toBeInstanceOf(LlmStreamBreak);
    expect(message(error)).toBe(BREAK);
  });

  it('stream closed before its terminal marker', async () => {
    const error = await viaStream({ status: 200, chunks: sse(chatChunk({ content: '半句' })) });
    expect((error as Error).message).toContain('在收到终止标记前中断');
    expect(message(error)).toBe(BREAK);
  });

  it('non-stream body read reset and native stream read break', async () => {
    const reset = await viaJson({
      status: 200,
      chunks: ['{"choices"'],
      breakWith: new HttpTransportError('read', 'ConnectionResetError'),
    });
    expect((reset as Error).message).toContain('响应读取或解析失败');
    expect(message(reset)).toBe(BREAK);
    const native = await viaNativeSse({
      status: 200,
      chunks: sse({ type: 'message_start' }),
      breakWith: new HttpTransportError('read', 'IncompleteRead'),
    });
    expect((native as Error).message).toBe('Anthropic 流式读取中断：IncompleteRead');
    expect(message(native)).toBe(BREAK);
  });

  it('provider stream that ended without its terminal event', async () => {
    const error = await viaProviderStream(anthropic, {
      status: 200,
      chunks: sse({ type: 'message_start', message: { id: 'm' } }),
    });
    expect(error).toBeInstanceOf(ProviderError);
    expect(message(error)).toBe(BREAK);
  });

  it('a loop text stream that never completed, with the automatic resend count', async () => {
    const provider = {
      streaming: true,
      complete: async () => {
        throw new Error('not used');
      },
      async *stream() {
        yield { kind: 'text_delta' as const, text: '半句' };
      },
    };
    const error = await caught(() =>
      completeWithTextStream(provider, request, {
        onText: () => {},
        runId: 'run-1',
        roundIndex: 1,
        secrets: { values: [] },
        control: null,
        newStreamId: () => 's1',
      }),
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect(message(error, 2)).toBe(
      '模型调用失败：输出途中连接断开，已自动重试 2 次仍未成功，可以再试一次，反复出现请检查网络或中转。',
    );
  });
});

describe('HTTP 状态码', () => {
  const http = async (status: number, body = `{"error":{"message":"${MARK} ${KEY}"}}`) => {
    const error = await viaJson({ status, chunks: [body] });
    expect((error as Error).message).toContain(`HTTP ${status}`);
    const text = message(error);
    expect(text).not.toContain(MARK);
    expect(text).not.toContain(KEY);
    return text;
  };

  it('401 / 403 point at the API key', async () => {
    expect(await http(401)).toBe(
      '模型调用失败：模型服务拒绝了密钥（HTTP 401），请到设置里检查 API Key。',
    );
    expect(await http(403)).toBe(
      '模型调用失败：模型服务拒绝了密钥（HTTP 403），请到设置里检查 API Key。',
    );
  });

  it('404 points at the address or model name', async () => {
    expect(await http(404)).toBe(
      '模型调用失败：服务地址或模型名不对（HTTP 404），请到设置里检查。',
    );
  });

  it('429 is rate limiting or quota, 402 is balance', async () => {
    expect(await http(429)).toBe('模型调用失败：请求太频繁或额度用完（HTTP 429），可以稍后重试。');
    expect(await http(402)).toBe(
      '模型调用失败：模型服务提示余额或额度不足（HTTP 402），请到服务商那里查看余额后再试。',
    );
  });

  it('5xx is a server-side failure', async () => {
    for (const status of [500, 502, 503])
      expect(await http(status)).toBe(
        `模型调用失败：模型服务端出错（HTTP ${status}），可以稍后重试。`,
      );
  });

  it('400 / 422 hint that the relay or model may reject a parameter such as the thinking level', async () => {
    const hint =
      '中转或模型可能不认某个参数（例如思考等级），可以把思考等级调回「关」，或到设置里核对模型名。';
    expect(await http(400)).toBe(`模型调用失败：模型服务不接受这次请求（HTTP 400），${hint}`);
    expect(await http(422)).toBe(`模型调用失败：模型服务不接受这次请求（HTTP 422），${hint}`);
    const streamed = await viaStream({ status: 400, chunks: [MARK] });
    expect(message(streamed)).toBe(`模型调用失败：模型服务不接受这次请求（HTTP 400），${hint}`);
    const native = await viaNativeSse({ status: 400 });
    expect((native as Error).message).toBe('Anthropic 流式返回 HTTP 400。');
    expect(message(native)).toBe(`模型调用失败：模型服务不接受这次请求（HTTP 400），${hint}`);
  });

  it('an unknown status says it could not be classified', async () => {
    expect(await http(418)).toBe(
      '模型调用失败：模型服务返回 HTTP 418，原因未能归类，原始错误已记进本轮运行记录。',
    );
  });
});

describe('上下文超长', () => {
  const tooLong = (status: number) =>
    `模型调用失败：发给模型的内容超出了它能处理的长度（HTTP ${status}），请新开会话，或减少附带的参考后再试。`;

  it('413 and a 400 whose error code says the context is too long', async () => {
    expect(message(await viaJson({ status: 413, chunks: [MARK] }))).toBe(tooLong(413));
    const error = await viaJson({
      status: 400,
      chunks: [
        JSON.stringify({
          error: {
            message: `This model's maximum context length is 65536 tokens. ${MARK}`,
            code: 'context_length_exceeded',
          },
        }),
      ],
    });
    const text = message(error);
    expect(text).toBe(tooLong(400));
    expect(text).not.toContain(MARK);
  });

  it('an Anthropic request_too_large error event', async () => {
    const error = await viaProviderStream(anthropic, {
      status: 200,
      chunks: sse({ type: 'error', error: { type: 'request_too_large', message: MARK } }),
    });
    expect(message(error)).toBe(
      '模型调用失败：发给模型的内容超出了它能处理的长度，请新开会话，或减少附带的参考后再试。',
    );
  });
});

describe('返回为空 / 格式不对', () => {
  const EMPTY = '模型调用失败：模型这次返回为空，可以再试一次，反复出现请换个模型。';
  const FORMAT =
    '模型调用失败：模型返回的内容格式不对、无法解析，可以再试一次，反复出现请检查设置里的服务地址与协议是否对应。';

  it('an empty stream and an empty completion', async () => {
    const streamed = await viaStream({ status: 200, chunks: sse('[DONE]') });
    expect((streamed as Error).message).toBe('真实 LLM 流式返回内容为空。');
    expect(message(streamed)).toBe(EMPTY);
    const completed = await caught(() =>
      callLlm(
        openai,
        { systemPrompt: '系', userPrompt: '写' },
        context({
          status: 200,
          chunks: [
            JSON.stringify({
              choices: [
                { index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' },
              ],
            }),
          ],
        }),
      ),
    );
    expect((completed as Error).message).toContain('返回内容为空');
    expect(message(completed)).toBe(EMPTY);
  });

  it('a body that is not JSON, a stream event that is not JSON, a response without choices', async () => {
    const body = await viaJson({ status: 200, chunks: ['<html>gateway</html>'] });
    expect((body as Error).message).toContain('JSONDecodeError');
    expect(message(body)).toBe(FORMAT);
    const event = await viaNativeSse({ status: 200, chunks: sse('{not json') });
    expect((event as Error).message).toBe('Anthropic 流式事件不是合法 JSON。');
    expect(message(event)).toBe(FORMAT);
    const legacy = await caught(() =>
      callLlm(
        openai,
        { systemPrompt: '系', userPrompt: '写' },
        context({ status: 200, chunks: ['{"id":"x"}'] }),
      ),
    );
    expect(legacy).toBeInstanceOf(ProviderLlmError);
    expect(message(legacy)).toBe(FORMAT);
  });
});

describe('工具调用不完整', () => {
  const TOOL =
    '模型调用失败：模型返回的工具调用不完整或参数格式不对，可以再试一次，反复出现请换个支持工具调用的模型。';

  it('a malformed and an unfinished streamed tool call', async () => {
    const invalid = await viaStream(
      { status: 200, chunks: sse(chatChunk({ tool_calls: 'oops' })) },
      true,
    );
    expect((invalid as Error).message).toBe('Invalid streamed tool response.');
    expect(message(invalid)).toBe(TOOL);
    const incomplete = await viaStream(
      {
        status: 200,
        chunks: sse(
          chatChunk(
            {
              tool_calls: [
                {
                  index: 0,
                  id: 'c1',
                  type: 'function',
                  function: { name: 'fs_read', arguments: '{"a":' },
                },
              ],
            },
            'tool_calls',
          ),
          '[DONE]',
        ),
      },
      true,
    );
    expect((incomplete as Error).message).toBe('Incomplete streamed tool response.');
    expect(message(incomplete, 1)).toBe(
      '模型调用失败：模型返回的工具调用不完整或参数格式不对，已自动重试 1 次仍未成功，可以再试一次，反复出现请换个支持工具调用的模型。',
    );
  });

  it('a Gemini malformed function call', async () => {
    const error = await viaProviderStream(gemini, {
      status: 200,
      chunks: sse({
        candidates: [{ content: { parts: [] }, finishReason: 'MALFORMED_FUNCTION_CALL' }],
      }),
    });
    expect(error).toBeInstanceOf(ProviderError);
    expect(message(error)).toBe(TOOL);
  });
});

describe('被截断或过滤', () => {
  it('a completion cut by the token limit', async () => {
    const error = await caught(() =>
      callLlm(
        openai,
        { systemPrompt: '系', userPrompt: '写' },
        context({
          status: 200,
          chunks: [
            JSON.stringify({
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: '半' },
                  finish_reason: 'length',
                },
              ],
            }),
          ],
        }),
      ),
    );
    expect((error as Error).message).toContain('被截断或过滤');
    expect(message(error)).toBe(
      '模型调用失败：模型输出被截断或被过滤，可以把要求拆小或换个说法再试。',
    );
  });

  it('a provider content filter', async () => {
    const error = await viaProviderStream(gemini, {
      status: 200,
      chunks: sse({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }),
    });
    expect(error).toBeInstanceOf(ProviderError);
    expect(message(error)).toBe('模型调用失败：模型输出被服务方过滤，可以换个说法再试。');
  });
});

describe('provider 分类替代英文安全摘要', () => {
  const anthropicError = (type: string) =>
    viaProviderStream(anthropic, {
      status: 200,
      chunks: sse({ type: 'error', error: { type, message: MARK }, request_id: 'req_1' }),
    });

  it('maps Anthropic error types', async () => {
    const cases: [string, string][] = [
      ['authentication_error', '模型调用失败：模型服务拒绝了密钥，请到设置里检查 API Key。'],
      ['rate_limit_error', '模型调用失败：请求太频繁或额度用完，可以稍后重试。'],
      [
        'invalid_request_error',
        '模型调用失败：模型服务不接受这次请求，中转或模型可能不认某个参数（例如思考等级），可以把思考等级调回「关」，或到设置里核对模型名。',
      ],
      ['overloaded_error', '模型调用失败：模型服务暂时不可用或连接中断，可以稍后重试。'],
      ['api_error', '模型调用失败：模型服务端出错，可以稍后重试。'],
      ['not_found_error', '模型调用失败：服务地址或模型名不对，请到设置里检查。'],
    ];
    for (const [type, expected] of cases) {
      const error = await anthropicError(type);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as Error).message).toMatch(/^Anthropic request failed/);
      expect(message(error)).toBe(expected);
    }
  });

  it('uses the HTTP status a Gemini error event carries', async () => {
    const error = await viaProviderStream(gemini, {
      status: 200,
      chunks: sse({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: MARK } }),
    });
    expect(message(error)).toBe('模型调用失败：请求太频繁或额度用完（HTTP 429），可以稍后重试。');
  });

  it('keeps the category after the assistant path converts it to an LlmError', async () => {
    const error = await anthropicError('rate_limit_error');
    const legacy = legacyProviderError(error as ProviderError);
    expect(legacy).toBeInstanceOf(LlmError);
    expect(legacy.message).toBe('Anthropic request failed (rate_limit_error).');
    expect(message(legacy)).toBe('模型调用失败：请求太频繁或额度用完，可以稍后重试。');
  });

  it('names an unsupported capability', async () => {
    const provider = new OpenAICompatibleProvider({
      completeTransport: async () => ({ data: {}, startedAt: 0 }),
      usageParser: () => ({}),
      clock: () => 0,
    });
    const error = await caught(() => drain(provider.stream(request)));
    expect(error).toBeInstanceOf(ProviderError);
    expect(message(error)).toBe(
      '模型调用失败：这个模型或服务不支持本轮需要的功能（如工具调用），请换个模型再试。',
    );
  });
});

describe('配置不对', () => {
  it('an invalid auth header setting', () => {
    let error: unknown = null;
    try {
      llmRequestHeaders({ ...openai, STORYFORGE_LLM_AUTH_HEADER: 'cookie' }, 'test');
    } catch (caughtError) {
      error = caughtError;
    }
    expect(error).toBeInstanceOf(LlmConfigError);
    expect(message(error)).toBe(
      '模型调用失败：模型配置不完整或不对，请到设置里检查服务地址、模型名和 API Key。',
    );
  });
});

describe('认不出就照实说', () => {
  it('does not invent a reason', () => {
    expect(message(new LlmError('真实 LLM 重试后仍无响应数据。'))).toBe(
      '模型调用失败：原因未能归类，原始错误已记进本轮运行记录。',
    );
    expect(message(new Error(`${MARK} ${KEY}`))).toBe(
      '模型调用失败：原因未能归类，原始错误已记进本轮运行记录。',
    );
  });
});
