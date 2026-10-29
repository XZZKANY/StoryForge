import { LlmConfigError } from './config';
import { ProviderError, type ProviderErrorDetails } from './contracts';
import { ProviderLlmError } from './payload';

/** 给作者的一句话：哪里出了问题、下一步做什么。 */
type Reading = { readonly reason: string; readonly next: string };

const UNCLASSIFIED = '原因未能归类，原始错误已记进本轮运行记录';
const BAD_REQUEST_NEXT =
  '中转或模型可能不认某个参数（例如思考等级），可以把思考等级调回「关」，或到设置里核对模型名';

const CONNECT: Reading = {
  reason: '连不上模型服务（连接失败或被重置）',
  next: '请检查网络和设置里的服务地址后再试',
};
const TIMEOUT: Reading = {
  reason: '等模型回复超时',
  next: '可以稍后重试，反复超时请检查网络和服务地址',
};
const STREAM_BREAK: Reading = {
  reason: '输出途中连接断开',
  next: '可以再试一次，反复出现请检查网络或中转',
};
const EMPTY: Reading = { reason: '模型这次返回为空', next: '可以再试一次，反复出现请换个模型' };
const FORMAT: Reading = {
  reason: '模型返回的内容格式不对、无法解析',
  next: '可以再试一次，反复出现请检查设置里的服务地址与协议是否对应',
};
const TOOL_CALL: Reading = {
  reason: '模型返回的工具调用不完整或参数格式不对',
  next: '可以再试一次，反复出现请换个支持工具调用的模型',
};
const TRUNCATED: Reading = {
  reason: '模型输出被截断或被过滤',
  next: '可以把要求拆小或换个说法再试',
};
const FILTERED: Reading = { reason: '模型输出被服务方过滤', next: '可以换个说法再试' };
const CONFIG: Reading = {
  reason: '模型配置不完整或不对',
  next: '请到设置里检查服务地址、模型名和 API Key',
};
const UNSUPPORTED: Reading = {
  reason: '这个模型或服务不支持本轮需要的功能（如工具调用）',
  next: '请换个模型再试',
};
const UNAVAILABLE: Reading = { reason: '模型服务暂时不可用或连接中断', next: '可以稍后重试' };

const tag = (status: number | null) => (status === null ? '' : `（HTTP ${status}）`);
const auth = (status: number | null): Reading => ({
  reason: `模型服务拒绝了密钥${tag(status)}`,
  next: '请到设置里检查 API Key',
});
const notFound = (status: number | null): Reading => ({
  reason: `服务地址或模型名不对${tag(status)}`,
  next: '请到设置里检查',
});
const rateLimited = (status: number | null): Reading => ({
  reason: `请求太频繁或额度用完${tag(status)}`,
  next: '可以稍后重试',
});
const badRequest = (status: number | null): Reading => ({
  reason: `模型服务不接受这次请求${tag(status)}`,
  next: BAD_REQUEST_NEXT,
});
const serverError = (status: number | null): Reading => ({
  reason: `模型服务端出错${tag(status)}`,
  next: '可以稍后重试',
});
const contextTooLong = (status: number | null): Reading => ({
  reason: `发给模型的内容超出了它能处理的长度${tag(status)}`,
  next: '请新开会话，或减少附带的参考后再试',
});

// 只用来在 400 里认出「上下文超长」这一类，不转述响应体。
const CONTEXT_OVERFLOW =
  /context_length_exceeded|context length|prompt is too long|request_too_large|exceeds the maximum number of tokens/i;

function statusReading(status: number, body: string): Reading {
  if (status === 401 || status === 403) return auth(status);
  if (status === 402)
    return {
      reason: `模型服务提示余额或额度不足（HTTP ${status}）`,
      next: '请到服务商那里查看余额后再试',
    };
  if (status === 404) return notFound(status);
  if (status === 413) return contextTooLong(status);
  if (status === 400 || status === 422)
    return CONTEXT_OVERFLOW.test(body) ? contextTooLong(status) : badRequest(status);
  if (status === 408 || status === 504)
    return { reason: `等模型回复超时（HTTP ${status}）`, next: '可以稍后重试' };
  if (status === 429) return rateLimited(status);
  if (status >= 500) return serverError(status);
  return { reason: `模型服务返回 HTTP ${status}`, next: UNCLASSIFIED };
}

const TOOL_CODES = new Set(['invalid_tool_arguments', 'MALFORMED_FUNCTION_CALL']);
const STREAM_CODES = new Set(['incomplete_text_stream', 'missing_stream_terminal']);
const FORMAT_CODES = new Set([
  'missing_content',
  'missing_candidates',
  'missing_choices',
  'invalid_choice',
  'missing_message',
]);

function providerReading(details: ProviderErrorDetails): Reading | null {
  const code = details.providerCode ?? '';
  if (TOOL_CODES.has(code)) return TOOL_CALL;
  if (STREAM_CODES.has(code)) return STREAM_BREAK;
  if (code === 'request_too_large') return contextTooLong(details.statusCode);
  if (details.statusCode !== null && details.statusCode >= 400)
    return statusReading(details.statusCode, '');
  if (code === 'not_found_error') return notFound(null);
  if (code === 'api_error') return serverError(null);
  if (FORMAT_CODES.has(code)) return FORMAT;
  switch (details.category) {
    case 'configuration':
      return CONFIG;
    case 'authentication':
      return auth(null);
    case 'rate_limit':
      return rateLimited(null);
    case 'invalid_request':
      return badRequest(null);
    case 'content_filter':
      return FILTERED;
    case 'unsupported':
      return UNSUPPORTED;
    case 'timeout':
      return TIMEOUT;
    case 'connection':
      return UNAVAILABLE;
    default:
      return null;
  }
}

const TOOL_STREAM_FAILURE = /^(Invalid|Incomplete) streamed tool response\.$/;
const HTTP_STATUS = /返回 HTTP (\d{3})/;
const TIMED_OUT = /timed out|TimeoutError/i;
const DECODE_FAILURE = /JSONDecodeError|UnicodeDecodeError/;

/** 传输层与客户端自己拼的报错：冒号前是我们写的前缀，冒号后是细节或（已脱敏的）响应体。 */
function textReading(text: string): Reading | null {
  if (TOOL_STREAM_FAILURE.test(text)) return TOOL_CALL;
  const cut = text.indexOf('：');
  const head = cut < 0 ? text : text.slice(0, cut);
  const tail = cut < 0 ? '' : text.slice(cut + 1);
  const status = HTTP_STATUS.exec(head);
  if (status) return statusReading(Number(status[1]), tail);
  if (head.includes('流式建连被重置')) return CONNECT;
  if (
    head.includes('建连超时或失败') ||
    head.includes('调用超时或连接失败') ||
    head.includes('流式建连失败')
  )
    return TIMED_OUT.test(tail) ? TIMEOUT : CONNECT;
  if (
    head.includes('流式读取中断') ||
    head.includes('在收到终止标记前中断') ||
    head.includes('流式结束但未返回终帧')
  )
    return STREAM_BREAK;
  if (head.includes('响应读取或解析失败')) return DECODE_FAILURE.test(tail) ? FORMAT : STREAM_BREAK;
  if (head.includes('不是合法 JSON') || head.includes('响应缺少') || head.includes('格式异常'))
    return FORMAT;
  if (
    head.includes('返回内容为空') ||
    head.includes('既无正文也无工具调用') ||
    head.includes('仅含思维链')
  )
    return EMPTY;
  if (head.includes('被截断或过滤')) return TRUNCATED;
  return null;
}

function readFailure(failure: unknown): Reading | null {
  if (failure instanceof ProviderError) return providerReading(failure.details);
  if (failure instanceof ProviderLlmError)
    return providerReading(failure.provider) ?? textReading(failure.message);
  if (failure instanceof LlmConfigError) return CONFIG;
  if (failure instanceof Error) return textReading(failure.message);
  if (typeof failure === 'string') return textReading(failure);
  return null;
}

/**
 * 模型调用失败时给作者看的那一句：原因 + 下一步。认不出就照实说认不出，不编原因；
 * 原始报错（传输层已脱敏）由调用方另记进证据，这里从不转述服务端响应体。
 */
export function modelFailureMessage(failure: unknown, streamRetries = 0): string {
  const reading = readFailure(failure) ?? (streamRetries > 0 ? STREAM_BREAK : null);
  if (reading === null) return `模型调用失败：${UNCLASSIFIED}。`;
  const retried = streamRetries > 0 ? `，已自动重试 ${streamRetries} 次仍未成功` : '';
  return `模型调用失败：${reading.reason}${retried}，${reading.next}。`;
}
