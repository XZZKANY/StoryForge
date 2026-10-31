import {
  dumpJson,
  InputDomainError,
  isJsonObject,
  parseJson,
  type JsonObject,
  type JsonValue,
} from '../kernel/json';
import { pythonStrip } from '../kernel/pythonText';
import { decodeUtf8 } from '../readPort';
import {
  credentialHeaderValues,
  optionalFloat,
  optionalInt,
  requiredEnv,
  type LlmSource,
} from './config';
import { checkRunInterruption, requestTimeout, waitForRetry } from './control';
import {
  isRetryableStatus,
  LlmError,
  redactSecrets,
  retryAfterSeconds,
  retryDelay,
} from './payload';
import {
  floatText,
  HttpTransportError,
  type HttpResponse,
  type LlmContext,
  type TransportOptions,
} from './transport';

const ENCODER = new TextEncoder();
const isOk = (status: number) => status >= 200 && status < 300;
const elapsedMs = (ctx: LlmContext, startedAt: number) =>
  Math.trunc((ctx.clock() - startedAt) * 1000);

/** Python 的异常名：超时归 TimeoutError，连接失败归 URLError，读取失败用适配器给的名字。 */
const transportName = (error: HttpTransportError) =>
  error.kind === 'timeout' ? 'TimeoutError' : error.kind === 'connect' ? 'URLError' : error.detail;

async function readBytes(response: HttpResponse): Promise<Uint8Array> {
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

/** urllib.parse.quote：字母、数字与 `_.-~` 以及 safe 里的字符不转义，其余按 UTF-8 百分号转义。 */
export function pythonQuote(text: string, safe = '/'): string {
  let output = '';
  for (const byte of ENCODER.encode(text)) {
    const char = String.fromCharCode(byte);
    output +=
      /[A-Za-z0-9_.\-~]/.test(char) || (byte < 0x80 && safe.includes(char))
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return output;
}

export const providerUrl = (source: LlmSource, path: string) =>
  `${requiredEnv(source, 'STORYFORGE_LLM_BASE_URL').replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

/** 向非 chat 的 JSON 端点 POST：共用重试、退避、脱敏与 LlmError 语义（Anthropic / Gemini 原生协议用）。 */
export async function postJsonWithRetry(
  url: string,
  payload: JsonObject,
  headers: Readonly<Record<string, string>>,
  options: { timeoutSeconds: number; maxAttempts?: number; serviceLabel: string },
  ctx: LlmContext,
): Promise<JsonValue> {
  const body = ENCODER.encode(dumpJson(payload, { ensureAscii: false, separators: [',', ':'] }));
  const attemptLimit = Math.max(1, options.maxAttempts ?? 3);
  const startedAt = ctx.clock();
  const secrets = credentialHeaderValues(headers);
  const redact = (text: string) => redactSecrets(text, secrets, ctx.secrets);
  const label = options.serviceLabel;
  const sleep = (attempt: number, retryAfter: number | null) =>
    waitForRetry(
      ctx.control,
      ctx.wait,
      retryDelay({ attempt, baseDelay: 0.5, jitter: 0.25, retryAfter, random: ctx.random }),
    );
  for (let attempt = 1; attempt <= attemptLimit; attempt++) {
    let failure:
      | { kind: 'status'; response: HttpResponse }
      | { kind: 'connect' | 'read'; name: string };
    try {
      const response = await ctx.http.send({
        url,
        method: 'POST',
        headers,
        body,
        timeoutSeconds: requestTimeout(ctx.control, options.timeoutSeconds),
      });
      if (isOk(response.status)) {
        try {
          let text: string;
          try {
            text = decodeUtf8(await readBytes(response), { fatal: true });
          } catch (error) {
            if (error instanceof HttpTransportError) throw error;
            throw new HttpTransportError('read', 'UnicodeDecodeError');
          }
          try {
            return parseJson(text, 'response');
          } catch (error) {
            if (error instanceof InputDomainError)
              throw new HttpTransportError('read', 'JSONDecodeError');
            throw error;
          }
        } finally {
          response.close();
        }
      }
      failure = { kind: 'status', response };
    } catch (error) {
      if (!(error instanceof HttpTransportError)) throw error;
      failure =
        error.kind === 'read'
          ? { kind: 'read', name: error.detail }
          : { kind: 'connect', name: error.detail };
    }
    checkRunInterruption(ctx.control, 'http_error');
    const elapsed = elapsedMs(ctx, startedAt);
    if (failure.kind === 'status') {
      const { response } = failure;
      if (isRetryableStatus(response.status) && attempt < attemptLimit) {
        response.close();
        await sleep(attempt, retryAfterSeconds(response.headers));
        continue;
      }
      let detail: string;
      try {
        detail = Array.from(redact(decodeUtf8(await readBytes(response))))
          .slice(0, 2000)
          .join('');
      } catch {
        detail = '<无法读取响应体>';
      } finally {
        response.close();
      }
      throw new LlmError(
        redact(
          `${label}返回 HTTP ${response.status}（耗时 ${elapsed}ms，尝试 ${attempt}/${attemptLimit}）：${detail}`,
        ),
      );
    }
    if (attempt < attemptLimit) {
      await sleep(attempt, null);
      continue;
    }
    throw new LlmError(
      redact(
        failure.kind === 'connect'
          ? `${label}调用超时或连接失败（耗时 ${elapsed}ms，timeout=${floatText(options.timeoutSeconds)}s，` +
              `尝试 ${attempt}/${attemptLimit}）：${failure.name}`
          : `${label}响应读取或解析失败（耗时 ${elapsed}ms，尝试 ${attempt}/${attemptLimit}）：${failure.name}`,
      ),
    );
  }
  throw new LlmError(`${label}重试后仍无响应数据。`);
}

export async function providerCompleteJson(
  source: LlmSource,
  request: {
    url: string;
    headers: Readonly<Record<string, string>>;
    payload: JsonObject;
    serviceLabel: string;
  },
  options: TransportOptions,
  ctx: LlmContext,
): Promise<{ data: JsonValue; startedAt: number }> {
  const startedAt = ctx.clock();
  const data = await postJsonWithRetry(
    request.url,
    request.payload,
    request.headers,
    {
      timeoutSeconds:
        options.timeoutSeconds ?? optionalFloat(source, 'STORYFORGE_LLM_TIMEOUT_SECONDS', 300),
      maxAttempts:
        options.maxAttempts ?? optionalInt(source, 'STORYFORGE_LLM_RETRY_MAX_ATTEMPTS', 3),
      serviceLabel: request.serviceLabel,
    },
    ctx,
  );
  return { data, startedAt };
}

/** 原生协议的 SSE：逐个产出 data 事件里的 JSON 对象；建连阶段重试，读流阶段不重试。 */
export async function* providerSseJson(
  source: LlmSource,
  request: {
    url: string;
    headers: Readonly<Record<string, string>>;
    payload: JsonObject;
    serviceLabel: string;
  },
  options: TransportOptions,
  ctx: LlmContext,
): AsyncGenerator<JsonObject> {
  const timeout =
    options.timeoutSeconds ?? optionalFloat(source, 'STORYFORGE_LLM_TIMEOUT_SECONDS', 300);
  const attemptLimit = Math.max(
    1,
    options.maxAttempts ?? optionalInt(source, 'STORYFORGE_LLM_RETRY_MAX_ATTEMPTS', 3),
  );
  const body = ENCODER.encode(dumpJson(request.payload, { ensureAscii: false }));
  const secrets = credentialHeaderValues(request.headers);
  const label = request.serviceLabel;
  const sleep = (attempt: number, retryAfter: number | null) =>
    waitForRetry(
      ctx.control,
      ctx.wait,
      retryDelay({ attempt, baseDelay: 0.5, jitter: 0.25, retryAfter, random: ctx.random }),
    );
  let response: HttpResponse | null = null;
  for (let attempt = 1; attempt <= attemptLimit; attempt++) {
    try {
      const received = await ctx.http.send({
        url: request.url,
        method: 'POST',
        headers: request.headers,
        body,
        timeoutSeconds: requestTimeout(ctx.control, timeout),
      });
      if (isOk(received.status)) {
        response = received;
        break;
      }
      checkRunInterruption(ctx.control, 'http_error');
      received.close();
      if (isRetryableStatus(received.status) && attempt < attemptLimit) {
        await sleep(attempt, retryAfterSeconds(received.headers));
        continue;
      }
      throw new LlmError(`${label} 流式返回 HTTP ${received.status}。`);
    } catch (error) {
      if (!(error instanceof HttpTransportError)) throw error;
      checkRunInterruption(ctx.control, 'http_error');
      if (attempt < attemptLimit) {
        await sleep(attempt, null);
        continue;
      }
      throw new LlmError(
        redactSecrets(`${label} 流式建连失败：${transportName(error)}`, secrets, ctx.secrets),
      );
    }
  }
  if (response === null) throw new LlmError(`${label} 流式重试后仍无响应。`);
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
      if (step.done) ended = true;
      else {
        const joined = new Uint8Array(pending.length + step.value.length);
        joined.set(pending);
        joined.set(step.value, pending.length);
        pending = joined;
      }
    }
  };
  try {
    for (;;) {
      checkRunInterruption(ctx.control, 'before_stream_read');
      const raw = await nextLine();
      if (raw === null) return;
      const line = pythonStrip(decodeUtf8(raw));
      if (!line.startsWith('data:')) continue;
      const text = pythonStrip(line.slice(5));
      if (!text || text === '[DONE]') continue;
      let data: JsonValue;
      try {
        data = parseJson(text, 'stream event');
      } catch (error) {
        if (error instanceof InputDomainError)
          throw new LlmError(`${label} 流式事件不是合法 JSON。`);
        throw error;
      }
      if (isJsonObject(data)) yield data;
    }
  } catch (error) {
    if (error instanceof HttpTransportError) {
      checkRunInterruption(ctx.control, 'http_error');
      throw new LlmError(`${label} 流式读取中断：${transportName(error)}`);
    }
    throw error;
  } finally {
    await iterator.return?.(undefined);
    response.close();
  }
}
