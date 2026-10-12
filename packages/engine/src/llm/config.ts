import { pythonStrip } from '../kernel/pythonText';

/** 配置源：与 Python 的 `Mapping[str, str | None]` 同形，键是 `STORYFORGE_LLM_*`。 */
export type LlmSource = Readonly<Record<string, string | null | undefined>>;

/** 真实 LLM 调用缺少私有运行配置（缺 key / base_url / model 等），HTTP 422。 */
export class LlmConfigError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

export const REQUIRED_REAL_LLM_ENV = [
  'STORYFORGE_LLM_API_KEY',
  'STORYFORGE_LLM_BASE_URL',
  'STORYFORGE_LLM_MODEL',
  'STORYFORGE_LLM_PROVIDER',
] as const;

export function envValue(source: LlmSource, name: string): string {
  const value = source[name];
  return value && pythonStrip(value) ? pythonStrip(value) : '';
}

// Python int() / float() 的 ASCII 语法：数字之间可有单个下划线。Unicode 数字不在输入范围内，按非法处理。
const DIGITS = '[0-9](?:_?[0-9])*';
const INT = new RegExp(`^[+-]?${DIGITS}$`);
const FLOAT = new RegExp(
  `^[+-]?(?:(?:${DIGITS})(?:\\.(?:${DIGITS})?)?|\\.${DIGITS})(?:[eE][+-]?${DIGITS})?$`,
);
const SPECIAL = /^([+-]?)(inf|infinity|nan)$/i;

/** Python float(text)；非法返回 null。 */
export function pythonFloat(text: string): number | null {
  const value = pythonStrip(text);
  const special = SPECIAL.exec(value);
  if (special) {
    if (special[2].toLowerCase() === 'nan') return NaN;
    return special[1] === '-' ? -Infinity : Infinity;
  }
  return FLOAT.test(value) ? Number(value.replace(/_/g, '')) : null;
}

/** Python int(text)（十进制）；非法或超出安全整数返回 null。 */
export function pythonInt(text: string): number | null {
  const value = pythonStrip(text);
  if (!INT.test(value)) return null;
  const parsed = Number(value.replace(/_/g, ''));
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed === 0 ? 0 : parsed;
}

/** 畸形数值配置回退默认值，不冒泡成错误（与 Python 同）。 */
export function optionalInt(source: LlmSource, name: string, fallback: number): number {
  const value = envValue(source, name);
  return value ? (pythonInt(value) ?? fallback) : fallback;
}

export function optionalFloat(source: LlmSource, name: string, fallback: number): number {
  const value = envValue(source, name);
  return value ? (pythonFloat(value) ?? fallback) : fallback;
}

export function requiredEnv(source: LlmSource, name: string): string {
  const value = envValue(source, name);
  if (!value) throw new LlmConfigError(`缺少真实 LLM 生成环境变量：${name}。`);
  return value;
}

export function missingLlmEnv(source: LlmSource): string[] {
  return REQUIRED_REAL_LLM_ENV.filter((name) => !envValue(source, name));
}

export type ProviderFamily = 'openai' | 'anthropic' | 'gemini';

export function providerFamily(provider: string): ProviderFamily {
  const name = pythonStrip(provider).toLowerCase();
  if (name === 'anthropic' || name === 'claude') return 'anthropic';
  if (name === 'gemini' || name === 'google') return 'gemini';
  return 'openai';
}

/** 出网必须自报身份：缺省 UA 会被 Cloudflare 默认规则拦成 403。 */
export const userAgent = (appVersion: string) => `StoryForge/${appVersion}`;

export function openaiCompatibleHeaders(
  credential: string,
  authHeader: string,
  appVersion: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': userAgent(appVersion),
  };
  if (authHeader === 'api-key') {
    headers['api-key'] = credential;
    return headers;
  }
  if (authHeader !== 'bearer') throw new RangeError('unsupported_auth_header');
  headers.Authorization = `Bearer ${credential}`;
  return headers;
}

export function providerHeaders(
  provider: string,
  credential: string,
  authHeader: string,
  appVersion: string,
): Record<string, string> {
  const family = providerFamily(provider);
  if (family === 'openai') return openaiCompatibleHeaders(credential, authHeader, appVersion);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': userAgent(appVersion),
  };
  if (family === 'anthropic') {
    headers['x-api-key'] = credential;
    headers['anthropic-version'] = '2023-06-01';
  } else headers['x-goog-api-key'] = credential;
  return headers;
}

const authHeaderOf = (source: LlmSource) =>
  envValue(source, 'STORYFORGE_LLM_AUTH_HEADER').toLowerCase() || 'bearer';

function headersOrConfigError(build: () => Record<string, string>) {
  try {
    return build();
  } catch (error) {
    if (error instanceof RangeError)
      throw new LlmConfigError('STORYFORGE_LLM_AUTH_HEADER 只支持 api-key 或 bearer。');
    throw error;
  }
}

/** chat/completions 请求头（OpenAI 兼容）。 */
export function llmRequestHeaders(source: LlmSource, appVersion: string): Record<string, string> {
  const credential = requiredEnv(source, 'STORYFORGE_LLM_API_KEY');
  return headersOrConfigError(() =>
    openaiCompatibleHeaders(credential, authHeaderOf(source), appVersion),
  );
}

/** 原生 / 兼容 provider 与模型列表诊断共用的鉴权头。 */
export function providerRequestHeaders(
  source: LlmSource,
  appVersion: string,
): Record<string, string> {
  const credential = requiredEnv(source, 'STORYFORGE_LLM_API_KEY');
  return headersOrConfigError(() =>
    providerHeaders(
      envValue(source, 'STORYFORGE_LLM_PROVIDER'),
      credential,
      authHeaderOf(source),
      appVersion,
    ),
  );
}

/** 请求头里的凭据值（含去掉 `Bearer ` 前缀的裸 key），供错误文本脱敏。 */
export function credentialHeaderValues(headers: Readonly<Record<string, string>>): string[] {
  const secrets: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (!['authorization', 'api-key', 'x-api-key', 'x-goog-api-key'].includes(name.toLowerCase()))
      continue;
    secrets.push(value);
    if (value.toLowerCase().startsWith('bearer ')) secrets.push(value.slice(7));
  }
  return secrets;
}
