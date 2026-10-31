import type { ModelObservation } from './observation';
import {
  InputDomainError,
  isJsonObject,
  parseJson,
  pythonFloatRepr,
  pythonStr,
  pythonTruthy,
  type JsonObject,
  type JsonValue,
} from '../kernel/json';
import { cpLen, cpSlice, pythonStrip } from '../kernel/pythonText';
import { redactSensitiveText, type SecretContext } from '../kernel/redaction';
import {
  credentialHeaderValues,
  envValue,
  llmRequestHeaders,
  optionalFloat,
  optionalInt,
  requiredEnv,
  type LlmSource,
} from './config';
import { TokenUsage } from './contracts';
import { checkRunInterruption, requestTimeout, waitForRetry, type RunControl } from './control';
import { OpenAIToolStream, ToolStreamError } from './openaiStream';
import {
  chatPayloadText,
  isRetryableStatus,
  LlmError,
  LlmStreamBreak,
  redactSecrets,
  retryAfterSeconds,
  retryDelay,
  streamDeltaText,
  streamFinishReason,
  withSecrets,
} from './payload';
import { StreamingReasoningFilter, VisibleTextFilter } from './text';
import { costBreakdown, providerCacheHitTokens, tokenUsage } from './usage';

export type HttpRequest = {
  url: string;
  method: 'GET' | 'POST';
  headers: Readonly<Record<string, string>>;
  body: Uint8Array | null;
  timeoutSeconds: number;
};

export type HttpResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: AsyncIterable<Uint8Array>;
  close(): void;
};

/** 出网端口（桌面端由 Rust 发请求）。状态码不论好坏都作为响应返回；网络层失败抛 HttpTransportError。 */
export interface HttpPort {
  send(request: HttpRequest): Promise<HttpResponse>;
}

/**
 * connect / timeout：建连失败或超时（Python 的 URLError / TimeoutError，detail 是原因文本）；
 * read：连接已建立后读取被重置或截断（Python 的 ConnectionError / IncompleteRead，detail 是异常名）。
 */
export class HttpTransportError extends Error {
  constructor(
    readonly kind: 'connect' | 'timeout' | 'read',
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'HttpTransportError';
  }
}

export type LlmContext = {
  http: HttpPort;
  /** 单调时钟（秒）。 */
  clock: () => number;
  wait: (seconds: number) => Promise<void>;
  random: () => number;
  appVersion: string;
  /** 配置 owner 交来的完整有序密钥快照。 */
  secrets: SecretContext;
  control?: RunControl | null;
  /** agent 运行里的本地模型请求证据范围；助手直连路径没有。 */
  observation?: ModelObservation | null;
};

export type TransportOptions = { timeoutSeconds?: number | null; maxAttempts?: number | null };

/** 读取或解析响应体失败；name 与 Python 的异常名一致。 */
class ResponseReadError extends Error {
  constructor(readonly typeName: string) {
    super(typeName);
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const UTF8_REPLACE = new TextDecoder('utf-8', { ignoreBOM: true });
const ENCODER = new TextEncoder();
const elapsedMs = (ctx: LlmContext, startedAt: number) =>
  Math.trunc((ctx.clock() - startedAt) * 1000);

/** Python str(float)。 */
export function floatText(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  return pythonFloatRepr(value);
}

const chatUrl = (source: LlmSource) =>
  `${requiredEnv(source, 'STORYFORGE_LLM_BASE_URL').replace(/\/+$/, '')}/chat/completions`;

function retrySettings(source: LlmSource, options: TransportOptions) {
  return {
    timeout: options.timeoutSeconds ?? optionalFloat(source, 'STORYFORGE_LLM_TIMEOUT_SECONDS', 300),
    attemptLimit: Math.max(
      1,
      options.maxAttempts ?? optionalInt(source, 'STORYFORGE_LLM_RETRY_MAX_ATTEMPTS', 3),
    ),
    baseDelay: Math.max(0, optionalFloat(source, 'STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS', 0.5)),
    jitter: Math.max(0, optionalFloat(source, 'STORYFORGE_LLM_RETRY_JITTER_SECONDS', 0.25)),
  };
}

async function readAll(response: HttpResponse): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.body) chunks.push(chunk);
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/** 读完响应体：超时按建连类处理，其余读取 / 解码 / 解析失败带 Python 的异常名。 */
async function readJsonBody(response: HttpResponse): Promise<JsonValue> {
  let raw: Uint8Array;
  try {
    raw = await readAll(response);
  } catch (error) {
    if (error instanceof HttpTransportError && error.kind === 'read')
      throw new ResponseReadError(error.detail);
    throw error;
  }
  let text: string;
  try {
    text = UTF8.decode(raw);
  } catch {
    throw new ResponseReadError('UnicodeDecodeError');
  }
  try {
    return parseJson(text, 'response');
  } catch (error) {
    if (error instanceof InputDomainError) throw new ResponseReadError('JSONDecodeError');
    throw error;
  }
}

/** 诊断用：读不出错误响应体不能掩盖原始 HTTP 错误。 */
function interruptClosing(
  control: Parameters<typeof checkRunInterruption>[0],
  response: HttpResponse,
) {
  try {
    checkRunInterruption(control, 'http_error');
  } catch (error) {
    response.close();
    throw error;
  }
}

async function errorBody(response: HttpResponse): Promise<string> {
  try {
    return UTF8_REPLACE.decode(await readAll(response));
  } catch {
    return '<无法读取响应体>';
  } finally {
    response.close();
  }
}

const isOk = (status: number) => status >= 200 && status < 300;

/** POST /chat/completions：429 / 5xx 退避重试（尊重 Retry-After），读取失败也重试；返回响应与起始时刻。 */
export async function requestChatCompletions(
  source: LlmSource,
  payload: unknown,
  options: TransportOptions,
  ctx: LlmContext,
): Promise<{ data: JsonValue; startedAt: number }> {
  const body = ENCODER.encode(chatPayloadText(payload));
  const url = chatUrl(source);
  const headers = llmRequestHeaders(source, ctx.appVersion);
  const { timeout, attemptLimit, baseDelay, jitter } = retrySettings(source, options);
  const extras = [
    envValue(source, 'STORYFORGE_LLM_API_KEY'),
    envValue(source, 'STORYFORGE_LLM_AUTH_TOKEN'),
  ];
  const redact = (text: string) => redactSensitiveText(text, withSecrets(ctx.secrets, extras));
  const startedAt = ctx.clock();
  const sleep = (attempt: number, retryAfter: number | null) =>
    waitForRetry(
      ctx.control,
      ctx.wait,
      retryDelay({ attempt, baseDelay, jitter, retryAfter, random: ctx.random }),
    );
  for (let attempt = 1; attempt <= attemptLimit; attempt++) {
    try {
      const response = await ctx.http.send({
        url,
        method: 'POST',
        headers,
        body,
        timeoutSeconds: requestTimeout(ctx.control, timeout),
      });
      if (!isOk(response.status)) {
        // 拿到错误回包时恰好取消了：先放掉回包再抛中断，别让宿主那边继续读完错误体。
        interruptClosing(ctx.control, response);
        const elapsed = elapsedMs(ctx, startedAt);
        if (isRetryableStatus(response.status) && attempt < attemptLimit) {
          response.close();
          await sleep(attempt, retryAfterSeconds(response.headers));
          continue;
        }
        const detail = cpSlice(redact(await errorBody(response)), 2000);
        throw new LlmError(
          `真实 LLM 返回 HTTP ${response.status}（耗时 ${elapsed}ms，尝试 ${attempt}/${attemptLimit}）：${detail}`,
        );
      }
      try {
        return { data: await readJsonBody(response), startedAt };
      } finally {
        response.close();
      }
    } catch (error) {
      if (error instanceof HttpTransportError && error.kind !== 'read') {
        checkRunInterruption(ctx.control, 'http_error');
        const elapsed = elapsedMs(ctx, startedAt);
        if (attempt < attemptLimit) {
          await sleep(attempt, null);
          continue;
        }
        throw new LlmError(
          `真实 LLM 调用超时或连接失败（耗时 ${elapsed}ms，timeout=${floatText(timeout)}s，` +
            `尝试 ${attempt}/${attemptLimit}）：${redact(error.detail)}`,
        );
      }
      if (
        error instanceof ResponseReadError ||
        (error instanceof HttpTransportError && error.kind === 'read')
      ) {
        checkRunInterruption(ctx.control, 'http_error');
        const elapsed = elapsedMs(ctx, startedAt);
        if (attempt < attemptLimit) {
          await sleep(attempt, null);
          continue;
        }
        const name = error instanceof ResponseReadError ? error.typeName : error.detail;
        throw new LlmError(
          `真实 LLM 响应读取或解析失败（耗时 ${elapsed}ms，尝试 ${attempt}/${attemptLimit}）：${name}`,
        );
      }
      throw error;
    }
  }
  throw new LlmError('真实 LLM 重试后仍无响应数据。');
}

/** 按 `\n` 切行（HTTPResponse 的逐行迭代），每行按 UTF-8 替换解码后去两端空白。 */
async function* responseLines(
  response: HttpResponse,
  control: RunControl | null | undefined,
): AsyncGenerator<string> {
  const iterator = response.body[Symbol.asyncIterator]();
  let pending = new Uint8Array(0);
  let ended = false;
  const nextLine = async (): Promise<Uint8Array | null> => {
    for (;;) {
      const newline = pending.indexOf(0x0a);
      if (newline >= 0) {
        const line = pending.slice(0, newline + 1);
        pending = pending.slice(newline + 1);
        return line;
      }
      if (ended) {
        if (!pending.length) return null;
        const line = pending;
        pending = new Uint8Array(0);
        return line;
      }
      const step = await iterator.next();
      if (step.done) {
        ended = true;
        continue;
      }
      const joined = new Uint8Array(pending.length + step.value.length);
      joined.set(pending);
      joined.set(step.value, pending.length);
      pending = joined;
    }
  };
  try {
    for (;;) {
      // 与 controlled_iterator 同：每次取下一行（包括探到结尾的那一次）之前都检查中断。
      checkRunInterruption(control, 'before_stream_read');
      const line = await nextLine();
      if (line === null) return;
      yield pythonStrip(UTF8_REPLACE.decode(line));
    }
  } finally {
    await iterator.return?.(undefined);
  }
}

export type StreamFrame = { type: string; [key: string]: unknown };

/**
 * 流式 POST /chat/completions：逐块产出 delta，收尾产出含记账的 done。
 * 一旦开始吐字就不再重试（重连会让作者看到重复的半段正文）；重试只包住建连阶段。
 */
export async function* rawStreamChatCompletions(
  source: LlmSource,
  payload: { [key: string]: unknown },
  options: TransportOptions & { toolStream?: boolean },
  ctx: LlmContext,
): AsyncGenerator<StreamFrame> {
  const url = chatUrl(source);
  const headers = llmRequestHeaders(source, ctx.appVersion);
  const secrets = credentialHeaderValues(headers);
  const redact = (text: string) => redactSecrets(text, secrets, ctx.secrets);
  const { timeout, attemptLimit, baseDelay, jitter } = retrySettings(source, options);
  const startedAt = ctx.clock();
  const sleep = (attempt: number, retryAfter: number | null) =>
    waitForRetry(
      ctx.control,
      ctx.wait,
      retryDelay({ attempt, baseDelay, jitter, retryAfter, random: ctx.random }),
    );
  const active = { ...payload };
  let dropped = false;
  let attempt = 1;
  let response: HttpResponse | null = null;
  while (response === null) {
    let received: HttpResponse;
    try {
      received = await ctx.http.send({
        url,
        method: 'POST',
        headers,
        body: ENCODER.encode(chatPayloadText(active)),
        timeoutSeconds: requestTimeout(ctx.control, timeout),
      });
    } catch (error) {
      if (!(error instanceof HttpTransportError)) throw error;
      checkRunInterruption(ctx.control, 'http_error');
      const elapsed = elapsedMs(ctx, startedAt);
      if (attempt < attemptLimit) {
        await sleep(attempt, null);
        attempt += 1;
        continue;
      }
      // 尚未消费任何流帧：建连阶段的重置与超时可以重发，不会重复正文。
      throw new LlmError(
        error.kind === 'read'
          ? redact(
              `真实 LLM 流式建连被重置（耗时 ${elapsed}ms，尝试 ${attempt}/${attemptLimit}）：${error.detail}`,
            )
          : redact(
              `真实 LLM 流式建连超时或失败（耗时 ${elapsed}ms，timeout=${floatText(timeout)}s，` +
                `尝试 ${attempt}/${attemptLimit}）：${error.detail}`,
            ),
      );
    }
    if (isOk(received.status)) {
      response = received;
      break;
    }
    interruptClosing(ctx.control, received);
    if (
      received.status === 400 &&
      !dropped &&
      'stream_options' in active &&
      attempt < attemptLimit
    ) {
      // 兼容协商也是一次请求：共用尝试上限。
      received.close();
      delete active.stream_options;
      dropped = true;
      await waitForRetry(ctx.control, ctx.wait, 0);
      attempt += 1;
      continue;
    }
    const elapsed = elapsedMs(ctx, startedAt);
    if (isRetryableStatus(received.status) && attempt < attemptLimit) {
      received.close();
      await sleep(attempt, retryAfterSeconds(received.headers));
      attempt += 1;
      continue;
    }
    const detail = cpSlice(redact(await errorBody(received)), 2000);
    throw new LlmError(
      redact(
        `真实 LLM 流式返回 HTTP ${received.status}（耗时 ${elapsed}ms，尝试 ${attempt}/${attemptLimit}）：${detail}`,
      ),
    );
  }

  const toolStream = options.toolStream === true;
  const filter = toolStream
    ? new VisibleTextFilter(withSecrets(ctx.secrets, secrets))
    : new StreamingReasoningFilter();
  const toolParts = new OpenAIToolStream();
  const emitted: string[] = [];
  let usagePayload: JsonObject | null = null;
  let sawTerminal = false;
  let finishReason: string | null = null;
  try {
    for await (const line of responseLines(response, ctx.control)) {
      if (!line || !line.startsWith('data:')) continue;
      const chunkText = pythonStrip(line.slice(5));
      if (chunkText === '[DONE]') {
        sawTerminal = true;
        finishReason = finishReason || 'stop';
        break;
      }
      let chunk: JsonValue;
      try {
        chunk = parseJson(chunkText, 'stream chunk');
      } catch (error) {
        if (error instanceof InputDomainError) continue; // 心跳 / 注释帧：跳过，不打断作者在看的流。
        throw error;
      }
      if (!isJsonObject(chunk)) continue;
      if (toolStream) {
        try {
          toolParts.feed(chunk);
        } catch (error) {
          if (error instanceof ToolStreamError)
            throw new LlmError('Invalid streamed tool response.');
          throw error;
        }
      }
      const reason = streamFinishReason(chunk);
      if (reason) {
        // 两种终止标记都认：只发其一的端点不该被误判成截断。
        finishReason = reason;
        sawTerminal = true;
      }
      const chunkUsage = chunk.usage;
      if (isJsonObject(chunkUsage) && Object.keys(chunkUsage).length) {
        usagePayload = { ...(usagePayload ?? {}), ...chunkUsage };
        const counts: Record<string, number> = {};
        for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
          const value = usagePayload[key];
          if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
            counts[key] = value;
        }
        if (Object.keys(counts).length) {
          const usage = new TokenUsage(
            counts.prompt_tokens ?? 0,
            counts.completion_tokens ?? 0,
            counts.total_tokens ?? (counts.prompt_tokens ?? 0) + (counts.completion_tokens ?? 0),
            providerCacheHitTokens(usagePayload),
            null,
            'provider_usage',
          );
          yield { type: 'usage', ...usage.toLegacy() };
        }
      }
      const delta = streamDeltaText(chunk);
      if (!delta) continue;
      const visible = filter.feed(delta);
      if (visible) {
        emitted.push(visible);
        yield { type: 'delta', text: visible };
      }
    }
  } catch (error) {
    if (error instanceof HttpTransportError) {
      checkRunInterruption(ctx.control, 'http_error');
      const name = error.kind === 'timeout' ? 'TimeoutError' : error.detail;
      throw new LlmStreamBreak(
        `真实 LLM 流式读取中断（已输出 ${cpLen(emitted.join(''))} 字）：${name}`,
      );
    }
    throw error;
  } finally {
    response.close();
  }

  const tail = filter instanceof VisibleTextFilter ? filter.finish() : filter.flush();
  if (tail) {
    emitted.push(tail);
    yield { type: 'delta', text: tail };
  }
  const content = pythonStrip(emitted.join(''));
  let toolCalls: ReturnType<OpenAIToolStream['complete']> = [];
  if (toolStream)
    try {
      toolCalls = toolParts.complete(finishReason);
    } catch (error) {
      if (error instanceof ToolStreamError)
        throw new LlmError('Incomplete streamed tool response.');
      throw error;
    }
  if (
    !content &&
    !toolCalls.length &&
    !(toolStream && (finishReason === 'length' || finishReason === 'content_filter'))
  )
    throw new LlmError('真实 LLM 流式返回内容为空。');
  if (!sawTerminal)
    // 上游在收尾标记前关流：半截正文在自动档下会不经作者点击写进文件，宁可失败。
    throw new LlmError(
      `真实 LLM 流式在收到终止标记前中断（已输出 ${cpLen(content)} 字），不能把半截正文当成稿。`,
    );
  const messages = payload.messages;
  const promptText = Array.isArray(messages)
    ? (messages as JsonValue[])
        .filter(isJsonObject)
        .map((item) => (pythonTruthy(item.content) ? pythonStr(item.content) : ''))
        .join('\n')
    : '';
  const usage = tokenUsage(usagePayload ? { usage: usagePayload } : null, promptText, content);
  const cost = costBreakdown(source, usage);
  const done: StreamFrame = {
    type: 'done',
    content,
    finish_reason: finishReason,
    ...usage,
    cost_cny_estimated: 'total_cny' in cost ? cost.total_cny : null,
    cost_breakdown: cost,
    latency_ms: Math.max(0, elapsedMs(ctx, startedAt)),
  };
  if (toolStream) {
    done.tool_calls = toolCalls;
    done.response_id = toolParts.responseId;
  }
  if (filter.stripped) done.reasoning_leak_stripped = true;
  yield done;
}
