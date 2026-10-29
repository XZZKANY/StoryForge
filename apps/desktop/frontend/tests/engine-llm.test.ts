import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  callLlm,
  callLlmStreamed,
  HttpTransportError,
  LlmConfigError,
  LlmConfigFileError,
  LlmError,
  type LlmContext,
} from '@storyforge/engine';
import { nativeHttpPort, nativeLlmSource } from '../src/lib/engine/llm';

vi.mock('@tauri-apps/api/core', () => {
  class Channel {
    constructor(readonly onmessage: (message: unknown) => void) {}
  }
  return { isTauri: () => true, invoke: vi.fn(), Channel };
});

const PLACEHOLDER = '[已隐藏的密钥]';
const BASE = 'https://api.example.test/v1';
const SOURCE = {
  STORYFORGE_LLM_PROVIDER: 'openai-compatible',
  STORYFORGE_LLM_BASE_URL: BASE,
  STORYFORGE_LLM_API_BASE_URL: BASE,
  STORYFORGE_LLM_MODEL: 'test-model',
  STORYFORGE_LLM_API_KEY: PLACEHOLDER,
  STORYFORGE_LLM_TIMEOUT_SECONDS: '60.0',
};

type Sent = { slot: string; request: Record<string, unknown> };
type Exchange = {
  status: number;
  headers?: Record<string, string>;
  chunks?: string[];
  ending?: Record<string, unknown>;
  early?: boolean;
};

const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64');
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function collect(body: AsyncIterable<Uint8Array>): Promise<string> {
  const parts: Uint8Array[] = [];
  for await (const chunk of body) parts.push(chunk);
  return text(Uint8Array.from(parts.flatMap((part) => Array.from(part))));
}

/** 假 Rust：按脚本回响应头，再经 Channel 推响应体（默认在命令返回之后才推）。 */
function fakeNative(exchanges: Exchange[]) {
  const sent: Sent[] = [];
  const closed: number[] = [];
  let id = 0;
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const input = args as Record<string, unknown>;
    if (command === 'engine_llm_close') {
      closed.push(input.id as number);
      return null;
    }
    if (command !== 'engine_llm_send') throw new Error(`unexpected ${command}`);
    const exchange = exchanges.shift();
    if (!exchange) throw new Error('no scripted exchange');
    sent.push({ slot: input.slot as string, request: input.request as Record<string, unknown> });
    const channel = input.onBody as { onmessage(message: unknown): void };
    const deliver = () => {
      for (const chunk of exchange.chunks ?? [])
        channel.onmessage({ event: 'chunk', data: b64(chunk) });
      channel.onmessage(exchange.ending ?? { event: 'end' });
    };
    if (exchange.early) deliver();
    else setTimeout(deliver, 0);
    id += 1;
    return { id, status: exchange.status, headers: exchange.headers ?? {} };
  });
  return { sent, closed };
}

function context(secrets: string[]): LlmContext {
  let now = 0;
  return {
    http: nativeHttpPort('main'),
    clock: () => (now += 0.25),
    wait: async () => undefined,
    random: () => 0.375,
    appVersion: '0.0.0-test',
    secrets: { values: secrets },
  };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

it('source carries only the placeholder, which becomes the whole secret snapshot', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(SOURCE);
  const { source, secrets } = await nativeLlmSource('main');
  expect(invoke).toHaveBeenLastCalledWith('get_engine_llm_source', { slot: 'main' });
  // 没打开项目时思考等级是「关」：空串压过进程环境变量。
  expect(source).toEqual({ ...SOURCE, STORYFORGE_LLM_REASONING_EFFORT: '' });
  expect(Object.isFrozen(source)).toBe(true);
  expect(secrets.values).toEqual([PLACEHOLDER]);

  vi.mocked(invoke).mockResolvedValueOnce({ ...SOURCE, STORYFORGE_LLM_API_KEY: '' });
  expect((await nativeLlmSource('polish')).secrets.values).toEqual([]);
  expect(invoke).toHaveBeenLastCalledWith('get_engine_llm_source', { slot: 'polish' });

  for (const bad of [null, [], { STORYFORGE_LLM_MODEL: 1 }, 'x']) {
    vi.mocked(invoke).mockResolvedValueOnce(bad);
    await expect(nativeLlmSource('main')).rejects.toThrow('Invalid Native LLM source');
  }
});

it('Native refusals keep their error classes', async () => {
  const boom = new RangeError('boom');
  const cases: [unknown, (error: unknown) => void][] = [
    [
      { kind: 'config', message: 'LLM 配置密钥保护/解密失败' },
      (error) => {
        expect(error).toBeInstanceOf(LlmConfigFileError);
        expect((error as LlmConfigFileError).status).toBe(503);
        expect((error as Error).message).toBe('LLM 配置密钥保护/解密失败');
      },
    ],
    [
      { kind: 'refused', message: '模型请求只能发往已配置的 base URL' },
      (error) => {
        expect(error).toBeInstanceOf(LlmConfigError);
        expect((error as LlmConfigError).status).toBe(422);
      },
    ],
    [
      { kind: 'timeout', message: 'timed out' },
      (error) => {
        expect(error).toBeInstanceOf(HttpTransportError);
        expect((error as HttpTransportError).kind).toBe('timeout');
        expect((error as HttpTransportError).detail).toBe('timed out');
      },
    ],
    [{ kind: 'mystery', message: 'x' }, (error) => expect(error).toBeInstanceOf(TypeError)],
    ['invalid args', (error) => expect((error as Error).message).toBe('invalid args')],
    [boom, (error) => expect(error).toBe(boom)],
  ];
  for (const [failure, check] of cases) {
    vi.mocked(invoke).mockRejectedValueOnce(failure);
    check(await nativeLlmSource('main').catch((error: unknown) => error));
  }
  vi.mocked(invoke).mockRejectedValueOnce({ kind: 'connect', message: 'refused (os error 10061)' });
  const error = await nativeHttpPort('main')
    .send({ url: `${BASE}/models`, method: 'GET', headers: {}, body: null, timeoutSeconds: 5 })
    .catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(HttpTransportError);
  expect((error as HttpTransportError).kind).toBe('connect');
});

it('serializes the request and streams early and late chunks in order', async () => {
  const native = fakeNative([
    { status: 200, headers: { 'content-type': 'text/plain' }, chunks: ['甲', '乙'], early: true },
    { status: 200, chunks: ['丙', '丁'] },
  ]);
  const large = new Uint8Array(0x8000 * 2 + 7).map((_, index) => (index * 37) % 256);
  const port = nativeHttpPort('polish');
  const first = await port.send({
    url: `${BASE}/chat/completions`,
    method: 'POST',
    headers: { Authorization: `Bearer ${PLACEHOLDER}` },
    body: large,
    timeoutSeconds: 0.25,
  });
  expect(first.status).toBe(200);
  expect(first.headers).toEqual({ 'content-type': 'text/plain' });
  expect(await collect(first.body)).toBe('甲乙');
  const second = await port.send({
    url: `${BASE}/models`,
    method: 'GET',
    headers: {},
    body: null,
    timeoutSeconds: 5,
  });
  expect(await collect(second.body)).toBe('丙丁');

  expect(native.sent[0].slot).toBe('polish');
  const request = native.sent[0].request;
  expect(request).toEqual({
    url: `${BASE}/chat/completions`,
    method: 'POST',
    headers: { Authorization: `Bearer ${PLACEHOLDER}` },
    body: Buffer.from(large).toString('base64'),
    timeoutSeconds: 0.25,
  });
  expect(native.sent[1].request.body).toBeNull();
  first.close();
  expect(native.closed).toEqual([]);
});

it('body failures surface as transport errors and close stops the stream once', async () => {
  const native = fakeNative([
    {
      status: 200,
      chunks: ['partial'],
      ending: { event: 'error', kind: 'read', detail: 'IncompleteRead' },
    },
    { status: 200, chunks: ['x'], ending: { event: 'surprise' } },
    { status: 200, chunks: ['never seen'] },
  ]);
  const port = nativeHttpPort('main');
  const send = () =>
    port.send({ url: `${BASE}/x`, method: 'GET', headers: {}, body: null, timeoutSeconds: 5 });

  const broken = await send();
  const seen: string[] = [];
  const failure = await (async () => {
    for await (const chunk of broken.body) seen.push(text(chunk));
  })().catch((error: unknown) => error);
  expect(seen).toEqual(['partial']);
  expect(failure).toBeInstanceOf(HttpTransportError);
  expect((failure as HttpTransportError).kind).toBe('read');
  expect((failure as HttpTransportError).detail).toBe('IncompleteRead');

  const invalid = await send();
  await expect(collect(invalid.body)).rejects.toThrow('Invalid Native LLM body event');

  const closed = await send();
  closed.close();
  closed.close();
  // Late events from the already-scheduled push must be ignored after close.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await collect(closed.body)).toBe('');
  expect(native.closed).toEqual([3]);

  for (const head of [
    { id: 1.5, status: 200, headers: {} },
    { id: 1, status: 99, headers: {} },
    { id: 1, status: 200, headers: { a: 1 } },
    null,
  ]) {
    vi.mocked(invoke).mockResolvedValueOnce(head);
    await expect(send()).rejects.toThrow('Invalid Native LLM response head');
  }
});

it('engine calls through the port send only the placeholder and redact its echo', async () => {
  const native = fakeNative([
    {
      status: 200,
      chunks: [
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ],
    },
    { status: 401, chunks: [`{"error":"bad key ${PLACEHOLDER}"}`] },
  ]);
  const ctx = context([PLACEHOLDER]);
  const streamed = await callLlmStreamed(SOURCE, { systemPrompt: '', userPrompt: '写' }, ctx);
  expect(streamed.content).toBe('你好世界');
  const request = native.sent[0].request;
  expect(request.url).toBe(`${BASE}/chat/completions`);
  expect(request.timeoutSeconds).toBe(60);
  expect((request.headers as Record<string, string>).Authorization).toBe(`Bearer ${PLACEHOLDER}`);

  const failure = await callLlm(SOURCE, { systemPrompt: 's', userPrompt: 'u' }, ctx).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(LlmError);
  // Python redacts the real key on this path the same way.
  expect((failure as Error).message).toContain('{"error":"bad key [REDACTED]"}');
  expect((failure as Error).message).not.toContain(PLACEHOLDER);
});
