import { InputDomainError, pythonFloatRepr, type JsonValue } from '../kernel/json';
import { redactSensitiveText, type SecretContext } from '../kernel/redaction';
import { ModelListHttpError } from '../llm/client';
import {
  envValue,
  LlmConfigError,
  LlmConfigFileError,
  missingLlmEnv,
  optionalFloat,
  type LlmSource,
} from '../llm/config';
import { decodeModelList, hostInfo, InvalidModelList, urlsplit } from '../llm/protocol';
import { HttpTransportError } from '../llm/transport';

/** 模型服务诊断：一次配置快照、只读请求与安全显示，不做模型生成，绝不回显凭据。 */

export const PROBE_TIMEOUT_CAP_SECONDS = 15.0;

export type ProviderHealthResponse = {
  status: 'ok' | 'unreachable' | 'unauthorized' | 'misconfigured';
  reachable: boolean;
  base_url: string | null;
  model: string | null;
  latency_ms: number | null;
  model_count: number | null;
  models: string[];
  detail: string | null;
  missing_env: string[];
};

export type ProviderHealthDeps = {
  /** 配置文件坏了抛 LlmConfigFileError（503），这里归为 misconfigured。 */
  resolveSource: () => Promise<{ source: LlmSource; secrets: SecretContext }>;
  fetchModels: (source: LlmSource, timeout: number) => Promise<JsonValue>;
  /** 单调时钟（秒）。 */
  clock: () => number;
};

const EMPTY: Omit<ProviderHealthResponse, 'status' | 'reachable'> = {
  base_url: null,
  model: null,
  latency_ms: null,
  model_count: null,
  models: [],
  detail: null,
  missing_env: [],
};

/** urllib.parse.quote(text, safe='')：UTF-8 百分号编码，只留字母数字与 `_.-~`。 */
function quoteAll(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function safeText(value: string, source: LlmSource, secrets: SecretContext): string {
  const secret = envValue(source, 'STORYFORGE_LLM_API_KEY');
  // 这里拿得到实际配置源，短 key 也不能借通用脱敏的最小长度规则漏出。
  if (secret) {
    const forms = [...new Set([secret, quoteAll(secret)])].sort(
      (a, b) => Array.from(b).length - Array.from(a).length,
    );
    for (const form of forms) value = value.split(form).join('[REDACTED]');
  }
  return redactSensitiveText(value, secrets);
}

function displayUrl(source: LlmSource, secrets: SecretContext): string | null {
  let parts;
  try {
    parts = urlsplit(envValue(source, 'STORYFORGE_LLM_BASE_URL'));
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  if (!['http', 'https'].includes(parts.scheme) || !hostInfo(parts.netloc)[0]) return null;
  const netloc = parts.netloc.slice(parts.netloc.lastIndexOf('@') + 1);
  return safeText(`${parts.scheme}://${netloc}${parts.path}`, source, secrets);
}

export async function probeProviderHealth(
  deps: ProviderHealthDeps,
): Promise<ProviderHealthResponse> {
  let source: LlmSource;
  let secrets: SecretContext;
  let missing: string[];
  try {
    ({ source, secrets } = await deps.resolveSource());
    missing = missingLlmEnv(source);
  } catch (error) {
    if (!(error instanceof LlmConfigFileError)) throw error;
    return {
      ...EMPTY,
      status: 'misconfigured',
      reachable: false,
      detail: '本地 LLM 配置不可用，请在桌面设置中检查或重新保存。',
    };
  }
  const finish = (response: ProviderHealthResponse): ProviderHealthResponse => ({
    ...response,
    detail: response.detail === null ? null : redactSensitiveText(response.detail, secrets),
  });
  if (missing.length)
    return finish({
      ...EMPTY,
      status: 'misconfigured',
      reachable: false,
      missing_env: missing,
      detail: '真实 LLM 未配置，缺少环境变量：' + missing.join(', '),
    });
  const identity = {
    base_url: displayUrl(source, secrets),
    model: safeText(envValue(source, 'STORYFORGE_LLM_MODEL'), source, secrets) || null,
  };
  const configured = optionalFloat(source, 'STORYFORGE_LLM_TIMEOUT_SECONDS', 300.0);
  const timeout =
    Number.isFinite(configured) && configured > 0
      ? Math.min(configured, PROBE_TIMEOUT_CAP_SECONDS)
      : PROBE_TIMEOUT_CAP_SECONDS;
  const startedAt = deps.clock();
  const latency = () => Math.max(0, Math.trunc((deps.clock() - startedAt) * 1000));
  const failure = (
    status: 'unreachable' | 'unauthorized' | 'misconfigured',
    detail: string,
    reachable = false,
  ) => finish({ ...EMPTY, ...identity, status, reachable, latency_ms: latency(), detail });

  let listing;
  try {
    const data = await deps.fetchModels(source, timeout);
    listing = decodeModelList(data, envValue(source, 'STORYFORGE_LLM_PROVIDER'));
  } catch (error) {
    // 不读 / 拼接不可信的响应体、原因与响应头，避免密钥反射及截断泄漏。
    if (error instanceof ModelListHttpError) {
      if (error.status === 401 || error.status === 403)
        return failure('unauthorized', `鉴权失败：HTTP ${error.status}（请检查密钥配置）。`, true);
      return failure('unreachable', `模型列表探测返回 HTTP ${error.status}。`);
    }
    if (error instanceof InputDomainError || error instanceof InvalidModelList)
      return failure('unreachable', '模型列表响应格式无效，无法完成诊断。');
    if (error instanceof HttpTransportError)
      return failure(
        'unreachable',
        `连接失败或响应读取超时（timeout=${pythonFloatRepr(timeout)}s）。`,
      );
    if (error instanceof LlmConfigError || error instanceof RangeError)
      return failure(
        'misconfigured',
        '模型连接配置无效；请检查 HTTP(S) 地址和鉴权方式，凭据只能配置在密钥项。',
      );
    throw error;
  }
  return finish({
    ...EMPTY,
    ...identity,
    status: 'ok',
    reachable: true,
    latency_ms: latency(),
    model_count: listing.received_count,
    models: listing.models.map((name) => safeText(name, source, secrets)),
    detail: listing.partial ? '仅显示本次探测返回的部分模型；模型数量不是完整总数。' : null,
  });
}
