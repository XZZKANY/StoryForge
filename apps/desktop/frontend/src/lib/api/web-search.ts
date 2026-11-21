import { invokeWebSearch } from '../host/web-search';

/** 搜索密钥只在宿主加密保存，界面仅获知是否已有密钥。 */
export type WebSearchProvider = 'tavily' | 'openai';
export type WebSearchConfig = {
  enabled: boolean;
  /** Tavily独立密钥是否已保存；OpenAI使用openaiReady。 */
  hasApiKey: boolean;
  provider: WebSearchProvider;
  openaiReady?: boolean;
  openaiModel?: string | null;
};
export const webSearchReady = (value: WebSearchConfig) =>
  value.provider === 'openai' ? value.openaiReady === true : value.hasApiKey;
export type SaveWebSearchConfigRequest = {
  enabled: boolean;
  provider?: WebSearchProvider;
  apiKey?: string | null;
  clearApiKey?: boolean;
};
export type WebSearchRequest = { query: string; maxResults?: number };
export type WebSearchResult = { title: string; url: string; snippet: string };
export type WebSearchResponse = {
  query: string;
  results: WebSearchResult[];
  searchedAt: string;
  provider: WebSearchProvider;
  summary?: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function config(value: unknown): WebSearchConfig {
  if (
    !object(value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.hasApiKey !== 'boolean' ||
    !['tavily', 'openai'].includes(String(value.provider))
  )
    throw new Error('联网搜索配置格式不正确，请更新桌面程序后重试。');
  if (
    (value.openaiReady !== undefined && typeof value.openaiReady !== 'boolean') ||
    (value.openaiModel !== undefined &&
      value.openaiModel !== null &&
      typeof value.openaiModel !== 'string')
  )
    throw new Error('联网搜索配置格式不正确，请更新桌面程序后重试。');
  return {
    enabled: value.enabled,
    hasApiKey: value.hasApiKey,
    provider: value.provider as WebSearchProvider,
    ...(value.openaiReady !== undefined ? { openaiReady: value.openaiReady as boolean } : {}),
    ...(value.openaiModel !== undefined ? { openaiModel: value.openaiModel as string | null } : {}),
  };
}

/** 只返回预定义诊断；异常里即使包含请求头或密钥，也不会原样交给界面/模型。 */
function searchFailure(error: unknown): Error {
  const raw = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  if (/未启用|disabled/u.test(raw)) return new Error('联网搜索尚未启用，请先在设置中开启。');
  if (/未配置|密钥.*(?:缺少|为空)|missing.*key/u.test(raw))
    return new Error('联网搜索尚未配置密钥，请检查所选搜索服务及模型服务的密钥。');
  if (/401|403|密钥无效|拒绝了密钥|密钥无法解密|认证|鉴权/u.test(raw))
    return new Error('搜索密钥无效或没有权限，请检查所选搜索服务或当前模型服务的密钥。');
  if (/不支持|未获得实际搜索|未完成|无效输出/u.test(raw))
    return new Error('当前模型或服务未完成实际联网搜索，请确认支持 Responses web_search。');
  if (/429|额度|限流|超限/u.test(raw)) return new Error('搜索额度不足或请求过于频繁，请稍后重试。');
  if (/超时|timeout|timed out/iu.test(raw)) return new Error('联网搜索超时，请稍后重试。');
  return new Error('联网搜索失败，请检查配置和网络连接后重试。');
}

export async function getWebSearchConfig(): Promise<WebSearchConfig> {
  let value: unknown;
  try {
    value = await invokeWebSearch('web_search_get_config');
  } catch {
    throw new Error('联网搜索配置暂不可用，请确认正在使用支持此功能的桌面程序。');
  }
  return config(value);
}

export async function saveWebSearchConfig(
  request: SaveWebSearchConfigRequest,
): Promise<WebSearchConfig> {
  let value: unknown;
  try {
    value = await invokeWebSearch('web_search_save_config', { request });
  } catch {
    throw new Error('联网搜索配置保存失败，请检查密钥或重试。');
  }
  return config(value);
}

export async function searchWeb(request: WebSearchRequest): Promise<WebSearchResponse> {
  const query = request.query.trim();
  const maxResults = request.maxResults ?? 5;
  if (
    !query ||
    [...query].length > 400 ||
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > 8
  )
    throw new Error('搜索关键词须为1至400字，结果数量须为1至8。');
  let value: unknown;
  try {
    value = await invokeWebSearch('web_search_execute', { request: { query, maxResults } });
  } catch (error) {
    throw searchFailure(error);
  }
  if (
    !object(value) ||
    !['tavily', 'openai'].includes(String(value.provider)) ||
    typeof value.query !== 'string' ||
    typeof value.searchedAt !== 'string' ||
    !Array.isArray(value.results) ||
    value.results.length > maxResults
  )
    throw new Error('联网搜索返回格式不正确，请重试。');
  const results = value.results.map((item): WebSearchResult => {
    if (
      !object(item) ||
      typeof item.title !== 'string' ||
      typeof item.snippet !== 'string' ||
      typeof item.url !== 'string'
    )
      throw new Error('联网搜索返回格式不正确，请重试。');
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      throw new Error('联网搜索返回了无效来源地址。');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('联网搜索返回了无效来源地址。');
    return { title: item.title, url: item.url, snippet: item.snippet };
  });
  return {
    query: value.query,
    searchedAt: value.searchedAt,
    provider: value.provider as WebSearchProvider,
    results,
    ...(typeof value.summary === 'string' ? { summary: value.summary.slice(0, 3000) } : {}),
  };
}
