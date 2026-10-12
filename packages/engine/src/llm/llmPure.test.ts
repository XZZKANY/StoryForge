import { describe, expect, it } from 'vitest';
import golden from '../../golden/p2-llm-pure.json';
import { parseJson, pythonFloatRepr, type JsonValue } from '../kernel/json';
import {
  credentialHeaderValues,
  envValue,
  LlmConfigError,
  llmRequestHeaders,
  missingLlmEnv,
  optionalFloat,
  optionalInt,
  providerFamily,
  providerRequestHeaders,
  requiredEnv,
  type LlmSource,
} from './config';
import {
  assistantMessage,
  buildChatPayload,
  chatPayloadText,
  isRetryableStatus,
  LlmError,
  messageToolCalls,
  redactSecrets,
  retryAfterSeconds,
  retryDelay,
  streamDeltaText,
  streamFinishReason,
  withSecrets,
} from './payload';
import { decodeModelList, modelsUrl } from './protocol';
import { StreamingReasoningFilter, stripReasoningLeak, VisibleTextFilter } from './text';
import { costBreakdown, tokenUsage } from './usage';

const VERSION = golden.app_version;
const BASE = golden.base_source as LlmSource;
const NO_SECRETS = { values: [] };

/** Python repr(float | None)。 */
function repr(value: number | null): string {
  if (value === null) return 'None';
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  return pythonFloatRepr(value);
}

type Obj = { [key: string]: JsonValue };
type Row = {
  fn: string;
  args_json: string;
  output_json?: string;
  error?: { type: string; message: string };
};

function run(row: Row): unknown {
  // 带类型解析：1.0 与 1 分开（JsonFloat），与 Python 的 float / int 对应。
  const args = parseJson(row.args_json, 'args') as Obj;
  const plain = JSON.parse(row.args_json);
  switch (row.fn) {
    case 'optional_int':
      return optionalInt({ X: plain.raw }, 'X', -9);
    case 'optional_float':
      return repr(optionalFloat({ X: plain.raw }, 'X', -9.5));
    case 'env':
      return {
        value: envValue({ X: plain.value }, 'X'),
        missing: missingLlmEnv({ ...BASE, STORYFORGE_LLM_PROVIDER: plain.value }),
      };
    case 'required_env':
      return requiredEnv({ X: plain.value }, 'X');
    case 'provider_family':
      return providerFamily(plain.name);
    case 'headers': {
      const source = { ...BASE, ...plain.overrides };
      return {
        llm: llmRequestHeaders(source, VERSION),
        provider: providerRequestHeaders(source, VERSION),
      };
    }
    case 'credential_values':
      return credentialHeaderValues(plain.headers);
    case 'models_url':
      return modelsUrl(plain.url, plain.credential);
    case 'model_list':
      return decodeModelList(args.data, plain.provider, plain.limit);
    case 'strip_reasoning':
      return stripReasoningLeak(plain.text);
    case 'streaming_filter': {
      const filter = new StreamingReasoningFilter();
      const fed = (plain.chunks as string[]).map((chunk) => filter.feed(chunk));
      return { fed, flush: filter.flush(), stripped: filter.stripped };
    }
    case 'visible_filter': {
      const snapshot = withSecrets(NO_SECRETS, plain.secrets);
      const filter = new VisibleTextFilter(snapshot);
      const fed = (plain.chunks as string[]).map((chunk) => filter.feed(chunk));
      return { snapshot: snapshot.values, fed, finish: filter.finish(), stripped: filter.stripped };
    }
    case 'token_usage':
      return tokenUsage(args.data, plain.prompt, plain.content);
    case 'cost':
      return costBreakdown(plain.pricing, args.usage as Obj);
    case 'payload': {
      const options = args.options as Obj;
      const payload = buildChatPayload(
        { ...BASE, ...plain.overrides },
        {
          messages: args.messages as JsonValue[],
          tools: (options.tools as JsonValue[] | undefined) ?? null,
          toolChoice: options.tool_choice,
          stream: options.stream === true,
          temperature: options.temperature as number | undefined,
          maxCompletionTokens: options.max_completion_tokens as number | undefined,
        },
      );
      const body = chatPayloadText(payload);
      return { payload: JSON.parse(body), body };
    }
    case 'chunk':
      return {
        delta: streamDeltaText(args.chunk as Obj),
        finish: streamFinishReason(args.chunk as Obj),
      };
    case 'assistant_message':
      return assistantMessage(args.data as Obj);
    case 'tool_calls':
      return messageToolCalls(args.message as Obj);
    case 'retryable':
      return (plain.codes as number[]).map(isRetryableStatus);
    case 'retry_after':
      return repr(retryAfterSeconds(plain.headers));
    case 'retry_delay':
      return repr(
        retryDelay({
          attempt: plain.attempt,
          baseDelay: plain.base,
          jitter: plain.jitter,
          retryAfter: plain.retry_after,
          random: () => plain.random,
        }),
      );
    case 'redact_secrets':
      return redactSecrets(plain.text, plain.secrets, NO_SECRETS);
    default:
      throw new Error(`Unknown oracle ${row.fn}`);
  }
}

const ERRORS: Record<string, new (...args: never[]) => Error> = {
  LLMConfigError: LlmConfigError,
  LLMError: LlmError,
  ValueError: RangeError,
  InvalidModelList: RangeError,
};
/** Python 的这两种 ValueError 文本是协议码；urlsplit / ipaddress 的原文从不展示给作者，只核类型。 */
const EXACT_VALUE_ERRORS = new Set(['invalid_provider_url', 'credentials_in_provider_url']);

/** 范围外、按 §4.3.1 改判的 golden 行：超出安全整数的数值配置按非法回退默认值。条数钉死。 */
const REJUDGED: Record<string, unknown> = {
  'optional_int {"raw": "99999999999999999999"}': -9,
};

describe('real Python LLM channel pure layer', () => {
  it('pins the re-judged out-of-range rows', () => {
    const keys = (golden.pure as Row[]).map((row) => `${row.fn} ${row.args_json}`);
    expect(Object.keys(REJUDGED).filter((key) => keys.includes(key))).toHaveLength(1);
  });
  for (const [index, row] of (golden.pure as Row[]).entries()) {
    it(`${index} ${row.fn} ${row.args_json.slice(0, 60)}`, () => {
      const key = `${row.fn} ${row.args_json}`;
      if (key in REJUDGED) {
        expect(run(row)).toEqual(REJUDGED[key]);
        return;
      }
      if (row.error) {
        let caught: unknown = null;
        try {
          run(row);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(ERRORS[row.error.type]);
        if (row.error.type !== 'ValueError' || EXACT_VALUE_ERRORS.has(row.error.message))
          expect((caught as Error).message).toBe(row.error.message);
        return;
      }
      expect(run(row)).toEqual(JSON.parse(row.output_json!));
    });
  }
});

describe('LLM channel input range (§4.3.1)', () => {
  it('treats boolean or fractional provider usage as absent and falls back to the estimate', () => {
    const data = parseJson('{"usage": {"prompt_tokens": true, "completion_tokens": 5}}', 'usage');
    expect(tokenUsage(data, 'abcdefgh', 'abcd').token_usage_source).toBe('estimated_split');
  });
  it('treats Unicode digits and unsafe integers in numeric config as invalid (falls back to default)', () => {
    expect(optionalInt({ X: '１２' }, 'X', 3)).toBe(3);
    expect(optionalFloat({ X: '１.５' }, 'X', 0.7)).toBe(0.7);
    expect(optionalInt({ X: '9007199254740993' }, 'X', 3)).toBe(3);
  });
});
