import {
  dumpJson,
  isJsonObject,
  JsonFloat,
  pythonStr,
  pythonTruthy,
  type JsonValue,
} from '../kernel/json';
import { pythonStrip } from '../kernel/pythonText';
import { redactSensitiveText, type SecretContext } from '../kernel/redaction';
import {
  envValue,
  optionalFloat,
  optionalInt,
  pythonFloat,
  requiredEnv,
  type LlmSource,
} from './config';

/** 真实 LLM 调用运行失败（HTTP 错误、超时、响应格式异常），HTTP 502；带上已知的用量。 */
export class LlmError extends Error {
  readonly status = 502;
  constructor(
    message: string,
    readonly usage: unknown = null,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** 上游给出超长 Retry-After 时不让 worker 空转数小时。 */
export const RETRY_DELAY_CEILING_SECONDS = 60;

/** 429 与 5xx 视为可重试的瞬时错误；其余 4xx 立即失败，不掩盖真实问题。 */
export const isRetryableStatus = (status: number) =>
  status === 429 || (status >= 500 && status <= 599);

/** Retry-After（秒）；缺失或非数字返回 null，回退到指数退避。头名不区分大小写。 */
export function retryAfterSeconds(
  headers: Readonly<Record<string, string>> | null | undefined,
): number | null {
  if (!headers) return null;
  const name = Object.keys(headers).find((key) => key.toLowerCase() === 'retry-after');
  const raw = name === undefined ? undefined : headers[name];
  if (!raw) return null;
  const seconds = pythonFloat(pythonStrip(raw));
  return seconds !== null && seconds >= 0 ? seconds : null;
}

/** 指数退避 + 抖动；服务端给了 Retry-After 就尊重它。都封顶 60 秒。 */
export function retryDelay(options: {
  attempt: number;
  baseDelay: number;
  jitter: number;
  retryAfter: number | null;
  random: () => number;
}): number {
  if (options.retryAfter !== null) return Math.min(options.retryAfter, RETRY_DELAY_CEILING_SECONDS);
  let delay = options.baseDelay * 2 ** (options.attempt - 1);
  if (options.jitter > 0) delay += options.random() * options.jitter;
  return Math.min(delay, RETRY_DELAY_CEILING_SECONDS);
}

const length = (text: string) => Array.from(text).length;

/**
 * 合并配置密钥与本次请求的凭据（_configured_secret_values）：去重、只留 6 字以上、按长度降序。
 * 等长密钥之间的先后 Python 依赖集合迭代序，这里取先出现者在前。
 */
export function withSecrets(
  context: SecretContext,
  extras: readonly (string | null | undefined)[],
): SecretContext {
  const values = [...extras, ...context.values].filter(
    (value): value is string => typeof value === 'string' && length(value) >= 6,
  );
  return { values: [...new Set(values)].sort((a, b) => length(b) - length(a)) };
}

/** 把给定密钥子串替换为 ***，再跑一遍常规脱敏；日志与错误文本兜底。 */
export function redactSecrets(
  text: string,
  secrets: readonly (string | null | undefined)[],
  context: SecretContext,
): string {
  let redacted = text;
  for (const secret of secrets)
    if (secret && length(secret) >= 6) redacted = redacted.split(secret).join('***');
  return redactSensitiveText(redacted, withSecrets(context, secrets));
}

export type ChatPayloadOptions = {
  messages: readonly JsonValue[];
  tools?: readonly JsonValue[] | null;
  toolChoice?: JsonValue | null;
  stream?: boolean;
  temperature?: number | JsonFloat | null;
  maxCompletionTokens?: number | null;
};

/** chat/completions 请求体；不传 per-call 覆盖时与既有调用方逐字节一致。 */
export function buildChatPayload(source: LlmSource, options: ChatPayloadOptions) {
  const payload: { [key: string]: unknown } = {
    model: requiredEnv(source, 'STORYFORGE_LLM_MODEL'),
    messages: options.messages,
    temperature:
      options.temperature ??
      new JsonFloat(optionalFloat(source, 'STORYFORGE_LLM_TEMPERATURE', 0.7)),
  };
  const maxTokens =
    options.maxCompletionTokens ?? optionalInt(source, 'STORYFORGE_LLM_MAX_COMPLETION_TOKENS', 0);
  if (maxTokens > 0) payload.max_completion_tokens = maxTokens;
  const effort = envValue(source, 'STORYFORGE_LLM_REASONING_EFFORT');
  if (effort) payload.reasoning_effort = effort;
  if (options.tools && options.tools.length) {
    payload.tools = options.tools;
    if (options.toolChoice !== undefined && options.toolChoice !== null)
      payload.tool_choice = options.toolChoice;
  }
  if (options.stream) {
    payload.stream = true;
    // 要 usage 必须显式开；不认这个字段的兼容端点回 400 时，传输层摘掉它重试一次。
    payload.stream_options = { include_usage: true };
  }
  return payload;
}

/** 请求体字节（json.dumps(payload, ensure_ascii=False)）。 */
export const chatPayloadText = (payload: unknown) => dumpJson(payload, { ensureAscii: false });

const firstChoice = (chunk: { [key: string]: JsonValue }) => {
  const choices = chunk.choices;
  return Array.isArray(choices) && choices.length ? choices[0] : undefined;
};

export function streamDeltaText(chunk: { [key: string]: JsonValue }): string {
  const choice = firstChoice(chunk);
  if (!isJsonObject(choice)) return '';
  const delta = choice.delta;
  if (!isJsonObject(delta)) return '';
  return typeof delta.content === 'string' ? delta.content : '';
}

/** 本帧的 finish_reason；非终止帧该字段为 null，取不到返回空串。 */
export function streamFinishReason(chunk: { [key: string]: JsonValue }): string {
  const choices = chunk.choices;
  if (!Array.isArray(choices)) return '';
  for (const choice of choices) {
    if (!isJsonObject(choice)) continue;
    const reason = choice.finish_reason;
    if (typeof reason === 'string' && reason) return reason;
  }
  return '';
}

export function assistantMessage(data: { [key: string]: JsonValue }) {
  const choice = firstChoice(data);
  if (choice === undefined)
    throw new LlmError('真实 LLM 响应缺少 choices，不能继续 BookRun 生成。');
  if (!isJsonObject(choice)) throw new LlmError('真实 LLM 响应 choices[0] 格式异常。');
  const message = choice.message;
  if (!isJsonObject(message))
    throw new LlmError('真实 LLM 响应缺少 message，不能继续 BookRun 生成。');
  return message;
}

const strOr = (value: JsonValue | undefined, fallback: string) =>
  pythonTruthy(value) ? pythonStr(value) : fallback;

/** 把 message.tool_calls 归一成 OpenAI 形状；参数对象序列化成 JSON 文本。 */
export function messageToolCalls(message: { [key: string]: JsonValue }) {
  const raw = message.tool_calls;
  if (!Array.isArray(raw)) return [];
  const calls: { id: string; type: string; function: { name: string; arguments: string } }[] = [];
  for (const call of raw) {
    if (!isJsonObject(call)) continue;
    const fn = call.function;
    if (!isJsonObject(fn)) continue;
    const args = fn.arguments;
    const argumentsText =
      Array.isArray(args) || isJsonObject(args)
        ? dumpJson(args, { ensureAscii: false })
        : strOr(args, '');
    calls.push({
      id: strOr(call.id, ''),
      type: strOr(call.type, 'function'),
      function: { name: strOr(fn.name, ''), arguments: argumentsText },
    });
  }
  return calls;
}
