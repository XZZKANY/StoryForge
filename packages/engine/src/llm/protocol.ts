import { isJsonObject, pythonTruthy, type JsonValue } from '../kernel/json';
import { PYTHON_WHITESPACE, pythonStrip } from '../kernel/pythonText';
import { isSensitiveKey } from '../kernel/redaction';
import { providerFamily } from './config';

/** 只读模型列表不符合所配置的协议；不携带原始响应。 */
export class InvalidModelList extends RangeError {
  constructor(code: string) {
    super(code);
    this.name = 'InvalidModelList';
  }
}

export type ProviderModelList = { models: string[]; received_count: number; partial: boolean };

export function decodeModelList(data: JsonValue, provider: string, limit = 200): ProviderModelList {
  const gemini = providerFamily(provider) === 'gemini';
  const [key, idKey] = gemini ? ['models', 'name'] : ['data', 'id'];
  const entries = isJsonObject(data) ? data[key] : undefined;
  if (!Array.isArray(entries)) throw new InvalidModelList('invalid_models_response');
  const models: string[] = [];
  for (const entry of entries) {
    let name = isJsonObject(entry) ? entry[idKey] : undefined;
    if (typeof name !== 'string' || !pythonStrip(name))
      throw new InvalidModelList('invalid_model_identifier');
    if (gemini) {
      if (!name.startsWith('models/') || name === 'models/')
        throw new InvalidModelList('invalid_model_resource_name');
      name = name.slice('models/'.length);
    }
    if (models.length < limit) models.push(name);
  }
  const record = data as { [key: string]: JsonValue };
  const partial =
    entries.length > limit || record.has_more === true || pythonTruthy(record.nextPageToken);
  return { models, received_count: entries.length, partial };
}

const isAscii = (text: string) => Array.from(text).every((char) => char.charCodeAt(0) < 0x80);

const SCHEME_CHARS = /^[A-Za-z0-9+\-.]+$/;
const WHITESPACE = new RegExp(PYTHON_WHITESPACE, 'u');

export type SplitResult = { scheme: string; netloc: string; path: string; query: string };

/** urllib.parse.urlsplit（CPython 3.13）；不合法时抛 RangeError。 */
export function urlsplit(input: string): SplitResult {
  // 先去掉开头的 C0 控制符与空格，再删掉所有制表与换行（WHATWG）。
  let start = 0;
  while (start < input.length && input.charCodeAt(start) <= 0x20) start += 1;
  let url = input.slice(start).replace(/[\t\r\n]/g, '');
  let scheme = '';
  let netloc = '';
  let query = '';
  const colon = url.indexOf(':');
  if (colon > 0 && /^[A-Za-z]/.test(url) && SCHEME_CHARS.test(url.slice(0, colon))) {
    scheme = url.slice(0, colon).toLowerCase();
    url = url.slice(colon + 1);
  }
  if (url.startsWith('//')) {
    let end = url.length;
    for (const delimiter of '/?#') {
      const at = url.indexOf(delimiter, 2);
      if (at >= 0) end = Math.min(end, at);
    }
    netloc = url.slice(2, end);
    url = url.slice(end);
    const open = netloc.includes('[');
    const close = netloc.includes(']');
    if (open !== close) throw new RangeError('Invalid IPv6 URL');
    if (open) checkBracketedNetloc(netloc);
  }
  const hash = url.indexOf('#');
  if (hash >= 0) url = url.slice(0, hash);
  const question = url.indexOf('?');
  if (question >= 0) {
    query = url.slice(question + 1);
    url = url.slice(0, question);
  }
  checkNetloc(netloc);
  return { scheme, netloc, path: url, query };
}

function checkNetloc(netloc: string) {
  if (isAscii(netloc)) return;
  const stripped = netloc.replace(/[@:#?]/g, '');
  const normalized = stripped.normalize('NFKC');
  if (stripped === normalized) return;
  for (const char of '/?#@:')
    if (normalized.includes(char)) throw new RangeError('netloc contains invalid characters');
}

function checkBracketedNetloc(netloc: string) {
  const hostAndPort = netloc.slice(netloc.lastIndexOf('@') + 1);
  const open = hostAndPort.indexOf('[');
  let hostname: string;
  if (open >= 0) {
    if (open > 0) throw new RangeError('Invalid IPv6 URL');
    const bracketed = hostAndPort.slice(open + 1);
    const close = bracketed.indexOf(']');
    hostname = close >= 0 ? bracketed.slice(0, close) : bracketed;
    const port = close >= 0 ? bracketed.slice(close + 1) : '';
    if (port && !port.startsWith(':')) throw new RangeError('Invalid IPv6 URL');
  } else {
    const colon = hostAndPort.indexOf(':');
    hostname = colon >= 0 ? hostAndPort.slice(0, colon) : hostAndPort;
  }
  if (hostname.startsWith('v')) {
    if (!/^v[a-fA-F0-9]+\.[\s\S]+$/.test(hostname))
      throw new RangeError('IPvFuture address is invalid');
  } else if (!isIPv6(hostname)) throw new RangeError('Invalid IPv6 URL');
}

const isIPv4 = (text: string) =>
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/.test(
    text,
  );

/** ipaddress.IPv6Address 的文本语法（含末尾 IPv4 与 %zone），逐条照 CPython 的判定。 */
function isIPv6(text: string): boolean {
  const percent = text.indexOf('%');
  let address = text;
  if (percent >= 0) {
    const zone = text.slice(percent + 1);
    if (!zone || zone.includes('%')) return false;
    address = text.slice(0, percent);
  }
  if (!address || address.length > 45) return false;
  const parts = address.split(':');
  if (parts.length < 3) return false;
  if (parts[parts.length - 1].includes('.')) {
    if (!isIPv4(parts.pop()!)) return false;
    parts.push('0', '0');
  }
  if (parts.length > 9) return false;
  let skip: number | null = null;
  for (let i = 1; i < parts.length - 1; i++)
    if (!parts[i]) {
      if (skip !== null) return false;
      skip = i;
    }
  let hi: number;
  let lo: number;
  if (skip !== null) {
    hi = skip;
    lo = parts.length - skip - 1;
    if (!parts[0] && --hi) return false;
    if (!parts[parts.length - 1] && --lo) return false;
    if (8 - (hi + lo) < 1) return false;
  } else {
    if (parts.length !== 8 || !parts[0] || !parts[parts.length - 1]) return false;
    hi = parts.length;
    lo = 0;
  }
  const hextet = (part: string) => /^[0-9a-fA-F]{1,4}$/.test(part);
  return parts.slice(0, hi).every(hextet) && parts.slice(parts.length - lo).every(hextet);
}

export function hostInfo(netloc: string): [string, string | null] {
  const info = netloc.slice(netloc.lastIndexOf('@') + 1);
  const open = info.indexOf('[');
  let hostname: string;
  let port: string;
  if (open >= 0) {
    const bracketed = info.slice(open + 1);
    const close = bracketed.indexOf(']');
    hostname = close >= 0 ? bracketed.slice(0, close) : bracketed;
    const rest = close >= 0 ? bracketed.slice(close + 1) : '';
    const colon = rest.indexOf(':');
    port = colon >= 0 ? rest.slice(colon + 1) : '';
  } else {
    const colon = info.indexOf(':');
    hostname = colon >= 0 ? info.slice(0, colon) : info;
    port = colon >= 0 ? info.slice(colon + 1) : '';
  }
  return [hostname, port || null];
}

function checkedPort(port: string | null) {
  if (port === null) return;
  if (!/^[0-9]+$/.test(port)) throw new RangeError('invalid_port');
  const value = Number(port);
  if (value > 65535) throw new RangeError('Port out of range 0-65535');
}

const UTF8 = new TextDecoder('utf-8', { ignoreBOM: true });

/** urllib.parse.unquote（UTF-8，非法序列替换为 U+FFFD）：只在 ASCII 段里解百分号转义。 */
export function pythonUnquote(text: string): string {
  if (!text.includes('%')) return text;
  let output = '';
  let bytes: number[] = [];
  const flush = () => {
    if (bytes.length) output += UTF8.decode(new Uint8Array(bytes));
    bytes = [];
  };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x80) {
      flush();
      output += text[i];
    } else if (text[i] === '%' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(code);
  }
  flush();
  return output;
}

/** urllib.parse.parse_qsl 的默认行为：没有 `=` 或值为空的项被丢弃。 */
function parseQueryNames(query: string): string[] {
  if (!query) return [];
  const names: string[] = [];
  for (const item of query.split('&')) {
    if (!item) continue;
    const equals = item.indexOf('=');
    if (equals < 0 || equals === item.length - 1) continue;
    names.push(pythonUnquote(item.slice(0, equals).replace(/\+/g, ' ')));
  }
  return names;
}

/** `{baseUrl}/models`：拒绝非 http(s)、带凭据或密钥参数的地址；错误不回显原文。 */
export function modelsUrl(baseUrl: string, credential: string): string {
  const parts = urlsplit(baseUrl);
  const [hostname, port] = hostInfo(parts.netloc);
  if (!['http', 'https'].includes(parts.scheme) || !hostname || WHITESPACE.test(baseUrl))
    throw new RangeError('invalid_provider_url');
  checkedPort(port);
  if (
    parts.netloc.includes('@') ||
    parseQueryNames(parts.query).some(
      (key) => key.toLowerCase() === 'key' || isSensitiveKey(key),
    ) ||
    (credential && pythonUnquote(baseUrl).includes(credential))
  )
    throw new RangeError('credentials_in_provider_url');
  const path = parts.path.replace(/\/+$/, '') + '/models';
  return `${parts.scheme}://${parts.netloc}${path}${parts.query ? `?${parts.query}` : ''}`;
}
